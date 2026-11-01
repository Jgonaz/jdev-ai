import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BacklogError, BacklogStore } from './backlog.ts';
import { commitBacklog, commitPreview, parsePorcelain, proposeMessage, proposeSubject, validateCommitRequest } from './backlog-commit.ts';
import type { CommitPhase } from './backlog-commit.ts';
import { itemSource } from './backlog-fixtures.ts';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');
const A = 'BL-20261024-1145-a';
const B = 'BL-20261024-1145-b';
const C = 'BL-20261024-1145-c';

// Git aislado: sin configuración global ni del sistema (hooks, firmas, push.default).
const ENV_GIT = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
let envPrevio: Record<string, string | undefined> = {};
let raizTmp: string;
beforeAll(() => {
  raizTmp = mkdtempSync(join(tmpdir(), 'jdev-commit-test-'));
  const global = join(raizTmp, 'gitconfig');
  writeFileSync(global, '[user]\n\tname = Prueba\n\temail = prueba@example.com\n[init]\n\tdefaultBranch = main\n[push]\n\tdefault = simple\n');
  envPrevio = Object.fromEntries(ENV_GIT.map((k) => [k, process.env[k]]));
  for (const k of ENV_GIT) delete process.env[k];
  process.env.GIT_CONFIG_GLOBAL = global;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});
afterAll(() => {
  for (const k of ENV_GIT) {
    if (envPrevio[k] === undefined) delete process.env[k];
    else process.env[k] = envPrevio[k];
  }
  rmSync(raizTmp, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

function nuevoRepo(nombre: string): string {
  const dir = join(raizTmp, nombre);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}
function item(proy: string, estado: string, id: string, contenido = itemSource(id, estado)): void {
  mkdirSync(join(proy, 'docs', 'backlog', estado), { recursive: true });
  writeFileSync(join(proy, 'docs', 'backlog', estado, `${id}.md`), contenido);
}
function commitTodo(proy: string, msg = 'inicio'): void {
  git(proy, 'add', '-A');
  git(proy, 'commit', '-q', '--no-verify', '-m', msg);
}
function remotoBare(nombre: string): string {
  const bare = join(raizTmp, `${nombre}.git`);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  return bare;
}
function hook(proy: string, nombre: string, cuerpo: string): void {
  const ruta = join(proy, '.git', 'hooks', nombre);
  writeFileSync(ruta, `#!/bin/sh\n${cuerpo}\n`);
  chmodSync(ruta, 0o755);
}
const ultimo = (dir: string) => git(dir, 'log', '-1', '--format=%B').replace(/\n+$/, '\n');
const archivosDe = (dir: string, ref = 'HEAD') => git(dir, 'show', '--name-status', '--format=', ref).trim();

describe('mensaje propuesto', () => {
  it('analiza el porcelain con renombrados y empareja borrado y añadido del mismo elemento', () => {
    const salida = [
      `R  docs/backlog/todo/${A}.md`,
      `docs/backlog/backlog/${A}.md`,
      ` D docs/backlog/todo/${B}.md`,
      `?? docs/backlog/done/${B}.md`,
      ` M docs/backlog/backlog/${C}.md`,
      '?? docs/backlog/backlog/BL-20261024-1145-nuevo.md',
      'D  docs/backlog/README.md',
      'AD docs/backlog/fantasma.md',
      '',
    ].join('\0');
    expect(parsePorcelain(salida)).toEqual([
      { status: 'modified', path: `docs/backlog/backlog/${C}.md` },
      { status: 'added', path: 'docs/backlog/backlog/BL-20261024-1145-nuevo.md' },
      { status: 'moved', path: `docs/backlog/done/${B}.md`, from: `docs/backlog/todo/${B}.md` },
      { status: 'deleted', path: 'docs/backlog/README.md' },
      { status: 'moved', path: `docs/backlog/todo/${A}.md`, from: `docs/backlog/backlog/${A}.md` },
    ]);
  });

  it('agrupa por estado destino, con un punto por archivo y sin coautoría', () => {
    const mensaje = proposeMessage([
      { status: 'moved', path: `docs/backlog/todo/${A}.md`, from: `docs/backlog/backlog/${A}.md` },
      { status: 'moved', path: `docs/backlog/todo/${B}.md`, from: `docs/backlog/backlog/${B}.md` },
      { status: 'moved', path: `docs/backlog/discarded/${C}.md`, from: `docs/backlog/todo/${C}.md` },
    ]);
    expect(mensaje).toBe(
      [
        // Con el identificador serían 73 caracteres: pasa a recuentos.
        'docs(backlog): pasa 2 elementos a por hacer y descarta 1 elemento',
        '',
        `- docs/backlog/todo/${A}.md: movido desde backlog a todo`,
        `- docs/backlog/todo/${B}.md: movido desde backlog a todo`,
        `- docs/backlog/discarded/${C}.md: movido desde todo a discarded`,
        '',
      ].join('\n'),
    );
    expect(mensaje).not.toMatch(/Co-Authored-By/i);
    expect(proposeSubject([{ status: 'moved', path: `docs/backlog/discarded/${C}.md`, from: `docs/backlog/todo/${C}.md` }])).toBe(
      `docs(backlog): descarta ${C}`,
    );
  });

  it('modificados, añadidos, eliminados y la primera línea de 72 caracteres como mucho', () => {
    expect(proposeSubject([{ status: 'modified', path: `docs/backlog/todo/${A}.md` }])).toBe(`docs(backlog): actualiza ${A}`);
    expect(
      proposeSubject([
        { status: 'modified', path: `docs/backlog/todo/${A}.md` },
        { status: 'modified', path: `docs/backlog/todo/${B}.md` },
        { status: 'modified', path: `docs/backlog/todo/${C}.md` },
      ]),
    ).toBe('docs(backlog): actualiza 3 elementos');
    expect(proposeMessage([{ status: 'added', path: 'docs/backlog/README.md' }, { status: 'deleted', path: `docs/backlog/done/${A}.md` }])).toBe(
      `docs(backlog): añade README.md y elimina ${A}\n\n- docs/backlog/README.md: añadido\n- docs/backlog/done/${A}.md: eliminado\n`,
    );
    const largo = 'BL-20261024-1145-un-identificador-muy-largo-para-la-primera-linea';
    const s = proposeSubject([
      { status: 'moved', path: `docs/backlog/done/${largo}.md`, from: `docs/backlog/todo/${largo}.md` },
      { status: 'added', path: `docs/backlog/backlog/${A}.md` },
    ]);
    expect(s).toBe('docs(backlog): marca 1 elemento como hecho y añade 1 elemento');
    expect(s.length).toBeLessThanOrEqual(72);
    expect(proposeMessage([])).toBe('');
  });

  it('valida el mensaje y la casilla de push', () => {
    const err = (c: Parameters<typeof validateCommitRequest>[0]) => {
      try {
        validateCommitRequest(c);
        return null;
      } catch (e) {
        return e instanceof BacklogError ? e.status : 'otro';
      }
    };
    expect(err({ message: '  ', push: false })).toBe(400);
    expect(err({ message: 3, push: false })).toBe(400);
    expect(err({ message: 'x'.repeat(10_001), push: false })).toBe(400);
    expect(err({ message: 'ok', push: 'sí' })).toBe(400);
    expect(validateCommitRequest({ message: 'ok', push: undefined })).toEqual({ message: 'ok', push: false, fingerprint: null });
  });
});

describe('commit del backlog con repositorios temporales', () => {
  let proy: string;
  let n = 0;
  const store = new BacklogStore();
  const mover = async (id: string, to: string) => {
    const actual = await store.get(proy, id);
    return store.move(proy, id, to, actual!.etag, '2026-11-01');
  };
  const confirmar = async (push: boolean, message?: string) => {
    const previa = await commitPreview(proy);
    const fases: CommitPhase[] = [];
    const r = await store.exclusive(proy, () =>
      commitBacklog(proy, { message: message ?? previa.message, push, fingerprint: previa.fingerprint }, (f) => fases.push(f)),
    );
    return { r, fases, previa };
  };

  beforeEach(() => {
    proy = nuevoRepo(`p${++n}`);
    item(proy, 'backlog', A);
    item(proy, 'backlog', B);
    item(proy, 'todo', C);
    writeFileSync(join(proy, 'app.txt'), 'uno\n');
    commitTodo(proy);
  });

  it('propone el mensaje según los movimientos y los cambios a mano', async () => {
    await mover(A, 'todo');
    await mover(B, 'todo');
    writeFileSync(join(proy, 'docs', 'backlog', 'todo', `${C}.md`), itemSource(C, 'todo', 'nota: 1\n'));
    item(proy, 'backlog', 'BL-20261101-0900-nuevo');
    const p = await commitPreview(proy);
    expect(p).toMatchObject({ branch: 'main', detached: false, upstream: null, remote: null });
    expect(p.files).toEqual([
      { status: 'added', path: 'docs/backlog/backlog/BL-20261101-0900-nuevo.md' },
      { status: 'moved', path: `docs/backlog/todo/${A}.md`, from: `docs/backlog/backlog/${A}.md` },
      { status: 'moved', path: `docs/backlog/todo/${B}.md`, from: `docs/backlog/backlog/${B}.md` },
      { status: 'modified', path: `docs/backlog/todo/${C}.md` },
    ]);
    // Con identificadores o recuentos no cabe en 72 caracteres: resumen genérico.
    expect(p.message.split('\n')[0]).toBe('docs(backlog): actualiza 4 elementos');
    expect(p.message).toContain(`- docs/backlog/todo/${A}.md: movido desde backlog a todo`);
    expect(p.message).toContain(`- docs/backlog/todo/${C}.md: modificado`);
    expect(p.message).toContain('- docs/backlog/backlog/BL-20261101-0900-nuevo.md: añadido');
  });

  it('solo confirma docs/backlog: lo que hay en el índice fuera sigue en el índice', async () => {
    await mover(A, 'todo');
    writeFileSync(join(proy, 'app.txt'), 'dos\n');
    git(proy, 'add', 'app.txt');
    writeFileSync(join(proy, 'otro.txt'), 'sin seguimiento\n');
    const { r, fases } = await confirmar(false, 'docs(backlog): pasa A\n\n- detalle\n');
    expect(r).toMatchObject({ status: 200, pushed: false });
    expect(r.status === 200 && r.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(fases).toEqual(['commit', 'done']);
    expect(archivosDe(proy)).toMatch(new RegExp(`^R\\d+\\tdocs/backlog/backlog/${A}\\.md\\tdocs/backlog/todo/${A}\\.md$`));
    expect(ultimo(proy)).toBe('docs(backlog): pasa A\n\n- detalle\n');
    expect(git(proy, 'status', '--porcelain')).toBe('M  app.txt\n?? otro.txt\n');
  });

  it('sin cambios y con HEAD detached responde 409', async () => {
    await expect(confirmar(false, 'x')).rejects.toMatchObject({ status: 409 });
    await mover(A, 'todo');
    git(proy, 'checkout', '-q', '--detach');
    const p = await commitPreview(proy);
    expect(p).toMatchObject({ branch: null, detached: true });
    await expect(confirmar(false, 'x')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('detached') });
  });

  it('rechaza el commit si la lista ha cambiado desde la vista previa', async () => {
    await mover(A, 'todo');
    const previa = await commitPreview(proy);
    await mover(B, 'todo');
    await expect(commitBacklog(proy, { message: 'x', push: false, fingerprint: previa.fingerprint })).rejects.toMatchObject({ status: 409 });
  });

  it('push sin rama de seguimiento: crea la rama en origin con -u', async () => {
    const bare = remotoBare(`r${n}`);
    git(proy, 'remote', 'add', 'origin', bare);
    await mover(A, 'todo');
    const { r, fases, previa } = await confirmar(true);
    expect(previa).toMatchObject({ upstream: null, remote: 'origin' });
    expect(r).toMatchObject({ status: 200, pushed: true });
    expect(fases).toEqual(['commit', 'push', 'done']);
    expect(git(bare, 'log', '-1', '--format=%s')).toBe(`docs(backlog): pasa ${A} a por hacer\n`);
    expect((await commitPreview(proy)).upstream).toBe('origin/main');
  });

  it('push con rama de seguimiento', async () => {
    const bare = remotoBare(`r${n}`);
    git(proy, 'remote', 'add', 'origin', bare);
    git(proy, 'push', '-q', '-u', 'origin', 'main');
    await mover(A, 'discarded');
    const { r, previa } = await confirmar(true);
    expect(previa).toMatchObject({ upstream: 'origin/main', remote: 'origin' });
    expect(r).toMatchObject({ status: 200, pushed: true });
    expect(git(bare, 'rev-parse', 'main')).toBe(git(proy, 'rev-parse', 'HEAD'));
  });

  it('push pedido sin remoto: 409 sin commit', async () => {
    await mover(A, 'todo');
    const antes = git(proy, 'rev-parse', 'HEAD');
    await expect(confirmar(true)).rejects.toMatchObject({ status: 409 });
    expect(git(proy, 'rev-parse', 'HEAD')).toBe(antes);
  });

  it('pre-commit que falla: 422 con su salida, sin commit y sin saltarse el hook', async () => {
    hook(proy, 'pre-commit', 'echo "lint: 3 errores" >&2\nexit 1');
    await mover(A, 'todo');
    const antes = git(proy, 'rev-parse', 'HEAD');
    const { r, fases } = await confirmar(false);
    expect(r).toMatchObject({ status: 422 });
    expect(r.output).toContain('lint: 3 errores');
    expect(fases).toEqual(['commit', 'error']);
    expect(git(proy, 'rev-parse', 'HEAD')).toBe(antes);
    expect((await commitPreview(proy)).files).toHaveLength(1);
  });

  it('pre-push que falla: 207 con el commit hecho en local', async () => {
    const bare = remotoBare(`r${n}`);
    git(proy, 'remote', 'add', 'origin', bare);
    hook(proy, 'pre-push', 'echo "pruebas fallidas"\nexit 1');
    await mover(A, 'todo');
    const { r, fases } = await confirmar(true);
    expect(r).toMatchObject({ status: 207, pushed: false });
    expect(r.output).toContain('pruebas fallidas');
    expect(fases).toEqual(['commit', 'push', 'error']);
    expect(r.status === 207 ? r.commit : null).toBe(git(proy, 'rev-parse', '--short', 'HEAD').trim());
    expect(() => git(bare, 'rev-parse', '--verify', '-q', 'main')).toThrow();
    expect((await commitPreview(proy)).files).toEqual([]);
  });

  it('confirma un movimiento hecho fuera del panel (sin git mv)', async () => {
    mkdirSync(join(proy, 'docs', 'backlog', 'done'));
    renameSync(join(proy, 'docs', 'backlog', 'todo', `${C}.md`), join(proy, 'docs', 'backlog', 'done', `${C}.md`));
    const { r, previa } = await confirmar(false);
    expect(previa.files).toEqual([{ status: 'moved', path: `docs/backlog/done/${C}.md`, from: `docs/backlog/todo/${C}.md` }]);
    expect(previa.message.split('\n')[0]).toBe(`docs(backlog): marca ${C} como hecho`);
    expect(r.status).toBe(200);
    expect(git(proy, 'status', '--porcelain')).toBe('');
  });
});

describe('API de commit del backlog', () => {
  const token = 'e'.repeat(64);
  const sock = `jdev-test-commit-${process.pid}-${Date.now().toString(36)}`;
  const auth = { Authorization: `Bearer ${token}` };
  let tmp: string;
  let proy: string;
  let bare: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let origen: string;

  const api = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-commit-api-'));
    const harness = join(tmp, 'harness');
    proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    git(proy, 'init', '-q', '-b', 'main');
    item(proy, 'backlog', A);
    commitTodo(proy);
    bare = join(tmp, 'remoto.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git(proy, 'remote', 'add', 'origin', bare);
    mkdirSync(join(tmp, 'dist'));
    cfg = tmuxConfig(harness, {}, { socket: sock, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'), launcher: () => ['sh', '-c', 'sleep 60'] });
    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: join(tmp, 'state'),
      claudeConfigDir: join(tmp, 'claude'),
      uploadsDir: join(tmp, 'uploads'),
      pollMs: 200,
      stateFallbackMs: 200,
      backlogFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
    origen = `http://localhost:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    let socketPath = '';
    try {
      socketPath = (
        await execFileAsync('tmux', ['-L', sock, 'start-server', ';', 'display-message', '-p', '#{socket_path}'], { env: { ...process.env, TMUX: '' } })
      ).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  afterEach(() => {
    git(proy, 'checkout', '-q', 'main');
  });

  it('exige token y un Origin propio', async () => {
    expect((await fetch(`${base}/api/projects/foo/backlog/commit-preview`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects/foo/backlog/commit`, { method: 'POST', body: '{}' })).status).toBe(401);
    const ajeno = await api('POST', '/api/projects/foo/backlog/commit', { message: 'x', push: false }, { Origin: 'http://evil.example' });
    expect(ajeno.status).toBe(403);
    expect((await api('GET', '/api/projects/foo/backlog/commit')).status).toBe(405);
    expect((await api('POST', '/api/projects/foo/backlog/commit-preview')).status).toBe(405);
  });

  it('sin cambios, mensaje vacío y HEAD detached', async () => {
    expect((await api('POST', '/api/projects/foo/backlog/commit', { message: 'x', push: false }, { Origin: origen })).status).toBe(409);
    expect((await api('POST', '/api/projects/foo/backlog/commit', { message: ' ', push: false }, { Origin: origen })).status).toBe(400);
    git(proy, 'checkout', '-q', '--detach');
    writeFileSync(join(proy, 'docs', 'backlog', 'backlog', `${A}.md`), itemSource(A, 'backlog', 'nota: 2\n'));
    const previa = (await (await api('GET', '/api/projects/foo/backlog/commit-preview')).json()) as Record<string, unknown>;
    expect(previa).toMatchObject({ branch: null, detached: true });
    const r = await api('POST', '/api/projects/foo/backlog/commit', { message: 'x', push: false }, { Origin: origen });
    expect(r.status).toBe(409);
    git(proy, 'checkout', '-q', '--', 'docs');
  });

  it('vista previa, commit con push y fases por /ws/events', async () => {
    const actual = (await (await api('GET', `/api/projects/foo/backlog/${A}`)).json()) as { item: { etag: string } };
    expect((await api('POST', `/api/projects/foo/backlog/${A}/move`, { to: 'todo', etag: actual.item.etag }, { Origin: origen })).status).toBe(200);
    const previa = (await (await api('GET', '/api/projects/foo/backlog/commit-preview')).json()) as Record<string, any>;
    expect(previa).toMatchObject({ branch: 'main', detached: false, upstream: null, remote: 'origin' });
    expect(previa.files).toEqual([{ status: 'moved', path: `docs/backlog/todo/${A}.md`, from: `docs/backlog/backlog/${A}.md` }]);
    expect(previa.message).toBe(`docs(backlog): pasa ${A} a por hacer\n\n- docs/backlog/todo/${A}.md: movido desde backlog a todo\n`);

    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: origen } });
    const eventos: Record<string, unknown>[] = [];
    const fin = new Promise<void>((ok) => {
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as Record<string, unknown>;
        if (m.type === 'backlog-commit' || m.type === 'backlog') eventos.push(m);
        if (m.type === 'backlog') ok();
      });
    });
    await new Promise((ok) => ws.once('open', ok));
    try {
      const r = await api('POST', '/api/projects/foo/backlog/commit', { message: previa.message, push: true, fingerprint: previa.fingerprint }, { Origin: origen });
      expect(r.status).toBe(200);
      const cuerpo = (await r.json()) as Record<string, unknown>;
      expect(cuerpo).toMatchObject({ pushed: true, commit: expect.stringMatching(/^[0-9a-f]{7,}$/) });
      await fin;
      expect(eventos).toEqual([
        { type: 'backlog-commit', project: 'foo', phase: 'commit' },
        { type: 'backlog-commit', project: 'foo', phase: 'push' },
        { type: 'backlog-commit', project: 'foo', phase: 'done' },
        { type: 'backlog', project: 'foo' },
      ]);
      expect(git(bare, 'log', '-1', '--format=%h')).toBe(`${String(cuerpo.commit)}\n`);
      expect(((await (await api('GET', '/api/projects/foo/backlog')).json()) as { pending: number }).pending).toBe(0);
    } finally {
      ws.close();
    }
  });
});

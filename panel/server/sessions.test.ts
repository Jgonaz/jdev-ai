import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from './main.ts';
import { projectSlug } from './recent.ts';
import { lastChange } from './sessions.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Sesion = {
  name: string;
  project: string;
  agent: string;
  worktree: string;
  branch: string | null;
  state: string;
  tracked: boolean;
  title: string;
  closed: boolean;
  alive: boolean;
  updatedAt: number;
  command?: string;
};

describe('API de sesiones y terminal', () => {
  const token = 'd'.repeat(64);
  const sock = `jdev-test-api-${process.pid}-${Date.now().toString(36)}`;
  let tmp: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let mensajes = 'echo hola; sleep 60';
  const auth = { Authorization: `Bearer ${token}` };
  const wsHeaders = () => ({ ...auth, Origin: `http://localhost:${srv.port}` });
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });

  const api = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-api-'));
    const harness = join(tmp, 'harness');
    const proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', proy]);
    // Un worktree existente (basta con que tenga .git).
    mkdirSync(join(harness, 'projects', 'foo.worktrees', 'mi-feature'), { recursive: true });
    writeFileSync(join(harness, 'projects', 'foo.worktrees', 'mi-feature', '.git'), 'gitdir: x');
    mkdirSync(join(tmp, 'dist'));
    cfg = tmuxConfig(harness, {}, {
      socket: sock,
      confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'),
      // En lugar de bin/agent, un comando inocuo (lee la salida de `mensajes` en cada creación).
      launcher: () => ['sh', '-c', mensajes],
    });
    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: join(tmp, 'state'),
      claudeConfigDir: join(tmp, 'claude'),
      pollMs: 200,
      stateFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    // Solo el servidor tmux de prueba; el archivo del socket se borra aparte.
    let socketPath = '';
    try {
      socketPath = (await tmuxCli('start-server', ';', 'display-message', '-p', '#{socket_path}')).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exige token en las rutas de sesiones', async () => {
    expect((await fetch(`${base}/api/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/api/sessions`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/sessions/jdev-foo-1`, { method: 'DELETE' })).status).toBe(401);
  });

  it('empieza sin sesiones aunque el servidor tmux no esté arrancado', async () => {
    const r = await api('GET', '/api/sessions');
    expect(r.status).toBe(200);
    // Expone el socket real para que el cliente no suponga «jdev», y el HOME
    // para expandir las rutas «~/…» de las imágenes.
    expect(await r.json()).toEqual({ sessions: [], tmuxSocket: sock, home: homedir() });
  });

  it('dryRun y preview devuelven el comando sin ejecutar nada', async () => {
    const pedido = { project: 'foo', agent: 'claude', location: 'new-worktree', feature: 'typescript-7', prompt: 'haz algo' };
    const r = await api('POST', '/api/sessions', { ...pedido, dryRun: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      dryRun: true,
      command: 'bin/agent foo --wt typescript-7 -- "haz algo"',
      args: ['foo', '--wt', 'typescript-7', '--', 'haz algo'],
    });
    const q = new URLSearchParams({ ...pedido });
    const p = await api('GET', `/api/sessions/preview?${q}`);
    expect(p.status).toBe(200);
    expect(((await p.json()) as { command: string }).command).toBe('bin/agent foo --wt typescript-7 -- "haz algo"');
    // Nada se creó.
    expect(((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions).toEqual([]);
    expect((await api('GET', '/api/sessions/preview?project=nope')).status).toBe(400);
  });

  it('rechaza entradas inválidas con 400 y un mensaje en castellano', async () => {
    const malo = async (cuerpo: unknown) => {
      const r = await api('POST', '/api/sessions', cuerpo);
      expect(r.status).toBe(400);
      return ((await r.json()) as { error: string }).error;
    };
    expect(await malo({ project: 'nope' })).toMatch(/no existe/);
    expect(await malo({ project: 'foo', location: 'new-worktree', feature: 'Mala Feature' })).toMatch(/feature/);
    expect(await malo({ project: 'foo', location: 'existing-worktree', feature: 'otra' })).toMatch(/no existe en foo/);
    expect(await malo({ project: 'harness', location: 'new-worktree', feature: 'x' })).toMatch(/harness no admite worktrees/);
    expect(await malo({ project: 'foo', agent: 'gpt' })).toMatch(/Agente no válido/);
    const invalido = await fetch(`${base}/api/sessions`, { method: 'POST', headers: auth, body: 'no json' });
    expect(invalido.status).toBe(400);
    const array = await api('POST', '/api/sessions', []);
    expect(array.status).toBe(400);
    // Con origen ajeno, ni se evalúa.
    const otro = await api('POST', '/api/sessions', { project: 'foo', dryRun: true }, { Origin: 'http://evil.example' });
    expect(otro.status).toBe(403);
    const otroDelete = await api('DELETE', '/api/sessions/jdev-foo-1', { confirm: true }, { Origin: 'http://evil.example' });
    expect(otroDelete.status).toBe(403);
  });

  describe('sesión real', () => {
    let nombre = '';
    const eventos: { type: string; sessions?: Sesion[] }[] = [];
    let ev: WebSocket;

    it('/ws/events envía hello y la lista actual al conectar', async () => {
      ev = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: wsHeaders() });
      ev.on('message', (d) => eventos.push(JSON.parse(String(d))));
      await vi.waitFor(() => expect(eventos.map((e) => e.type)).toEqual(['hello', 'sessions']));
      expect(eventos[1]!.sessions).toEqual([]);
    });

    it('POST crea la sesión (con el comando inyectado) y la devuelve con su comando', async () => {
      const r = await api('POST', '/api/sessions', { project: 'foo', agent: 'codex', location: 'existing-worktree', feature: 'mi-feature' });
      expect(r.status).toBe(201);
      const cuerpo = (await r.json()) as { session: Sesion; command: string };
      nombre = cuerpo.session.name;
      expect(nombre).toBe('jdev-foo-1');
      expect(cuerpo.command).toBe('bin/agent foo --codex --wt mi-feature');
      expect(cuerpo.session).toMatchObject({
        project: 'foo',
        agent: 'codex',
        worktree: 'mi-feature',
        state: 'alive',
        tracked: false,
        closed: false,
        alive: true,
        command: 'bin/agent foo --codex --wt mi-feature',
      });
      expect(cuerpo.session.title).toMatch(/^foo · Codex · \d\d:\d\d$/);

      const lista = ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
      expect(lista.map((s) => s.name)).toEqual([nombre]);
      // El evento llega al canal de eventos sin recargar.
      await vi.waitFor(() => expect(eventos.at(-1)?.sessions?.map((s) => s.name)).toEqual([nombre]));
    });

    it('el estado y el título de Claude llegan por la API y por /ws/events', async () => {
      const transcript = join(tmp, 'transcript.jsonl');
      writeFileSync(transcript, '{"type":"user"}\n{"type":"custom-title","customTitle":"[Closed] Revisar login","sessionId":"s1"}\n');
      const estado = {
        session_id: 's1',
        state: 'waiting',
        event: 'Notification',
        updated_at: new Date().toISOString(),
        project: 'foo',
        agent: 'claude',
        worktree: 'mi-feature',
        transcript_path: transcript,
        cwd: tmp,
        tmux_session: nombre,
      };
      mkdirSync(join(tmp, 'state'), { recursive: true });
      writeFileSync(join(tmp, 'state', 's1.json'), JSON.stringify(estado));
      await vi.waitFor(() => {
        expect(eventos.at(-1)?.sessions?.[0]).toMatchObject({ state: 'waiting', tracked: true, title: 'Revisar login', closed: true });
      });
      const lista = ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
      expect(lista[0]).toMatchObject({ state: 'waiting', title: 'Revisar login', closed: true, alive: true });

      // Un cambio de estado se empuja solo.
      writeFileSync(join(tmp, 'state', 's1.json'), JSON.stringify({ ...estado, state: 'working', updated_at: new Date(Date.now() + 1000).toISOString() }));
      await vi.waitFor(() => expect(eventos.at(-1)?.sessions?.[0]?.state).toBe('working'));
    });

    it('/ws/term/<sesión> muestra la salida y responde a resize y a la entrada', async () => {
      // La segunda sesión escribe, espera una línea y la repite.
      mensajes = "echo hola; read x; echo recibido-$x; sleep 60";
      const r = await api('POST', '/api/sessions', { project: 'foo' });
      const segunda = ((await r.json()) as { session: Sesion }).session.name;
      expect(segunda).toBe('jdev-foo-2');

      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/term/${segunda}?cols=100&rows=30`, { headers: wsHeaders() });
      let salida = '';
      let binarios = 0;
      ws.on('message', (d, binario) => {
        if (binario) binarios++;
        salida += (d as Buffer).toString('utf8');
      });
      await new Promise<void>((ok, ko) => {
        ws.once('open', () => ok());
        ws.once('error', ko);
      });
      await vi.waitFor(() => expect(salida).toContain('hola'));
      expect(binarios).toBeGreaterThan(0);

      const tamano = async () => (await tmuxCli('display-message', '-p', '-t', `=${segunda}:`, '#{window_width}x#{window_height}')).stdout.trim();
      await vi.waitFor(async () => expect(await tamano()).toBe('100x30'));
      ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
      await vi.waitFor(async () => expect(await tamano()).toBe('120x40'));
      // Valores absurdos se acotan en lugar de romper la sesión.
      ws.send(JSON.stringify({ type: 'resize', cols: 99999, rows: 1 }));
      await vi.waitFor(async () => expect(await tamano()).toBe('500x5'));
      ws.send(JSON.stringify({ type: 'resize', cols: 'a', rows: 1 })); // ignorado

      // Entrada como texto y como binario.
      ws.send('abc');
      ws.send(Buffer.from('d\r'));
      await vi.waitFor(() => expect(salida).toContain('recibido-abcd'));

      // Cerrar el WebSocket quita el cliente de tmux pero no mata la sesión.
      ws.close();
      await vi.waitFor(async () => {
        expect((await tmuxCli('list-clients', '-t', `=${segunda}`)).stdout.trim()).toBe('');
      });
      const lista = ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
      expect(lista.map((s) => s.name)).toContain(segunda);
      await api('DELETE', `/api/sessions/${segunda}`, { confirm: true });
    });

    it('/ws/term rechaza o cierra con motivo claro', async () => {
      const abrir = (ruta: string, headers: Record<string, string> = wsHeaders()) =>
        new Promise<string>((ok) => {
          const ws = new WebSocket(`ws://127.0.0.1:${srv.port}${ruta}`, { headers });
          ws.on('close', (codigo, motivo) => ok(`close ${codigo} ${motivo.toString()}`));
          ws.on('unexpected-response', (_q, res) => ok(`http ${res.statusCode}`));
          ws.on('error', () => ok('error'));
        });
      expect(await abrir('/ws/term/jdev-foo-9')).toBe('close 4404 sesión no encontrada');
      expect(await abrir('/ws/term/otra')).toBe('http 404');
      expect(await abrir(`/ws/term/${nombre}?cols=abc`)).toBe('http 400');
      expect(await abrir(`/ws/term/${nombre}`, auth)).toBe('http 403');
      expect(await abrir(`/ws/term/${nombre}`, { Origin: wsHeaders().Origin })).toBe('http 401');
      expect(await abrir(`/ws/term/${nombre}`, { ...wsHeaders(), Origin: 'http://evil.example' })).toBe('http 403');
    });

    it('la terminal se cierra con 1000 si el cliente de tmux termina', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/term/${nombre}`, { headers: wsHeaders() });
      const cierre = new Promise<string>((ok) => ws.on('close', (c, m) => ok(`${c} ${m.toString()}`)));
      await new Promise<void>((ok) => ws.once('open', () => ok()));
      // El WebSocket se abre antes de que el cliente de tmux termine de adjuntarse:
      // se espera a verlo en la lista para no desconectar «ningún cliente».
      await vi.waitFor(async () => expect((await tmuxCli('list-clients', '-t', `=${nombre}`)).stdout.trim()).not.toBe(''), { timeout: 5000 });
      await tmuxCli('detach-client', '-s', `=${nombre}`);
      expect(await cierre).toBe('1000 terminal cerrada');
    });

    it('DELETE exige confirmación, solo acepta jdev-* y termina la sesión', async () => {
      const sinConfirmar = await api('DELETE', `/api/sessions/${nombre}`);
      expect(sinConfirmar.status).toBe(400);
      expect(((await sinConfirmar.json()) as { error: string }).error).toMatch(/confirmación/);
      expect((await api('DELETE', `/api/sessions/${nombre}`, { confirm: false })).status).toBe(400);
      expect((await api('DELETE', '/api/sessions/otra', { confirm: true })).status).toBe(400);
      expect((await api('DELETE', '/api/sessions/jdev-foo-1%3Bx', { confirm: true })).status).toBe(400);
      expect((await api('DELETE', '/api/sessions/jdev-nada-7', { confirm: true })).status).toBe(404);
      const lista0 = ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
      expect(lista0.map((s) => s.name)).toEqual([nombre]);

      const ok = await api('DELETE', `/api/sessions/${nombre}`, undefined, { 'X-Jdev-Confirm': 'yes' });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ deleted: true, name: nombre });
      expect(((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions).toEqual([]);
      await vi.waitFor(() => expect(eventos.at(-1)?.sessions).toEqual([]));
      expect((await api('DELETE', `/api/sessions/${nombre}`, { confirm: true })).status).toBe(404);
      expect((await api('PUT', `/api/sessions/${nombre}`)).status).toBe(405);
      ev.close();
    });
  });

  it('tras terminar las sesiones no queda ninguna en el servidor de prueba', async () => {
    const { stdout } = await tmuxCli('list-sessions', '-F', '#{session_name}').catch(() => ({ stdout: '' }));
    expect(stdout.trim()).toBe('');
  });

  describe('sesiones recientes y resume', () => {
    const principal = '11111111-aaaa-4bbb-8ccc-000000000001';
    const enWorktree = '22222222-aaaa-4bbb-8ccc-000000000002';
    const vacia = '33333333-aaaa-4bbb-8ccc-000000000003';
    const mensajes2 = '{"type":"user","message":{"content":"hola"}}\n';
    type Reciente = { id: string; project: string; worktree: string; title: string; closed: boolean; possiblyOpen: boolean };
    const recientes = async () => ((await (await api('GET', '/api/recent')).json()) as { recent: Reciente[] }).recent;
    const dir = (...partes: string[]) => join(tmp, 'claude', 'projects', projectSlug(join(tmp, 'harness', 'projects', ...partes)));
    const pedir = (cuerpo: unknown) => api('POST', '/api/sessions', cuerpo);
    const errorDe = async (cuerpo: unknown) => {
      const r = await pedir(cuerpo);
      expect(r.status).toBe(400);
      return ((await r.json()) as { error: string }).error;
    };

    beforeAll(() => {
      mkdirSync(dir('foo'), { recursive: true });
      mkdirSync(dir('foo.worktrees', 'mi-feature'), { recursive: true });
      writeFileSync(join(dir('foo'), `${principal}.jsonl`), mensajes2 + '{"type":"ai-title","aiTitle":"Título de IA","sessionId":"x"}\n');
      writeFileSync(
        join(dir('foo.worktrees', 'mi-feature'), `${enWorktree}.jsonl`),
        mensajes2 + '{"type":"custom-title","customTitle":"[Closed] Del worktree","sessionId":"x"}\n',
      );
      writeFileSync(join(dir('foo'), `${vacia}.jsonl`), '');
    });

    it('GET /api/recent exige token, solo admite GET y lista las sesiones con mensajes', async () => {
      expect((await fetch(`${base}/api/recent`)).status).toBe(401);
      expect((await api('POST', '/api/recent', {})).status).toBe(405);
      const r = await recientes();
      expect(r.map((s) => [s.id, s.project, s.worktree, s.title, s.closed, s.possiblyOpen]).sort()).toEqual(
        [
          [principal, 'foo', '', 'Título de IA', false, true],
          [enWorktree, 'foo', 'mi-feature', 'Del worktree', true, true],
        ].sort(),
      );
    });

    it('dryRun con resume muestra el comando y respeta el worktree de la sesión', async () => {
      const a = await pedir({ project: 'foo', agent: 'claude', location: 'main', resume: principal, dryRun: true });
      expect(await a.json()).toEqual({ dryRun: true, command: `bin/agent foo -- --resume ${principal}`, args: ['foo', '--', '--resume', principal] });
      const b = await pedir({ project: 'foo', location: 'existing-worktree', feature: 'mi-feature', resume: enWorktree, dryRun: true });
      expect(((await b.json()) as { command: string }).command).toBe(`bin/agent foo --wt mi-feature -- --resume ${enWorktree}`);
      // Nada se creó.
      expect(((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions).toEqual([]);
    });

    it('rechaza con 400 un resume incoherente, inexistente o combinado con otras opciones', async () => {
      expect(await errorDe({ project: 'foo', resume: 'no-es-un-uuid' })).toMatch(/id de la sesión a retomar/);
      expect(await errorDe({ project: 'foo', resume: `${principal}; ls` })).toMatch(/id de la sesión a retomar/);
      expect(await errorDe({ project: 'foo', agent: 'codex', resume: principal })).toMatch(/Solo se pueden retomar sesiones de Claude/);
      expect(await errorDe({ project: 'foo', resume: principal, prompt: 'hola' })).toMatch(/No se puede indicar un prompt/);
      expect(await errorDe({ project: 'foo', resume: '99999999-aaaa-4bbb-8ccc-000000000009' })).toMatch(/No se encuentra la sesión/);
      // La sesión del worktree no se puede retomar desde el checkout principal, ni al revés.
      expect(await errorDe({ project: 'foo', location: 'main', resume: enWorktree })).toMatch(/worktree «mi-feature»/);
      expect(await errorDe({ project: 'foo', location: 'existing-worktree', feature: 'mi-feature', resume: principal })).toMatch(
        /checkout principal/,
      );
      // Tampoco desde otro proyecto.
      expect(await errorDe({ project: 'harness', resume: principal })).toMatch(/pertenece al proyecto «foo»/);
    });

    it('al retomar, la sesión sale de recientes mientras exista en el panel y vuelve al terminarla', async () => {
      const r = await pedir({ project: 'foo', location: 'existing-worktree', feature: 'mi-feature', resume: enWorktree });
      expect(r.status).toBe(201);
      const { session, command } = (await r.json()) as { session: Sesion; command: string };
      expect(command).toBe(`bin/agent foo --wt mi-feature -- --resume ${enWorktree}`);
      expect((await recientes()).map((s) => s.id)).toEqual([principal]);

      // Una sesión con archivo de estado en una terminal del panel tampoco se ofrece.
      mkdirSync(join(tmp, 'state'), { recursive: true });
      writeFileSync(
        join(tmp, 'state', 'otra.json'),
        JSON.stringify({
          session_id: principal,
          state: 'idle',
          event: 'Stop',
          updated_at: new Date(Date.now() + 1000).toISOString(),
          project: 'foo',
          agent: 'claude',
          worktree: '',
          transcript_path: '',
          cwd: tmp,
          tmux_session: session.name,
        }),
      );
      await vi.waitFor(async () => expect(await recientes()).toEqual([]));

      await api('DELETE', `/api/sessions/${session.name}`, undefined, { 'X-Jdev-Confirm': 'yes' });
      rmSync(join(tmp, 'state', 'otra.json'));
      await vi.waitFor(async () => expect((await recientes()).map((s) => s.id).sort()).toEqual([principal, enWorktree].sort()));
    });
  });
});

describe('Host ajeno en /ws/term', () => {
  it('se rechaza antes de tocar tmux', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'jdev-host-'));
    const srv = await startServer({
      harnessRoot: tmp,
      port: 0,
      token: 'e'.repeat(64),
      distDir: tmp,
      configDir: join(tmp, 'c'),
      tmux: tmuxConfig(tmp, {}, { socket: `jdev-test-host-${process.pid}`, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf') }),
      stateDir: join(tmp, 's'),
    });
    try {
      const estado = await new Promise<number | undefined>((ok, ko) => {
        const req = request({
          host: '127.0.0.1',
          port: srv.port,
          path: '/ws/term/jdev-x-1',
          headers: { Host: 'evil.example', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' },
        });
        req.on('response', (res) => ok(res.statusCode));
        req.on('upgrade', () => ok(101));
        req.on('error', () => ok(undefined));
        req.end();
      });
      expect([403, undefined]).toContain(estado);
    } finally {
      await srv.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('lastChange', () => {
  const creada = Date.parse('2026-11-01T10:00:00Z');

  it('usa updated_at del archivo de estado cuando existe', () => {
    expect(lastChange(creada, { updatedAt: creada + 5000 })).toBe(creada + 5000);
  });

  it('sin archivo de estado usa la creación, no la actividad de tmux', () => {
    expect(lastChange(creada, undefined)).toBe(creada);
  });

  it('con un updated_at ilegible (0) vuelve a la creación', () => {
    expect(lastChange(creada, { updatedAt: 0 })).toBe(creada);
  });
});

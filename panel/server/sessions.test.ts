import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  done: { at: string | null; by: string; note: string | null } | null;
  conversationKey: string;
  alive: boolean;
  updatedAt: number;
  notice: string;
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
        done: null,
        alive: true,
        command: 'bin/agent foo --codex --wt mi-feature',
      });
      expect(cuerpo.session.title).toBe('foo · Nueva terminal');

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
        message: 'Claude needs your permission to use Bash',
      };
      mkdirSync(join(tmp, 'state'), { recursive: true });
      writeFileSync(join(tmp, 'state', 's1.json'), JSON.stringify(estado));
      await vi.waitFor(() => {
        expect(eventos.at(-1)?.sessions?.[0]).toMatchObject({ state: 'waiting', tracked: true, title: 'Revisar login', done: { at: null, by: 'agent', note: null } });
      });
      const lista = ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
      expect(lista[0]).toMatchObject({
        state: 'waiting',
        title: 'Revisar login',
        done: { at: null, by: 'agent', note: null },
        alive: true,
        notice: 'Claude needs your permission to use Bash',
      });

      // Un cambio de estado se empuja solo.
      writeFileSync(join(tmp, 'state', 's1.json'), JSON.stringify({ ...estado, state: 'working', updated_at: new Date(Date.now() + 1000).toISOString() }));
      await vi.waitFor(() => expect(eventos.at(-1)?.sessions?.[0]?.state).toBe('working'));
      expect(eventos.at(-1)?.sessions?.[0]?.notice).toBe('');
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
    type Reciente = { id: string; project: string; worktree: string; title: string; done: { at: string | null; by: string; note: string | null } | null; possiblyOpen: boolean };
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
      expect(r.map((s) => [s.id, s.project, s.worktree, s.title, s.done, s.possiblyOpen]).sort()).toEqual(
        [
          [principal, 'foo', '', 'Título de IA', null, true],
          [enWorktree, 'foo', 'mi-feature', 'Del worktree', { at: null, by: 'agent', note: null }, true],
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

  describe('renombrar sesiones', () => {
    const idClaude = '44444444-aaaa-4bbb-8ccc-000000000004';
    const sesionesCreadas: string[] = [];
    const crear = async (agent: 'claude' | 'codex' = 'codex') => {
      const r = await api('POST', '/api/sessions', { project: 'foo', agent });
      expect(r.status).toBe(201);
      const { session } = (await r.json()) as { session: Sesion };
      sesionesCreadas.push(session.name);
      return session.name;
    };
    const lista = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
    const titulo = (nombre: string) => api('PUT', `/api/sessions/${nombre}/title`, undefined);
    const renombrar = (nombre: string, title: unknown) => api('PUT', `/api/sessions/${nombre}/title`, { title });
    const estado = (nombre: string, transcript: string, sessionId = idClaude) => {
      mkdirSync(join(tmp, 'state'), { recursive: true });
      writeFileSync(
        join(tmp, 'state', `${sessionId}.json`),
        JSON.stringify({
          session_id: sessionId,
          state: 'idle',
          event: 'Stop',
          updated_at: new Date(Date.now() + 2000).toISOString(),
          project: 'foo',
          agent: 'claude',
          worktree: '',
          transcript_path: transcript,
          cwd: tmp,
          tmux_session: nombre,
        }),
      );
    };
    const proyectosClaude = () => join(tmp, 'claude', 'projects', 'foo-slug');
    const ultimaLinea = (ruta: string) => readFileSync(ruta, 'utf8').trimEnd().split('\n').at(-1);

    // Los archivos de estado de pruebas anteriores no deben heredarse por reutilizar el nombre de tmux.
    beforeAll(() => {
      rmSync(join(tmp, 'state'), { recursive: true, force: true });
    });

    afterEach(() => {
      rmSync(join(tmp, 'state', `${idClaude}.json`), { force: true });
      rmSync(proyectosClaude(), { recursive: true, force: true });
    });

    afterAll(async () => {
      for (const n of sesionesCreadas) await api('DELETE', `/api/sessions/${n}`, undefined, { 'X-Jdev-Confirm': 'yes' });
      rmSync(join(tmp, 'claude', 'projects', 'foo-slug'), { recursive: true, force: true });
    });

    it('exige token, Origin propio y PUT, y valida el nombre y el título', async () => {
      const nombre = await crear();
      const ruta = `/api/sessions/${nombre}/title`;
      expect((await fetch(`${base}${ruta}`, { method: 'PUT', body: '{"title":"x"}' })).status).toBe(401);
      expect((await api('PUT', ruta, { title: 'x' }, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await api('GET', ruta)).status).toBe(405);
      expect((await api('POST', ruta, { title: 'x' })).status).toBe(405);
      expect((await api('PUT', '/api/sessions/otra/title', { title: 'x' })).status).toBe(400);
      expect((await api('PUT', '/api/sessions/jdev-nada-7/title', { title: 'x' })).status).toBe(404);
      expect((await titulo(nombre)).status).toBe(400);
      const mala = await fetch(`${base}${ruta}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' });
      expect(mala.status).toBe(400);
      for (const malo of [undefined, 3, '', '   ', 'a'.repeat(81), 'con\nsalto', 'con\ttab', 'nulo\0', 'sep ador']) {
        const r = await renombrar(nombre, malo);
        expect(r.status, JSON.stringify(malo)).toBe(400);
        expect(((await r.json()) as { error: string }).error).toMatch(/título|Escribe/i);
      }
      // 80 puntos de código valen aunque ocupen más unidades UTF-16.
      expect((await renombrar(nombre, '😀'.repeat(80))).status).toBe(200);
      expect((await renombrar(nombre, '😀'.repeat(81))).status).toBe(400);
    });

    it('sin transcript guarda el título en la sesión de tmux, lo usa en la lista y lo emite', async () => {
      const nombre = await crear();
      const eventos: { type: string; sessions?: Sesion[] }[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: wsHeaders() });
      ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
      await vi.waitFor(() => expect(eventos.some((e) => e.type === 'sessions')).toBe(true));
      try {
        const nuevo = '-Revisar "login" \\ ñ 😀;';
        const r = await renombrar(nombre, `  ${nuevo}  `);
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ renamed: true, name: nombre, title: nuevo });
        expect((await tmuxCli('show-options', '-v', '-t', `=${nombre}:`, '@jdev_title')).stdout.trimEnd()).toBe(nuevo);
        expect((await lista()).find((s) => s.name === nombre)).toMatchObject({ title: nuevo, done: null });
        await vi.waitFor(() => expect(eventos.at(-1)?.sessions?.find((s) => s.name === nombre)?.title).toBe(nuevo));
        // El título propio también se impone al generado por Claude cuando aún no hay custom-title.
        const transcript = join(proyectosClaude(), `${idClaude}.jsonl`);
        mkdirSync(proyectosClaude(), { recursive: true });
        writeFileSync(transcript, '{"type":"user"}\n{"type":"ai-title","aiTitle":"Título de IA","sessionId":"x"}\n');
        estado(nombre, transcript);
        await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)?.tracked).toBe(true));
        expect((await lista()).find((s) => s.name === nombre)?.title).toBe(nuevo);
      } finally {
        ws.close();
      }
    });

    it('con transcript de Claude añade una línea custom-title con el formato de bin/session-title y ya no conserva «[Closed] »', async () => {
      const nombre = await crear('claude');
      const transcript = join(proyectosClaude(), `${idClaude}.jsonl`);
      mkdirSync(proyectosClaude(), { recursive: true });
      writeFileSync(transcript, '{"type":"user"}\n{"type":"custom-title","customTitle":"[Closed] Viejo","sessionId":"x"}\n');
      estado(nombre, transcript);
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)).toMatchObject({ tracked: true, title: 'Viejo', done: { at: null, by: 'agent', note: null } }));

      const nuevo = 'Título "nuevo" con \\ y ñ — ok';
      expect((await renombrar(nombre, nuevo)).status).toBe(200);
      expect(ultimaLinea(transcript)).toBe(JSON.stringify({ type: 'custom-title', customTitle: nuevo, sessionId: idClaude }));
      // El título nuevo ya no lleva la marca antigua, así que la conversación deja de contar como hecha.
      expect((await lista()).find((s) => s.name === nombre)).toMatchObject({ title: nuevo, done: null });
      // No se toca la opción de tmux cuando hay transcript.
      expect((await tmuxCli('show-options', '-v', '-t', `=${nombre}:`, '@jdev_title').catch(() => ({ stdout: '' }))).stdout.trim()).toBe('');

      // Un título que empieza por «[Closed]» se escribe tal cual: es texto.
      expect((await renombrar(nombre, '[Closed] Texto')).status).toBe(200);
      expect(ultimaLinea(transcript)).toBe(JSON.stringify({ type: 'custom-title', customTitle: '[Closed] Texto', sessionId: idClaude }));

      // Sin la marca, se escribe tal cual.
      writeFileSync(transcript, '{"type":"user"}\n{"type":"custom-title","customTitle":"Abierta","sessionId":"x"}\n');
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)).toMatchObject({ title: 'Abierta', done: null }));
      expect((await renombrar(nombre, 'Otra')).status).toBe(200);
      expect(ultimaLinea(transcript)).toBe(JSON.stringify({ type: 'custom-title', customTitle: 'Otra', sessionId: idClaude }));
      expect((await lista()).find((s) => s.name === nombre)?.title).toBe('Otra');

      // Un transcript sin salto de línea final no se corrompe.
      writeFileSync(transcript, '{"type":"user"}');
      expect((await renombrar(nombre, 'Sin salto')).status).toBe(200);
      expect(readFileSync(transcript, 'utf8')).toBe(
        `{"type":"user"}\n${JSON.stringify({ type: 'custom-title', customTitle: 'Sin salto', sessionId: idClaude })}\n`,
      );
    });

    it('escribe la misma línea que bin/session-title', async () => {
      const nombre = await crear('claude');
      const titulos = ['Simple', 'Con "comillas" y \\ barra', 'Acentos ñ é 😀', '{"x":1}'];
      for (const t of titulos) {
        const transcript = join(proyectosClaude(), `${idClaude}.jsonl`);
        mkdirSync(proyectosClaude(), { recursive: true });
        writeFileSync(transcript, '{"type":"user"}\n');
        estado(nombre, transcript);
        await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)?.tracked).toBe(true));
        expect((await renombrar(nombre, t)).status).toBe(200);
        const nuestra = ultimaLinea(transcript);

        // El script del harness, con un CLAUDE_CONFIG_DIR temporal, sobre una copia del transcript.
        const otro = join(tmp, 'claude-script');
        mkdirSync(join(otro, 'projects', 'x'), { recursive: true });
        writeFileSync(join(otro, 'projects', 'x', `${idClaude}.jsonl`), '{"type":"user"}\n');
        await execFileAsync('sh', [join(REAL_HARNESS, 'bin', 'session-title'), t], {
          env: { PATH: process.env.PATH, HOME: tmp, CLAUDE_CONFIG_DIR: otro, CLAUDE_CODE_SESSION_ID: idClaude },
        });
        expect(nuestra).toBe(ultimaLinea(join(otro, 'projects', 'x', `${idClaude}.jsonl`)));
        rmSync(otro, { recursive: true, force: true });
      }
    });

    it('rechaza un transcript fuera del directorio de Claude (también por enlace simbólico) sin tocarlo', async () => {
      const nombre = await crear('claude');
      const fuera = join(tmp, 'fuera.jsonl');
      writeFileSync(fuera, '{"type":"user"}\n');
      estado(nombre, fuera);
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)?.tracked).toBe(true));
      const r = await renombrar(nombre, 'Nuevo');
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: string }).error).toMatch(/directorio de proyectos de Claude/);
      expect(readFileSync(fuera, 'utf8')).toBe('{"type":"user"}\n');

      mkdirSync(proyectosClaude(), { recursive: true });
      const enlace = join(proyectosClaude(), `${idClaude}.jsonl`);
      symlinkSync(fuera, enlace);
      estado(nombre, enlace);
      expect((await renombrar(nombre, 'Nuevo')).status).toBe(409);
      expect(readFileSync(fuera, 'utf8')).toBe('{"type":"user"}\n');
      rmSync(enlace);

      // Con ".." dentro de la ruta, tampoco.
      estado(nombre, join(proyectosClaude(), '..', '..', '..', 'fuera.jsonl'));
      expect((await renombrar(nombre, 'Nuevo')).status).toBe(409);
      expect(readFileSync(fuera, 'utf8')).toBe('{"type":"user"}\n');
      // Y un archivo que no es .jsonl dentro del directorio permitido.
      const otroTipo = join(proyectosClaude(), 'notas.txt');
      writeFileSync(otroTipo, 'x\n');
      estado(nombre, otroTipo);
      expect((await renombrar(nombre, 'Nuevo')).status).toBe(409);
      expect(readFileSync(otroTipo, 'utf8')).toBe('x\n');
    });

    it('un transcript aún inexistente (Claude sin transcript todavía) usa la opción de tmux', async () => {
      const nombre = await crear('claude');
      estado(nombre, join(proyectosClaude(), `${idClaude}.jsonl`));
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)?.tracked).toBe(true));
      expect((await renombrar(nombre, 'Pronto')).status).toBe(200);
      expect((await lista()).find((s) => s.name === nombre)?.title).toBe('Pronto');
      expect(existsSync(join(proyectosClaude(), `${idClaude}.jsonl`))).toBe(false);
    });
  });

  describe('estado de conversación (hecha o abierta)', () => {
    const idPanel = '55555555-aaaa-4bbb-8ccc-000000000005';
    const idAnterior = '66666666-aaaa-4bbb-8ccc-000000000006';
    const creadas: string[] = [];
    const lista = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: (Sesion & { created: number })[] }).sessions;
    const crear = async (agent: 'claude' | 'codex' | 'shell' = 'codex') => {
      const r = await api('POST', '/api/sessions', { project: 'foo', agent });
      expect(r.status).toBe(201);
      const { session } = (await r.json()) as { session: Sesion };
      creadas.push(session.name);
      return session;
    };
    const poner = (clave: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
      api('PUT', `/api/conversations/${encodeURIComponent(clave)}/state`, cuerpo, headers);
    const carpeta = () => join(tmp, 'conversations');
    const dirClaude = () => join(tmp, 'claude', 'projects', projectSlug(join(tmp, 'harness', 'projects', 'foo')));
    const ultimaLinea = (ruta: string) => readFileSync(ruta, 'utf8').trimEnd().split('\n').at(-1);
    type Reciente = { id: string; title: string; done: { at: string | null; by: string; note: string | null } | null };
    const recientes = async () => ((await (await api('GET', '/api/recent')).json()) as { recent: Reciente[] }).recent;

    afterAll(async () => {
      for (const n of creadas) await api('DELETE', `/api/sessions/${n}`, undefined, { 'X-Jdev-Confirm': 'yes' });
      rmSync(join(tmp, 'state', `${idPanel}.json`), { force: true });
      rmSync(carpeta(), { recursive: true, force: true });
      rmSync(dirClaude(), { recursive: true, force: true });
    });

    it('exige token, Origin propio y PUT, y valida la clave y el cuerpo', async () => {
      const clave = 'tmux-jdev-foo-1-1730000000';
      const ruta = `/api/conversations/${clave}/state`;
      expect((await fetch(`${base}${ruta}`, { method: 'PUT', body: '{"state":"done"}' })).status).toBe(401);
      expect((await poner(clave, { state: 'done' }, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await api('GET', ruta)).status).toBe(405);
      expect((await api('POST', ruta, { state: 'done' })).status).toBe(405);
      for (const mala of ['nada', 'jdev-foo-1', '../x', 'tmux-otra-1-1', idPanel.toUpperCase(), 'tmux-jdev-foo-1']) {
        expect((await poner(mala, { state: 'done' })).status, mala).toBe(400);
      }
      // Claves bien formadas pero que el panel no conoce.
      expect((await poner(idPanel, { state: 'done' })).status).toBe(404);
      expect((await poner(clave, { state: 'done' })).status).toBe(404);
      const sesion = await crear();
      for (const malo of [{}, { state: 'hecha' }, { state: 3 }, { state: 'open', note: 'x' }, { state: 'done', note: 3 }, { state: 'done', note: 'a\nb' }, { state: 'done', note: 'a'.repeat(501) }]) {
        expect((await poner(sesion.conversationKey, malo)).status, JSON.stringify(malo)).toBe(400);
      }
      expect((await poner(sesion.conversationKey, [])).status).toBe(400);
      const mala = await fetch(`${base}/api/conversations/${sesion.conversationKey}/state`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' });
      expect(mala.status).toBe(400);
      expect(existsSync(carpeta())).toBe(false);
    });

    it('marca y reabre una sesión sin conversación de Claude, con clave de tmux, y lo emite', async () => {
      const sesion = await crear();
      const creada = (await lista()).find((s) => s.name === sesion.name)!.created;
      expect(sesion.conversationKey).toBe(`tmux-${sesion.name}-${creada}`);
      expect(sesion.done).toBeNull();
      const eventos: { type: string; sessions?: Sesion[] }[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: wsHeaders() });
      ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
      await vi.waitFor(() => expect(eventos.some((e) => e.type === 'sessions')).toBe(true));
      try {
        const antes = Date.now();
        const r = await poner(sesion.conversationKey, { state: 'done', note: '  Integrada en main  ' });
        expect(r.status).toBe(200);
        const cuerpo = (await r.json()) as { key: string; state: string; done: { at: string; by: string; note: string } };
        expect(cuerpo).toMatchObject({ key: sesion.conversationKey, state: 'done', done: { by: 'user', note: 'Integrada en main' } });
        expect(Date.parse(cuerpo.done.at)).toBeGreaterThanOrEqual(antes - 1000);
        // Es lo que lee bin/session-title --hook: JSON compacto con state, at, by y note.
        const archivo = join(carpeta(), `${sesion.conversationKey}.json`);
        expect(JSON.parse(readFileSync(archivo, 'utf8'))).toEqual({ state: 'done', at: cuerpo.done.at, by: 'user', note: 'Integrada en main' });
        expect(readFileSync(archivo, 'utf8')).toContain('"state":"done"');
        expect((await lista()).find((s) => s.name === sesion.name)?.done).toEqual(cuerpo.done);
        await vi.waitFor(() => expect(eventos.at(-1)?.sessions?.find((s) => s.name === sesion.name)?.done?.note).toBe('Integrada en main'));
        // Ni se termina ni se archiva.
        expect((await lista()).find((s) => s.name === sesion.name)).toMatchObject({ alive: true, archived: false });
        // Sin temporales olvidados.
        expect(readdirSync(carpeta()).filter((n) => n.startsWith('.'))).toEqual([]);

        const o = await poner(sesion.conversationKey, { state: 'open' });
        expect(o.status).toBe(200);
        expect(await o.json()).toEqual({ key: sesion.conversationKey, state: 'open', done: null });
        expect(JSON.parse(readFileSync(archivo, 'utf8'))).toMatchObject({ state: 'open', by: 'user' });
        expect((await lista()).find((s) => s.name === sesion.name)?.done).toBeNull();
        await vi.waitFor(() => expect(eventos.at(-1)?.sessions?.find((s) => s.name === sesion.name)?.done).toBeNull());
      } finally {
        ws.close();
      }
    });

    it('lee el estado guardado con la clave de tmux en segundos (formato anterior) hasta que haya uno más nuevo', async () => {
      const sesion = await crear();
      const creada = (await lista()).find((s) => s.name === sesion.name)!.created;
      mkdirSync(carpeta(), { recursive: true });
      const antigua = join(carpeta(), `tmux-${sesion.name}-${Math.floor(creada / 1000)}.json`);
      writeFileSync(antigua, '{"state":"done","at":"2026-11-05T15:20:00Z","by":"agent"}\n');
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === sesion.name)?.done).toMatchObject({ by: 'agent' }));
      // El estado con la clave nueva manda sobre el antiguo.
      expect((await poner(sesion.conversationKey, { state: 'open' })).status).toBe(200);
      expect((await lista()).find((s) => s.name === sesion.name)?.done).toBeNull();
      rmSync(antigua, { force: true });
    });

    it('rechaza una terminal sin agente', async () => {
      vi.stubEnv('SHELL', '/bin/sh');
      try {
        const sesion = await crear('shell');
        expect((await poner(sesion.conversationKey, { state: 'done' })).status).toBe(400);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('usa el id de Claude como clave en una sesión con conversación y reabre quitando la marca antigua', async () => {
      const sesion = await crear('claude');
      mkdirSync(dirClaude(), { recursive: true });
      const transcript = join(dirClaude(), `${idPanel}.jsonl`);
      writeFileSync(transcript, '{"type":"user"}\n{"type":"custom-title","customTitle":"[Closed] Con marca","sessionId":"x"}\n');
      mkdirSync(join(tmp, 'state'), { recursive: true });
      writeFileSync(
        join(tmp, 'state', `${idPanel}.json`),
        JSON.stringify({ session_id: idPanel, state: 'idle', event: 'Stop', updated_at: new Date(Date.now() + 2000).toISOString(), project: 'foo', agent: 'claude', worktree: '', transcript_path: transcript, cwd: tmp, tmux_session: sesion.name }),
      );
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === sesion.name)).toMatchObject({ tracked: true, conversationKey: idPanel, title: 'Con marca', done: { at: null, by: 'agent', note: null } }));

      expect((await poner(idPanel, { state: 'open' })).status).toBe(200);
      expect(JSON.parse(ultimaLinea(transcript)!)).toEqual({ type: 'custom-title', customTitle: 'Con marca', sessionId: idPanel });
      expect((await lista()).find((s) => s.name === sesion.name)).toMatchObject({ title: 'Con marca', done: null });
      // Con el título ya limpio no se añade nada más.
      const lineas = readFileSync(transcript, 'utf8').split('\n').length;
      expect((await poner(idPanel, { state: 'open' })).status).toBe(200);
      expect(readFileSync(transcript, 'utf8').split('\n').length).toBe(lineas);

      expect((await poner(idPanel, { state: 'done', note: 'Revisada' })).status).toBe(200);
      expect((await lista()).find((s) => s.name === sesion.name)?.done).toMatchObject({ by: 'user', note: 'Revisada' });
    });

    it('marca y reabre una conversación de «Anteriores», y refleja lo que escribe otro proceso', async () => {
      mkdirSync(dirClaude(), { recursive: true });
      const transcript = join(dirClaude(), `${idAnterior}.jsonl`);
      writeFileSync(transcript, '{"type":"user","message":{"content":"hola"}}\n{"type":"custom-title","customTitle":"[Closed] Vieja","sessionId":"x"}\n');
      expect((await recientes()).find((r) => r.id === idAnterior)).toMatchObject({ title: 'Vieja', done: { at: null, by: 'agent', note: null } });

      const eventos: { type: string }[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: wsHeaders() });
      ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
      await vi.waitFor(() => expect(eventos.length).toBeGreaterThan(0));
      try {
        expect((await poner(idAnterior, { state: 'open' })).status).toBe(200);
        expect(JSON.parse(ultimaLinea(transcript)!)).toEqual({ type: 'custom-title', customTitle: 'Vieja', sessionId: idAnterior });
        expect((await recientes()).find((r) => r.id === idAnterior)).toMatchObject({ title: 'Vieja', done: null });
        await vi.waitFor(() => expect(eventos.some((e) => e.type === 'conversations')).toBe(true));

        // El agente (bin/session-done) escribe el archivo sin pasar por el servidor.
        eventos.length = 0;
        writeFileSync(join(carpeta(), `${idAnterior}.json`), '{"state":"done","at":"2026-11-05T15:20:00Z","by":"agent","note":"Integrada"}\n');
        await vi.waitFor(() => expect(eventos.some((e) => e.type === 'conversations')).toBe(true));
        expect((await recientes()).find((r) => r.id === idAnterior)?.done).toEqual({ at: '2026-11-05T15:20:00.000Z', by: 'agent', note: 'Integrada' });

        // Un archivo mal formado o con otro nombre se ignora.
        writeFileSync(join(carpeta(), `${idAnterior}.json`), '{"state":"hecha"}');
        writeFileSync(join(carpeta(), 'otra-cosa.json'), '{"state":"done","at":"2026-11-05T15:20:00Z","by":"agent"}');
        await vi.waitFor(async () => expect((await recientes()).find((r) => r.id === idAnterior)?.done).toBeNull());
      } finally {
        ws.close();
      }
    });
  });

  describe('terminal sin agente', () => {
    const creadas: string[] = [];
    const lista = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
    const pedir = (cuerpo: unknown) => api('POST', '/api/sessions', cuerpo);
    const proyecto = () => join(tmp, 'harness', 'projects', 'foo');

    beforeAll(() => {
      vi.stubEnv('SHELL', '/bin/sh');
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      for (const n of creadas) await api('DELETE', `/api/sessions/${n}`, undefined, { 'X-Jdev-Confirm': 'yes' });
      rmSync(join(tmp, 'state', 'term.json'), { force: true });
    });

    it('muestra el comando equivalente sin ejecutar nada', async () => {
      const r = await pedir({ project: 'foo', agent: 'shell', dryRun: true });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ dryRun: true, command: `cd ${proyecto()} && /bin/sh -l`, args: [] });
    });

    it('rechaza worktree nuevo, prompt y retomar con 400', async () => {
      const malo = async (cuerpo: unknown) => {
        const r = await pedir({ project: 'foo', agent: 'shell', ...(cuerpo as object) });
        expect(r.status).toBe(400);
        return ((await r.json()) as { error: string }).error;
      };
      expect(await malo({ location: 'new-worktree', feature: 'x' })).toMatch(/no crea worktrees/);
      expect(await malo({ prompt: 'hola' })).toMatch(/no admite prompt/);
      expect(await malo({ resume: '0a1b2c3d-1111-4222-8333-444455556666' })).toMatch(/no retoma/);
      expect(await malo({ location: 'existing-worktree', feature: 'no-existe' })).toMatch(/no existe/);
      expect((await lista()).length).toBe(0);
    });

    it('abre una shell en la carpeta del proyecto, sin estado, y en la del worktree', async () => {
      const r = await pedir({ project: 'foo', agent: 'shell' });
      expect(r.status).toBe(201);
      const { session } = (await r.json()) as { session: Sesion };
      creadas.push(session.name);
      expect(session).toMatchObject({ project: 'foo', agent: 'shell', worktree: '', title: 'foo · Nueva terminal', state: 'alive', tracked: false, alive: true });
      // La shell de login ejecuta antes /etc/profile, que puede lanzar otros programas (el «find» del
      // aviso diario de Ubuntu): se espera a que el proceso en primer plano vuelva a ser la shell.
      await vi.waitFor(
        async () => {
          const datos = (await tmuxCli('display-message', '-p', '-t', `=${session.name}:`, '#{pane_current_path}|#{@jdev_agent}|#{pane_current_command}')).stdout.trim();
          expect(datos).toBe(`${realpathSync(proyecto())}|shell|sh`);
        },
        { timeout: 5000, interval: 50 },
      );
      expect((await tmuxCli('show-environment', '-t', `=${session.name}`, 'JDEV_SURFACE')).stdout.trim()).toBe('JDEV_SURFACE=panel');

      const wt = await pedir({ project: 'foo', agent: 'shell', location: 'existing-worktree', feature: 'mi-feature' });
      expect(wt.status).toBe(201);
      const { session: enWt } = (await wt.json()) as { session: Sesion };
      creadas.push(enWt.name);
      expect(enWt.worktree).toBe('mi-feature');
      expect((await tmuxCli('display-message', '-p', '-t', `=${enWt.name}:`, '#{pane_current_path}')).stdout.trim()).toBe(
        realpathSync(join(tmp, 'harness', 'projects', 'foo.worktrees', 'mi-feature')),
      );
    });

    it('ignora un estado de hooks atribuido a la sesión y se puede renombrar', async () => {
      const nombre = creadas[0]!;
      mkdirSync(join(tmp, 'state'), { recursive: true });
      writeFileSync(
        join(tmp, 'state', 'term.json'),
        JSON.stringify({
          session_id: 'term',
          state: 'waiting',
          event: 'Notification',
          updated_at: new Date(Date.now() + 2000).toISOString(),
          project: 'foo',
          agent: 'claude',
          worktree: '',
          transcript_path: '',
          cwd: tmp,
          tmux_session: nombre,
          message: 'permiso',
        }),
      );
      await new Promise((ok) => setTimeout(ok, 700));
      expect((await lista()).find((s) => s.name === nombre)).toMatchObject({ state: 'alive', tracked: false, notice: '', usage: null, activity: null });

      expect((await api('PUT', `/api/sessions/${nombre}/title`, { title: 'Servidor dev' })).status).toBe(200);
      expect((await lista()).find((s) => s.name === nombre)?.title).toBe('Servidor dev');
    });

    it('no cuenta en la actividad de Inicio', async () => {
      const resumen = (await (await api('GET', '/api/overview')).json()) as { projects: { id: string; lastActivity: number }[] };
      const foo = resumen.projects.find((p) => p.id === 'foo')!;
      const creada = Math.max(...(await lista()).filter((s) => s.agent === 'shell').map((s) => s.updatedAt));
      expect(foo.lastActivity).toBeLessThan(creada);
    });

    it('termina como las demás sesiones cuando la shell acaba', async () => {
      const nombre = creadas[1]!;
      await tmuxCli('send-keys', '-t', `=${nombre}:`, 'exit', 'Enter');
      await vi.waitFor(async () => expect((await lista()).find((s) => s.name === nombre)).toMatchObject({ alive: false, state: 'ended' }));
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

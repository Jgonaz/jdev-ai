import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';
import { lanzamientoShell, subagenteMuestra, texto } from './follow-fixtures.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Seguimiento = {
  error?: string;
  kind?: string;
  state?: string;
  from?: number;
  more?: boolean;
  reset?: boolean;
  meta?: { description?: string | null; agentType?: string; command?: string };
  events?: { type: string }[];
  text?: string;
};

describe('GET /api/sessions/:name/follow/:kind/:id', () => {
  const token = 'e'.repeat(64);
  const sock = `jdev-test-follow-${process.pid}-${Date.now().toString(36)}`;
  const sid = 'abc-follow-1';
  const agente = 'a0c02c875dad9fa1e';
  const shell = 'beifl810b';
  let tmp: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let claude = '';
  let transcript = '';
  let salida = '';
  const auth = { Authorization: `Bearer ${token}` };
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });
  const api = (metodo: string, ruta: string) => fetch(`${base}${ruta}`, { method: metodo, headers: auth });
  const seguir = async (kind: string, id: string, from?: number, nombre = claude) => {
    const r = await api('GET', `/api/sessions/${encodeURIComponent(nombre)}/follow/${kind}/${id}${from === undefined ? '' : `?from=${from}`}`);
    return { status: r.status, body: (await r.json()) as Seguimiento };
  };

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-follow-api-'));
    const estado = join(tmp, 'jdev-ai', 'sessions');
    const actividad = join(tmp, 'jdev-ai', 'activity');
    const harness = join(tmp, 'harness');
    const proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', proy]);
    mkdirSync(join(tmp, 'dist'));
    cfg = tmuxConfig(harness, {}, { socket: sock, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'), launcher: () => ['sh', '-c', 'sleep 120'] });
    const uid = process.getuid!();
    transcript = join(tmp, 'claude', 'projects', '-proj', `${sid}.jsonl`);
    const subagentes = join(tmp, 'claude', 'projects', '-proj', sid, 'subagents');
    const salidas = join(tmp, 'tmproot', `claude-${uid}`, '-proj', 'otro', 'tasks');
    salida = join(salidas, `${shell}.output`);
    mkdirSync(subagentes, { recursive: true });
    mkdirSync(salidas, { recursive: true });
    writeFileSync(transcript, lanzamientoShell(shell, salida) + '\n');
    writeFileSync(join(subagentes, `agent-${agente}.jsonl`), subagenteMuestra());
    writeFileSync(join(subagentes, `agent-${agente}.meta.json`), JSON.stringify({ agentType: 'implementer', description: 'Ajustar el input', finished: false }));
    writeFileSync(salida, 'servidor listo\n');

    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: estado,
      claudeConfigDir: join(tmp, 'claude'),
      claudeTmpRoots: [join(tmp, 'tmproot')],
      pollMs: 200,
      stateFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
    const r = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'foo', agent: 'claude', location: 'main' }) });
    claude = ((await r.json()) as { session: { name: string } }).session.name;
    mkdirSync(estado, { recursive: true });
    writeFileSync(
      join(estado, `${sid}.json`),
      JSON.stringify({
        session_id: sid,
        state: 'working',
        event: 'UserPromptSubmit',
        updated_at: new Date(Date.now() + 1000).toISOString(),
        project: 'foo',
        agent: 'claude',
        worktree: '',
        transcript_path: transcript,
        cwd: '/home/u/proyecto',
        tmux_session: claude,
        message: '',
      }),
    );
    mkdirSync(actividad, { recursive: true });
    const ahora = new Date().toISOString();
    writeFileSync(
      join(actividad, `${sid}.jsonl`),
      [
        { jdev_at: ahora, hook_event_name: 'SubagentStart', agent_id: agente, agent_type: 'implementer' },
        { jdev_at: ahora, hook_event_name: 'Stop', background_tasks: [{ id: shell, type: 'shell', status: 'running', command: 'pnpm dev' }] },
      ]
        .map((l) => JSON.stringify({ session_id: sid, ...l }))
        .join('\n') + '\n',
    );
    await vi.waitFor(async () => expect((await seguir('agent', agente)).status).toBe(200));
  });

  afterAll(async () => {
    await srv.close();
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

  it('exige el token y solo admite GET', async () => {
    expect((await fetch(`${base}/api/sessions/${claude}/follow/agent/${agente}`)).status).toBe(401);
    expect((await api('POST', `/api/sessions/${claude}/follow/agent/${agente}`)).status).toBe(405);
  });

  it('sirve el seguimiento de un subagente de la sesión, ya interpretado', async () => {
    const { status, body } = await seguir('agent', agente);
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'agent', state: 'running', meta: { description: 'Ajustar el input', agentType: 'implementer' }, more: false });
    expect(body.events?.[0]).toMatchObject({ type: 'task' });
    expect(JSON.stringify(body)).not.toContain('signature');
    // Lo nuevo llega desde `from`, sin repetir lo anterior.
    appendFileSync(join(tmp, 'claude', 'projects', '-proj', sid, 'subagents', `agent-${agente}.jsonl`), texto('Fin') + '\n');
    const mas = await seguir('agent', agente, body.from);
    expect(mas.body.events).toEqual([{ type: 'message', text: 'Fin', at: expect.any(Number) }]);
  });

  it('sirve la salida de una shell: la cola la primera vez y lo nuevo después', async () => {
    const { status, body } = await seguir('shell', shell);
    expect(status).toBe(200);
    expect(body).toMatchObject({ kind: 'shell', state: 'running', text: 'servidor listo\n', meta: { command: 'pnpm dev' } });
    appendFileSync(salida, 'otra línea\n');
    expect((await seguir('shell', shell, body.from)).body.text).toBe('otra línea\n');
  });

  it('rechaza sesiones que no son del panel, ids no válidos y un `from` que no es un número', async () => {
    expect((await seguir('agent', agente, undefined, 'otra-cosa')).status).toBe(400);
    expect((await seguir('agent', 'ID%20MAL')).status).toBe(400);
    expect((await seguir('agent', 'AAAA')).status).toBe(400);
    expect((await seguir('agent', agente, undefined, `${claude}%2F..`)).status).toBe(400);
    expect((await api('GET', `/api/sessions/${claude}/follow/agent/${agente}?from=-1`)).status).toBe(400);
    expect((await api('GET', `/api/sessions/${claude}/follow/agent/${agente}?from=abc`)).status).toBe(400);
    expect((await api('GET', `/api/sessions/${claude}/follow/otro/${agente}`)).status).toBe(404);
  });

  it('404 con explicación si la sesión no existe, el id no consta o el archivo falta', async () => {
    const sinSesion = await seguir('agent', agente, undefined, 'jdev-foo-9999');
    expect(sinSesion.status).toBe(404);
    expect(sinSesion.body.error).toMatch(/No hay datos que mostrar/);
    expect((await seguir('agent', 'zzzz')).status).toBe(404);
    expect((await seguir('shell', 'zzzz')).status).toBe(404);
  });

  it('no sirve un archivo que sea un enlace simbólico a algo fuera de las carpetas de Claude', async () => {
    const secreto = join(tmp, 'secreto.txt');
    writeFileSync(secreto, 'SECRETO\n');
    rmSync(salida);
    symlinkSync(secreto, salida);
    const r = await seguir('shell', shell);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('SECRETO');
  });

  it('una tubería (FIFO) como salida o como transcript da 404 sin colgar el resto de peticiones', async () => {
    rmSync(salida);
    execFileSync('mkfifo', [salida]);
    expect((await seguir('shell', shell)).status).toBe(404);
    expect((await seguir('agent', agente)).status).toBe(200);
    const subagente = join(tmp, 'claude', 'projects', '-proj', sid, 'subagents', `agent-${agente}.jsonl`);
    rmSync(subagente);
    execFileSync('mkfifo', [subagente]);
    expect((await seguir('agent', agente)).status).toBe(404);
    expect((await api('GET', '/api/sessions')).status).toBe(200);
  });
});

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';
import { statuslineMuestra } from './statusline-fixtures.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Sesion = {
  name: string;
  agent: string;
  tracked: boolean;
  usage: { model: string | null; effort: string | null; context: { used: number | null; size: number | null; percent: number | null } | null; updatedAt: number } | null;
  activity: { subagents: { id: string; type: string; since: number | null }[]; shells: { label: string; id?: string }[]; artifacts: { url: string; title: string | null }[] } | null;
};
type Cuenta = { fiveHour: { percent: number; resetsAt: number | null } | null; sevenDay: { percent: number } | null; updatedAt: number } | null;

describe('statusline y actividad de las sesiones de Claude', () => {
  const token = 'f'.repeat(64);
  const sock = `jdev-test-statusline-${process.pid}-${Date.now().toString(36)}`;
  let tmp: string;
  let estado: string;
  let statusline: string;
  let actividad: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let ws: WebSocket;
  const eventos: { type: string; sessions?: Sesion[]; account?: Cuenta }[] = [];
  const auth = { Authorization: `Bearer ${token}` };
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });
  const api = (metodo: string, ruta: string, cuerpo?: unknown) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const lista = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
  const cuenta = async () => ((await (await api('GET', '/api/account')).json()) as { account: Cuenta }).account;
  const crear = async (agent: string) => {
    const r = await api('POST', '/api/sessions', { project: 'foo', agent, location: 'main' });
    expect(r.status).toBe(201);
    return ((await r.json()) as { session: { name: string } }).session.name;
  };
  const escribirEstado = (id: string, sesion: string, extra: Record<string, unknown> = {}) => {
    mkdirSync(estado, { recursive: true });
    writeFileSync(
      join(estado, `${id}.json`),
      JSON.stringify({
        session_id: id,
        state: 'working',
        event: 'UserPromptSubmit',
        updated_at: new Date(Date.now() + 1000).toISOString(),
        project: 'foo',
        agent: 'claude',
        worktree: '',
        transcript_path: '',
        cwd: tmp,
        tmux_session: sesion,
        message: '',
        ...extra,
      }),
    );
  };
  const escribirStatusline = (id: string, extra: Record<string, unknown> = {}) => {
    mkdirSync(statusline, { recursive: true });
    writeFileSync(join(statusline, `${id}.json`), JSON.stringify(statuslineMuestra({ session_id: id, ...extra })));
  };
  const registrar = (id: string, ...lineas: Record<string, unknown>[]) => {
    mkdirSync(actividad, { recursive: true });
    writeFileSync(join(actividad, `${id}.jsonl`), lineas.map((l) => JSON.stringify({ session_id: id, ...l })).join('\n') + '\n');
  };

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-statusline-'));
    estado = join(tmp, 'jdev-ai', 'sessions');
    statusline = join(tmp, 'jdev-ai', 'statusline');
    actividad = join(tmp, 'jdev-ai', 'activity');
    const harness = join(tmp, 'harness');
    const proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', proy]);
    mkdirSync(join(tmp, 'dist'));
    cfg = tmuxConfig(harness, {}, {
      socket: sock,
      confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'),
      launcher: () => ['sh', '-c', 'sleep 120'],
    });
    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: estado,
      claudeConfigDir: join(tmp, 'claude'),
      pollMs: 200,
      stateFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
    ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
    await vi.waitFor(() => expect(eventos.map((e) => e.type)).toEqual(['hello', 'sessions']));
  });

  afterAll(async () => {
    ws.close();
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

  it('exige token y solo admite GET en /api/account, que empieza sin datos', async () => {
    expect((await fetch(`${base}/api/account`)).status).toBe(401);
    expect((await api('POST', '/api/account', {})).status).toBe(405);
    expect(await cuenta()).toBeNull();
  });

  let claude = '';
  let codex = '';

  it('une usage y activity a la sesión por su session_id y publica los límites de la cuenta', async () => {
    claude = await crear('claude');
    codex = await crear('codex');
    // Antes de que escriba nada, la sesión de Claude no tiene datos.
    expect((await lista()).find((s) => s.name === claude)).toMatchObject({ usage: null, activity: null });

    escribirEstado('abc-1', claude);
    escribirStatusline('abc-1');
    registrar(
      'abc-1',
      { jdev_at: new Date().toISOString(), hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'qa' },
      { jdev_at: new Date().toISOString(), hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Explore' },
      { jdev_at: new Date().toISOString(), hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'Explore' },
      { jdev_at: new Date().toISOString(), hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'pnpm dev' }] },
      {
        jdev_at: new Date().toISOString(),
        hook_event_name: 'PostToolUse',
        tool_name: 'Artifact',
        tool_input: { file_path: '/p/x.html', title: 'Plan de pruebas' },
        tool_response: 'https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU',
      },
    );

    await vi.waitFor(async () => expect((await lista()).find((s) => s.name === claude)?.usage?.model).toBe('Opus 5.5'));
    const s = (await lista()).find((x) => x.name === claude)!;
    expect(s.usage).toMatchObject({ model: 'Opus 5.5', effort: 'medium', context: { used: 194000, size: 1000000, percent: 19 } });
    expect(s.activity).toEqual({
      subagents: [{ id: 'a1', type: 'qa', since: expect.any(Number) }],
      shells: [{ label: 'pnpm dev', id: 'b1' }],
      artifacts: [{ url: 'https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU', title: 'Plan de pruebas' }],
    });
    // Una sesión de Codex nunca tiene estos datos.
    expect((await lista()).find((x) => x.name === codex)).toMatchObject({ usage: null, activity: null });

    // /ws/events lleva lo mismo y avisa de los límites.
    await vi.waitFor(() => expect(eventos.filter((e) => e.type === 'sessions').at(-1)?.sessions?.find((x) => x.name === claude)?.usage?.model).toBe('Opus 5.5'));
    await vi.waitFor(() => expect(eventos.some((e) => e.type === 'account')).toBe(true));
    expect(eventos.filter((e) => e.type === 'account').at(-1)?.account).toMatchObject({
      fiveHour: { percent: 3.4, resetsAt: 1_790_000_000_000 },
      sevenDay: { percent: 22 },
    });
    expect(await cuenta()).toMatchObject({ fiveHour: { percent: 3.4 }, sevenDay: { percent: 22 } });
  });

  it('una statusline nueva actualiza el contexto y los límites, y lo empuja por /ws/events', async () => {
    const antes = eventos.length;
    escribirStatusline('abc-1', {
      context_window: { context_window_size: 1000000, used_percentage: 86, current_usage: { input_tokens: 860000 } },
      rate_limits: { five_hour: { used_percentage: 91, resets_at: 1_790_100_000 } },
    });
    await vi.waitFor(async () => expect((await lista()).find((s) => s.name === claude)?.usage?.context?.percent).toBe(86));
    await vi.waitFor(() => expect(eventos.slice(antes).filter((e) => e.type === 'account').at(-1)?.account).toMatchObject({ fiveHour: { percent: 91 }, sevenDay: null }));
    expect(await cuenta()).toMatchObject({ fiveHour: { percent: 91 }, sevenDay: null });
  });

  it('un SessionStart posterior deja sin efecto la actividad anterior', async () => {
    escribirEstado('abc-1', claude, { event: 'SessionStart', state: 'idle', updated_at: new Date(Date.now() + 60_000).toISOString() });
    await vi.waitFor(async () => expect((await lista()).find((s) => s.name === claude)?.activity).toBeNull());
    // Una actividad posterior sí se ve.
    registrar(
      'abc-1',
      { jdev_at: new Date(Date.now() - 120_000).toISOString(), hook_event_name: 'SubagentStart', agent_id: 'viejo', agent_type: 'qa' },
      { jdev_at: new Date(Date.now() + 61_000).toISOString(), hook_event_name: 'SubagentStart', agent_id: 'nuevo', agent_type: 'Explore' },
    );
    await vi.waitFor(async () => expect((await lista()).find((s) => s.name === claude)?.activity?.subagents.map((a) => a.id)).toEqual(['nuevo']));
  });

  it('ignora archivos no válidos, de otra sesión o enlaces simbólicos', async () => {
    escribirEstado('def-2', codex, { agent: 'claude' });
    writeFileSync(join(statusline, 'def-2.json'), '{"session_id":"def-2",');
    await new Promise((r) => setTimeout(r, 500));
    expect((await lista()).find((s) => s.name === codex)?.usage).toBeNull();
    // La statusline dice ser de otra sesión.
    writeFileSync(join(statusline, 'def-2.json'), JSON.stringify(statuslineMuestra({ session_id: 'otra' })));
    await new Promise((r) => setTimeout(r, 500));
    expect((await lista()).find((s) => s.name === codex)?.usage).toBeNull();
    // Un enlace simbólico a un JSON válido tampoco se lee.
    const fuera = join(tmp, 'fuera.json');
    writeFileSync(fuera, JSON.stringify(statuslineMuestra({ session_id: 'def-2' })));
    rmSync(join(statusline, 'def-2.json'));
    symlinkSync(fuera, join(statusline, 'def-2.json'));
    await new Promise((r) => setTimeout(r, 500));
    expect((await lista()).find((s) => s.name === codex)?.usage).toBeNull();
    rmSync(join(statusline, 'def-2.json'));
  });

  it('al terminar la sesión borra su statusline y su actividad, y los límites desaparecen', async () => {
    expect(existsSync(join(statusline, 'abc-1.json'))).toBe(true);
    expect(existsSync(join(actividad, 'abc-1.jsonl'))).toBe(true);
    expect((await api('DELETE', `/api/sessions/${claude}`, { confirm: true })).status).toBe(200);
    await vi.waitFor(() => {
      expect(existsSync(join(statusline, 'abc-1.json'))).toBe(false);
      expect(existsSync(join(actividad, 'abc-1.jsonl'))).toBe(false);
    });
    await vi.waitFor(async () => expect(await cuenta()).toBeNull());
    await vi.waitFor(() => expect(eventos.filter((e) => e.type === 'account').at(-1)?.account).toBeNull());
    // El archivo de estado, que no es de esta limpieza, se conserva.
    expect(existsSync(join(estado, 'abc-1.json'))).toBe(true);
  });
});

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Sesion = { name: string; project: string; agent: string; title: string; run: string | null; alive: boolean };
type Proyecto = { id: string; runCommand: string | null; runSource: string | null; runDetected: string | null };

// Arrancar y parar el servidor de desarrollo de un proyecto con un tmux propio y proyectos falsos.
describe('API de arranque de proyectos', () => {
  const token = 'b'.repeat(64);
  const sock = `jdev-test-run-${process.pid}-${Date.now().toString(36)}`;
  const shellPrevia = process.env.SHELL;
  let tmp: string;
  let harness: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  const auth = { Authorization: `Bearer ${token}` };
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });
  const api = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const sesiones = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
  const proyectos = async () => ((await (await api('GET', '/api/projects')).json()) as { projects: Proyecto[] }).projects;
  const arrancar = (id: string) => api('POST', `/api/projects/${id}/run`);
  const parar = (id: string) => api('DELETE', `/api/projects/${id}/run`);
  const ajustar = (parche: unknown) => api('PUT', '/api/settings', parche);
  const pantalla = (name: string) => tmuxCli('capture-pane', '-p', '-t', `=${name}:`).then((r) => r.stdout);
  const proyecto = (id: string, archivos: Record<string, string>) => {
    const dir = join(harness, 'projects', id);
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    for (const [n, c] of Object.entries(archivos)) writeFileSync(join(dir, n), c);
    return dir;
  };

  beforeAll(async () => {
    // Una shell conocida y sin configuración: así la prueba no depende de la de quien la ejecuta.
    process.env.SHELL = '/bin/sh';
    tmp = mkdtempSync(join(tmpdir(), 'jdev-run-api-'));
    harness = join(tmp, 'harness');
    mkdirSync(harness, { recursive: true });
    mkdirSync(join(tmp, 'dist'));
    // Con script dev y sin lockfile: npm run dev.
    proyecto('con-dev', { 'package.json': JSON.stringify({ scripts: { dev: 'node -e "console.log(\'dev-listo\');setInterval(()=>{},1000)"' } }) });
    proyecto('sin-dev', {});
    proyecto('rebelde', {});
    proyecto('comillas', {});
    cfg = tmuxConfig(harness, {}, { socket: sock, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf') });
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
      runStopWaitMs: 1500,
    });
    base = `http://127.0.0.1:${srv.port}`;
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
    if (shellPrevia === undefined) delete process.env.SHELL;
    else process.env.SHELL = shellPrevia;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('expone el comando efectivo y su origen en cada proyecto', async () => {
    const lista = await proyectos();
    expect(lista.find((p) => p.id === 'con-dev')).toMatchObject({ runCommand: 'npm run dev', runSource: 'detected', runDetected: 'npm run dev' });
    expect(lista.find((p) => p.id === 'sin-dev')).toMatchObject({ runCommand: null, runSource: null, runDetected: null });
  });

  it('exige token, origen propio y los métodos POST y DELETE', async () => {
    expect((await fetch(`${base}/api/projects/con-dev/run`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${base}/api/projects/con-dev/run`, { method: 'DELETE' })).status).toBe(401);
    const ajeno = await api('POST', '/api/projects/con-dev/run', undefined, { Origin: 'http://evil.example' });
    expect(ajeno.status).toBe(403);
    expect((await api('DELETE', '/api/projects/con-dev/run', undefined, { Origin: 'http://evil.example' })).status).toBe(403);
    const get = await api('GET', '/api/projects/con-dev/run');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, DELETE');
    expect((await api('PUT', '/api/projects/con-dev/run', {})).status).toBe(405);
    expect((await api('POST', '/api/projects/con-dev/run/otra')).status).toBe(404);
    expect(await sesiones()).toEqual([]);
  });

  it('responde 404 si el proyecto no existe y 409 si no tiene comando de arranque', async () => {
    expect((await arrancar('no-existe')).status).toBe(404);
    expect((await parar('no-existe')).status).toBe(404);
    expect((await arrancar('%E0%A4%A')).status).toBe(400);
    const r = await arrancar('sin-dev');
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/Ajustes › Proyectos/);
    expect(await sesiones()).toEqual([]);
    // Parar lo que no está en marcha no hace nada.
    const p = await parar('con-dev');
    expect(p.status).toBe(200);
    expect(await p.json()).toEqual({ stopped: false, graceful: false });
  });

  it('arranca el script dev detectado en una terminal sin agente, la marca y le pone título', async () => {
    const r = await arrancar('con-dev');
    expect(r.status).toBe(201);
    const { session, created } = (await r.json()) as { session: Sesion; created: boolean };
    expect(created).toBe(true);
    expect(session).toMatchObject({ project: 'con-dev', agent: 'shell', title: 'dev · con-dev', run: 'npm run dev', alive: true });
    // El comando se escribe en la shell (queda a la vista y en su historial) y arranca.
    await vi.waitFor(async () => expect(await pantalla(session.name)).toMatch(/dev-listo/), { timeout: 15000 });
    expect((await pantalla(session.name))).toMatch(/npm run dev/);
    expect((await tmuxCli('show-options', '-v', '-t', `=${session.name}:`, '@jdev_run')).stdout.trim()).toBe('npm run dev');
    const cwd = (await tmuxCli('display-message', '-p', '-t', `=${session.name}:`, '#{pane_current_path}')).stdout.trim();
    expect(cwd.endsWith('/projects/con-dev')).toBe(true);
    const viva = (await sesiones()).find((s) => s.name === session.name);
    expect(viva?.run).toBe('npm run dev');
  });

  it('pedir arrancar dos veces devuelve la misma terminal, también con peticiones simultáneas', async () => {
    const { session } = (await (await arrancar('con-dev')).json()) as { session: Sesion };
    const antes = (await sesiones()).filter((s) => s.run !== null);
    expect(antes).toHaveLength(1);
    const segunda = await arrancar('con-dev');
    expect(segunda.status).toBe(200);
    const cuerpo = (await segunda.json()) as { session: Sesion; created: boolean };
    expect(cuerpo.created).toBe(false);
    expect(cuerpo.session.name).toBe(session.name);
    expect((await sesiones()).filter((s) => s.run !== null)).toHaveLength(1);
  });

  it('para con Ctrl+C y termina la terminal, y vuelve a poder arrancarse', async () => {
    const t0 = Date.now();
    const r = await parar('con-dev');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ stopped: true, graceful: true });
    // Responde a Ctrl+C: no espera los 5 s.
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await sesiones()).toEqual([]);
    const otra = await arrancar('con-dev');
    expect(otra.status).toBe(201);
    expect((await parar('con-dev')).status).toBe(200);
  });

  it('tres peticiones simultáneas de arranque crean una sola terminal', async () => {
    const respuestas = await Promise.all([arrancar('con-dev'), arrancar('con-dev'), arrancar('con-dev')]);
    const cuerpos = await Promise.all(respuestas.map((r) => r.json() as Promise<{ session: Sesion; created: boolean }>));
    expect(cuerpos.filter((c) => c.created)).toHaveLength(1);
    expect(new Set(cuerpos.map((c) => c.session.name)).size).toBe(1);
    expect((await sesiones()).filter((s) => s.run !== null)).toHaveLength(1);
    expect((await parar('con-dev')).status).toBe(200);
  });

  it('un comando propio manda sobre el detectado y llega tal cual a la shell', async () => {
    expect((await ajustar({ projects: { 'con-dev': { run: 'echo propio-ok' } } })).status).toBe(200);
    const lista = await proyectos();
    expect(lista.find((p) => p.id === 'con-dev')).toMatchObject({ runCommand: 'echo propio-ok', runSource: 'custom', runDetected: 'npm run dev' });
    const { session } = (await (await arrancar('con-dev')).json()) as { session: Sesion };
    expect(session.run).toBe('echo propio-ok');
    await vi.waitFor(async () => expect(await pantalla(session.name)).toMatch(/^propio-ok$/m));
    // El comando propio también habilita proyectos sin script dev.
    expect((await parar('con-dev')).status).toBe(200);
    expect((await ajustar({ projects: { 'con-dev': { run: '' } } })).status).toBe(200);
    expect((await proyectos()).find((p) => p.id === 'con-dev')?.runSource).toBe('detected');
  });

  it('escribe el texto literal: ni teclas, ni variables, ni «;» finales se interpretan de más', async () => {
    const salida = join(tmp, 'literal.txt');
    // «Enter», «C-c» y «-l» deben llegar como texto; el «;» final no debe separar órdenes de tmux.
    const comando = `printf '%s' 'Enter C-c -l $HOME a;b %24 %25' > '${salida}';`;
    expect((await ajustar({ projects: { comillas: { run: comando } } })).status).toBe(200);
    const r = await arrancar('comillas');
    expect(r.status).toBe(201);
    const { session } = (await r.json()) as { session: Sesion };
    expect(session.run).toBe(comando);
    await vi.waitFor(() => expect(existsSync(salida)).toBe(true));
    await vi.waitFor(() => expect(readFileSync(salida, 'utf8')).toBe('Enter C-c -l $HOME a;b %24 %25'));
    expect((await parar('comillas')).status).toBe(200);
  });

  it('si el proceso ignora Ctrl+C, la termina igualmente a los pocos segundos', async () => {
    // La shell ignora SIGINT y el proceso en primer plano también: nunca vuelve a la shell.
    expect((await ajustar({ projects: { rebelde: { run: "trap '' INT; sleep 300" } } })).status).toBe(200);
    const { session } = (await (await arrancar('rebelde')).json()) as { session: Sesion };
    await vi.waitFor(async () => expect((await tmuxCli('display-message', '-p', '-t', `=${session.name}:`, '#{pane_current_command}')).stdout.trim()).toBe('sleep'));
    const t0 = Date.now();
    const r = await parar('rebelde');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ stopped: true, graceful: false });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    expect(await sesiones()).toEqual([]);
  });

  it('si la terminal se termina por otro camino, el proyecto vuelve a poder arrancarse', async () => {
    expect((await ajustar({ projects: { rebelde: { run: 'echo otra-vez' } } })).status).toBe(200);
    const { session } = (await (await arrancar('rebelde')).json()) as { session: Sesion };
    const kill = await api('DELETE', `/api/sessions/${session.name}`, undefined, { 'X-Jdev-Confirm': 'yes' });
    expect(kill.status).toBe(200);
    const otra = await arrancar('rebelde');
    expect(otra.status).toBe(201);
    expect(((await otra.json()) as { created: boolean }).created).toBe(true);
    await parar('rebelde');
  });

  it('una terminal de arranque que terminó (shell cerrada) no cuenta como viva', async () => {
    expect((await ajustar({ projects: { rebelde: { run: 'exit' } } })).status).toBe(200);
    const { session } = (await (await arrancar('rebelde')).json()) as { session: Sesion };
    await vi.waitFor(async () => expect((await sesiones()).find((s) => s.name === session.name)?.alive).toBe(false));
    // No queda en marcha: parar no hace nada y arrancar crea otra terminal.
    expect(await (await parar('rebelde')).json()).toEqual({ stopped: false, graceful: false });
    expect((await ajustar({ projects: { rebelde: { run: 'echo nueva' } } })).status).toBe(200);
    const otra = (await (await arrancar('rebelde')).json()) as { session: Sesion; created: boolean };
    expect(otra.created).toBe(true);
    expect(otra.session.name).not.toBe(session.name);
    await parar('rebelde');
    await api('DELETE', `/api/sessions/${session.name}`, undefined, { 'X-Jdev-Confirm': 'yes' });
  });

  it('rechaza guardar un comando de arranque no válido', async () => {
    expect((await ajustar({ projects: { 'sin-dev': { run: 'a\nb' } } })).status).toBe(200);
    expect((await arrancar('sin-dev')).status).toBe(409);
  });
});

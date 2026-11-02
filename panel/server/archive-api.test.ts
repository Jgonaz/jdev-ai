import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { projectSlug } from './recent.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Sesion = { name: string; created: number; archived: boolean };
type Reciente = { id: string; archived: boolean };
type Lista = { sessions: { name: string; created: number }[]; conversations: string[] };

describe('API de archivadas', () => {
  const token = 'a'.repeat(64);
  const sock = `jdev-test-archive-${process.pid}-${Date.now().toString(36)}`;
  const conversacion = '11111111-aaaa-4bbb-8ccc-000000000001';
  const otra = '22222222-aaaa-4bbb-8ccc-000000000002';
  let tmp: string;
  let harness: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let ws: WebSocket;
  const eventos: { type: string; sessions?: Sesion[] }[] = [];
  const auth = { Authorization: `Bearer ${token}` };
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });
  const api = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const sesiones = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;
  const recientes = async () => ((await (await api('GET', '/api/recent')).json()) as { recent: Reciente[] }).recent;
  const archivar = (kind: string, id: unknown, archived: unknown) => api('PUT', '/api/archive', { kind, id, archived });
  const arrancar = async () => {
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
  };

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-archive-api-'));
    harness = join(tmp, 'harness');
    const proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', proy]);
    mkdirSync(join(tmp, 'dist'));
    const transcripts = join(tmp, 'claude', 'projects', projectSlug(proy));
    mkdirSync(transcripts, { recursive: true });
    for (const id of [conversacion, otra]) writeFileSync(join(transcripts, `${id}.jsonl`), '{"type":"user","message":{"content":"hola"}}\n');
    cfg = tmuxConfig(harness, {}, {
      socket: sock,
      confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'),
      launcher: () => ['sh', '-c', 'sleep 120'],
    });
    await arrancar();
  });

  afterAll(async () => {
    ws?.close();
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

  it('exige token y solo admite PUT', async () => {
    expect((await fetch(`${base}/api/archive`, { method: 'PUT', body: '{}' })).status).toBe(401);
    const r = await api('GET', '/api/archive');
    expect(r.status).toBe(405);
    expect(r.headers.get('allow')).toBe('PUT');
    expect((await api('POST', '/api/archive', {})).status).toBe(405);
    expect((await archivar('session', 'jdev-foo-1', true).then((x) => x.status))).toBe(404);
    // Con origen ajeno ni se evalúa.
    const ajeno = await api('PUT', '/api/archive', { kind: 'conversation', id: conversacion, archived: true }, { Origin: 'http://evil.example' });
    expect(ajeno.status).toBe(403);
    expect(existsSync(join(tmp, 'config', 'archived.json'))).toBe(false);
  });

  it('rechaza datos no válidos con 400', async () => {
    const malo = async (kind: unknown, id: unknown, archived: unknown) => {
      const r = await archivar(kind as string, id, archived);
      expect(r.status).toBe(400);
      return ((await r.json()) as { error: string }).error;
    };
    expect(await malo('otra', 'jdev-foo-1', true)).toMatch(/kind/);
    expect(await malo('session', 'jdev-foo-1', 'si')).toMatch(/archived/);
    expect(await malo('session', 'no-es-del-panel', true)).toMatch(/jdev-/);
    expect(await malo('session', 3, true)).toMatch(/jdev-/);
    expect(await malo('session', 'jdev-foo-1; ls', true)).toMatch(/jdev-/);
    expect(await malo('conversation', 'jdev-foo-1', true)).toMatch(/conversación/);
    expect(await malo('conversation', `${conversacion}; ls`, true)).toMatch(/conversación/);
    const invalido = await fetch(`${base}/api/archive`, { method: 'PUT', headers: auth, body: 'no json' });
    expect(invalido.status).toBe(400);
    expect((await api('PUT', '/api/archive', [])).status).toBe(400);
  });

  let nombre = '';
  let created = 0;

  it('archiva una sesión viva, la difunde por /ws/events y responde con la lista', async () => {
    ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    ws.on('message', (d) => eventos.push(JSON.parse(String(d))));
    await vi.waitFor(() => expect(eventos.map((e) => e.type)).toEqual(['hello', 'sessions']));

    const c = await api('POST', '/api/sessions', { project: 'foo', agent: 'claude', location: 'main' });
    expect(c.status).toBe(201);
    const sesion = ((await c.json()) as { session: Sesion }).session;
    nombre = sesion.name;
    created = sesion.created;
    expect(sesion.archived).toBe(false);

    const r = await archivar('session', nombre, true);
    expect(r.status).toBe(200);
    expect((await r.json()) as Lista).toEqual({ sessions: [{ name: nombre, created }], conversations: [] });
    expect((await sesiones()).find((s) => s.name === nombre)?.archived).toBe(true);
    await vi.waitFor(() => expect(eventos.filter((e) => e.type === 'sessions').at(-1)?.sessions?.find((s) => s.name === nombre)?.archived).toBe(true));
    expect(eventos.some((e) => e.type === 'archive')).toBe(true);
    // Archivar no la termina.
    const { stdout } = await tmuxCli('list-sessions', '-F', '#{session_name}');
    expect(stdout.trim().split('\n')).toContain(nombre);
    // Repetir es idempotente.
    expect((await archivar('session', nombre, true)).status).toBe(200);
  });

  it('archiva una conversación de «Anteriores» y la marca en /api/recent', async () => {
    expect((await recientes()).map((r) => [r.id, r.archived]).sort()).toEqual([[conversacion, false], [otra, false]].sort());
    const r = await archivar('conversation', conversacion, true);
    expect(r.status).toBe(200);
    expect(((await r.json()) as Lista).conversations).toEqual([conversacion]);
    expect((await recientes()).map((x) => [x.id, x.archived]).sort()).toEqual([[conversacion, true], [otra, false]].sort());
  });

  it('guarda la lista en archived.json y la conserva al reiniciar el panel', async () => {
    const archivo = join(tmp, 'config', 'archived.json');
    expect(JSON.parse(readFileSync(archivo, 'utf8'))).toEqual({ sessions: [{ name: nombre, created }], conversations: [conversacion] });
    ws.close();
    await srv.close();
    await arrancar();
    expect((await sesiones()).find((s) => s.name === nombre)?.archived).toBe(true);
    expect((await recientes()).find((r) => r.id === conversacion)?.archived).toBe(true);
  });

  it('desarchiva sesiones y conversaciones', async () => {
    expect(((await (await archivar('conversation', conversacion, false)).json()) as Lista).conversations).toEqual([]);
    expect((await recientes()).every((r) => !r.archived)).toBe(true);
    expect(((await (await archivar('session', nombre, false)).json()) as Lista).sessions).toEqual([]);
    expect((await sesiones()).find((s) => s.name === nombre)?.archived).toBe(false);
    // Desarchivar una que no existe no es un error.
    expect((await archivar('session', 'jdev-foo-99', false)).status).toBe(200);
  });

  it('retomar una conversación archivada la desarchiva al crear la sesión', async () => {
    expect((await archivar('conversation', otra, true)).status).toBe(200);
    expect((await recientes()).find((r) => r.id === otra)?.archived).toBe(true);
    // El panel se reinició en una prueba anterior: se abre un canal de eventos nuevo.
    const recibidos: { type: string }[] = [];
    const canal = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    canal.on('message', (d) => recibidos.push(JSON.parse(String(d))));
    await vi.waitFor(() => expect(recibidos.map((e) => e.type)).toEqual(['hello', 'sessions']));
    const r = await api('POST', '/api/sessions', { project: 'foo', agent: 'claude', location: 'main', resume: otra });
    expect(r.status).toBe(201);
    expect(JSON.parse(readFileSync(join(tmp, 'config', 'archived.json'), 'utf8')).conversations).toEqual([]);
    await vi.waitFor(() => expect(recibidos.some((e) => e.type === 'archive')).toBe(true));
    canal.close();
    const nombreNueva = ((await r.json()) as { session: Sesion }).session.name;
    expect((await sesiones()).find((s) => s.name === nombreNueva)?.archived).toBe(false);
    await api('DELETE', `/api/sessions/${nombreNueva}`, undefined, { 'X-Jdev-Confirm': 'yes' });
  });

  it('al terminar la sesión archivada sale de la lista', async () => {
    await archivar('session', nombre, true);
    expect((await api('DELETE', `/api/sessions/${nombre}`, undefined, { 'X-Jdev-Confirm': 'yes' })).status).toBe(200);
    await vi.waitFor(() => {
      expect(JSON.parse(readFileSync(join(tmp, 'config', 'archived.json'), 'utf8')).sessions).toEqual([]);
    });
  });
});

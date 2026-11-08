import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import type { Project } from './projects.ts';
import {
  MAX_SCROLL_LINE,
  SessionInputError,
  checkScrollRequest,
  classifyCopyModeInput,
  createSession,
  killServer,
  leaveCopyMode,
  paneScroll,
  planSession,
  scrollPane,
  tmuxConfig,
} from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const HARNESS = resolve(import.meta.dirname, '..', '..');

describe('classifyCopyModeInput', () => {
  it('el ratón y Mayús+RePág pueden entrar en copy-mode', () => {
    expect(classifyCopyModeInput('\x1b[<0;10;5M')).toBe('enter');
    expect(classifyCopyModeInput('\x1b[<32;11;5M\x1b[<32;12;5M\x1b[<0;12;5m')).toBe('enter');
    expect(classifyCopyModeInput('\x1b[M !!')).toBe('enter');
    expect(classifyCopyModeInput('\x1b[5;2~')).toBe('enter');
  });

  it('el foco, Mayús+AvPág, Escape y Ctrl+C se los queda tmux', () => {
    for (const d of ['', '\x1b[I', '\x1b[O', '\x1b[6;2~', '\x1b', '\x03']) expect(classifyCopyModeInput(d)).toBe('keep');
  });

  it('el resto es escritura para la aplicación', () => {
    for (const d of ['a', 'hola', '\r', '\x7f', '\x1b[A', 'ñ', 'texto pegado\nen dos líneas', '\x1bb']) {
      expect(classifyCopyModeInput(d)).toBe('type');
    }
  });
});

describe('checkScrollRequest', () => {
  it('acepta las acciones sin línea y «line» con un entero acotado', () => {
    for (const action of ['top', 'bottom', 'page-up', 'page-down']) {
      expect(checkScrollRequest({ action })).toEqual({ action });
    }
    expect(checkScrollRequest({ action: 'line', line: 0 })).toEqual({ action: 'line', line: 0 });
    expect(checkScrollRequest({ action: 'line', line: MAX_SCROLL_LINE })).toEqual({ action: 'line', line: MAX_SCROLL_LINE });
  });

  it('rechaza lo demás', () => {
    const malos: unknown[] = [
      null,
      [],
      'top',
      {},
      { action: 'cancel' },
      { action: 'top; kill-server' },
      { action: 3 },
      { action: 'top', line: 3 },
      { action: 'line' },
      { action: 'line', line: -1 },
      { action: 'line', line: 1.5 },
      { action: 'line', line: '5' },
      { action: 'line', line: MAX_SCROLL_LINE + 1 },
      { action: 'line', line: Number.NaN },
      { action: 'line', line: Number.POSITIVE_INFINITY },
    ];
    for (const m of malos) expect(() => checkScrollRequest(m), JSON.stringify(m)).toThrow(SessionInputError);
  });
});

describe('scroll del historial con un tmux aislado', () => {
  const token = 'd'.repeat(64);
  const sock = `jdev-scroll-${process.pid}-${Date.now().toString(36)}`;
  const tmux = (...args: string[]) => execFileSync('tmux', ['-L', sock, ...args], { encoding: 'utf8', env: { ...process.env, TMUX: '' } });
  let tmp: string;
  let cfg: TmuxConfig;
  let srv: RunningServer;
  let base: string;
  let nombre: string;

  const proyecto: Project = {
    id: 'demo',
    name: 'demo',
    path: '/x/demo',
    harness: false,
    branch: 'main',
    worktrees: [],
    mono: 'DM',
    color: '#000000',
    visible: true,
    defaultMono: 'DM',
    defaultColor: '#000000',
  };

  const get = (n: string) => fetch(`${base}/api/sessions/${n}/scroll`, { headers: { Authorization: `Bearer ${token}` } });
  const post = (n: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/sessions/${n}/scroll`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(cuerpo),
    });

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-scroll-'));
    mkdirSync(join(tmp, 'harness', 'projects'), { recursive: true });
    mkdirSync(join(tmp, 'dist'));
    writeFileSync(join(tmp, 'dist', 'index.html'), '<!doctype html><title>x</title>');
    // Usa la tmux.conf real del panel, con las teclas de historial.
    cfg = tmuxConfig(HARNESS, {}, { socket: sock, launcher: () => ['sh', '-c', 'seq 1 500; sleep 300'] });
    nombre = (await createSession(cfg, planSession({ project: 'demo' }, [proyecto], HARNESS), { historyLimit: 1000 })).name;
    // Espera a que seq haya llenado el historial.
    for (let i = 0; i < 100 && ((await paneScroll(cfg, nombre))?.history ?? 0) < 400; i++) await new Promise((r) => setTimeout(r, 50));
    srv = await startServer({
      harnessRoot: join(tmp, 'harness'),
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      stateDir: join(tmp, 'state'),
      claudeConfigDir: join(tmp, 'claude'),
      tmux: cfg,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv?.close();
    let socketPath = '';
    try {
      socketPath = tmux('start-server', ';', 'display-message', '-p', '#{socket_path}').trim();
    } catch {
      // Sin servidor no hay socket que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('lee el historial y el alto; en reposo no está en copy-mode', async () => {
    const s = await paneScroll(cfg, nombre);
    expect(s).toMatchObject({ inMode: false, position: 0, height: 24 });
    expect(s!.history).toBeGreaterThan(400);
  });

  it('page-up entra en copy-mode una página arriba y page-down vuelve abajo saliendo', async () => {
    const arriba = await scrollPane(cfg, nombre, { action: 'page-up' });
    expect(arriba).toMatchObject({ inMode: true, height: 24 });
    expect(arriba!.position).toBeGreaterThanOrEqual(22);
    const mas = await scrollPane(cfg, nombre, { action: 'page-up' });
    expect(mas!.position).toBeGreaterThan(arriba!.position);
    const de = await scrollPane(cfg, nombre, { action: 'bottom' });
    expect(de).toMatchObject({ inMode: false, position: 0 });
    // Fuera de copy-mode, bottom y page-down no hacen nada ni fallan.
    expect((await scrollPane(cfg, nombre, { action: 'bottom' }))!.inMode).toBe(false);
    expect((await scrollPane(cfg, nombre, { action: 'page-down' }))!.inMode).toBe(false);
  });

  it('top llega al principio del historial; line salta a una línea concreta', async () => {
    const top = await scrollPane(cfg, nombre, { action: 'top' });
    expect(top).toMatchObject({ inMode: true });
    expect(top!.position).toBe(top!.history);
    // history-top deja el cursor en la línea más antigua: el 1 de seq (con 1000 de límite no se ha perdido nada).
    expect(tmux('display-message', '-p', '-t', `=${nombre}:`, '#{copy_cursor_line}')).toMatch(/^1\s/);

    const mitad = await scrollPane(cfg, nombre, { action: 'line', line: 100 });
    expect(mitad).toMatchObject({ inMode: true, position: 100 });

    // Más allá del final del historial: tmux lo acota.
    const fin = await scrollPane(cfg, nombre, { action: 'line', line: MAX_SCROLL_LINE });
    expect(fin!.position).toBeLessThanOrEqual(fin!.history);
    expect((await scrollPane(cfg, nombre, { action: 'bottom' }))!.inMode).toBe(false);
  });

  it('page-down desde arriba recorre el historial hasta salir de copy-mode', async () => {
    await scrollPane(cfg, nombre, { action: 'page-up' });
    let s = await paneScroll(cfg, nombre);
    for (let i = 0; i < 40 && s!.inMode; i++) s = await scrollPane(cfg, nombre, { action: 'page-down' });
    expect(s!.inMode).toBe(false);
  });

  it('devuelve null con una sesión que no existe o que no es del panel', async () => {
    expect(await paneScroll(cfg, 'jdev-nada-9')).toBeNull();
    expect(await scrollPane(cfg, 'jdev-nada-9', { action: 'top' })).toBeNull();
    expect(await paneScroll(cfg, 'otra')).toBeNull();
    expect(await scrollPane(cfg, 'otra', { action: 'top' })).toBeNull();
  });

  it('en pantalla alternativa manda a la aplicación sus teclas de scroll', async () => {
    // Una «aplicación» que entra en la pantalla alternativa y vuelca lo que recibe.
    const alt = tmuxConfig(HARNESS, {}, { socket: sock, launcher: () => ['sh', '-c', "printf '\\033[?1049h'; stty raw -echo; od -An -c"] });
    const n = (await createSession(alt, planSession({ project: 'demo' }, [proyecto], HARNESS), { historyLimit: 1000 })).name;
    for (let i = 0; i < 100 && !(await paneScroll(cfg, n))?.alternate; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await paneScroll(cfg, n)).toMatchObject({ inMode: false, alternate: true });
    expect(await scrollPane(cfg, n, { action: 'page-up' })).toMatchObject({ inMode: false, alternate: true });
    // line no tiene equivalente: no manda nada.
    await scrollPane(cfg, n, { action: 'line', line: 10 });
    await scrollPane(cfg, n, { action: 'page-down' });
    // od escribe por bloques de 16 bytes: page-up (4) + page-down (4) + relleno.
    tmux('send-keys', '-t', `=${n}:`, '-l', '12345678');
    let pantalla = '';
    for (let i = 0; i < 100 && !pantalla.includes('5   ~'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      pantalla = tmux('capture-pane', '-p', '-t', `=${n}:`);
    }
    expect(pantalla).toMatch(/033\s+\[\s+5\s+~\s+033\s+\[\s+6\s+~/);
    expect((await paneScroll(cfg, nombre))!.alternate).toBe(false);
    tmux('kill-session', '-t', `=${n}`);
  });

  it('leaveCopyMode sale de copy-mode y, fuera de él o sin sesión, no hace nada', async () => {
    await scrollPane(cfg, nombre, { action: 'page-up' });
    expect((await paneScroll(cfg, nombre))!.inMode).toBe(true);
    await leaveCopyMode(cfg, nombre);
    expect((await paneScroll(cfg, nombre))!.inMode).toBe(false);
    await leaveCopyMode(cfg, nombre);
    await leaveCopyMode(cfg, 'jdev-nada-9');
    expect((await paneScroll(cfg, nombre))!.inMode).toBe(false);
  });

  it('escribir en la terminal del panel saca de copy-mode y la tecla llega a la aplicación', async () => {
    expect((await post(nombre, { action: 'page-up' })).status).toBe(200);
    expect((await paneScroll(cfg, nombre))!.inMode).toBe(true);
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/term/${nombre}?cols=80&rows=24`, {
      headers: { Authorization: `Bearer ${token}`, Origin: `http://localhost:${srv.port}` },
    });
    await new Promise<void>((ok, ko) => {
      ws.once('open', () => ok());
      ws.once('error', ko);
    });
    try {
      ws.send(Buffer.from('zqxj'));
      let pantalla = '';
      for (let i = 0; i < 100 && !pantalla.includes('zqxj'); i++) {
        await new Promise((r) => setTimeout(r, 50));
        pantalla = tmux('capture-pane', '-p', '-t', `=${nombre}:`);
      }
      expect(pantalla).toContain('zqxj');
      expect((await paneScroll(cfg, nombre))!.inMode).toBe(false);
    } finally {
      ws.close();
    }
  });

  describe('API', () => {
    it('GET devuelve {inMode, position, history, height, alternate} y POST mueve la vista', async () => {
      const r = await get(nombre);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ inMode: false, position: 0, height: 24, alternate: false });
      const t = await post(nombre, { action: 'top' });
      expect(t.status).toBe(200);
      const arriba = (await t.json()) as { inMode: boolean; position: number; history: number };
      expect(arriba.inMode).toBe(true);
      expect(arriba.position).toBe(arriba.history);
      const l = await post(nombre, { action: 'line', line: 50 });
      expect(((await l.json()) as { position: number }).position).toBe(50);
      const b = await post(nombre, { action: 'bottom' });
      expect(await b.json()).toMatchObject({ inMode: false, position: 0 });
    });

    it('valida el nombre, el cuerpo, el método y el origen', async () => {
      expect((await get('otra')).status).toBe(400);
      expect((await post('otra', { action: 'top' })).status).toBe(400);
      expect((await get('jdev-nada-9')).status).toBe(404);
      expect((await post('jdev-nada-9', { action: 'top' })).status).toBe(404);
      expect((await post(nombre, { action: 'rm -rf' })).status).toBe(400);
      expect((await post(nombre, { action: 'line', line: -3 })).status).toBe(400);
      expect((await post(nombre, { action: 'line', line: 1e12 })).status).toBe(400);
      const metodo = await fetch(`${base}/api/sessions/${nombre}/scroll`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      expect(metodo.status).toBe(405);
      expect(metodo.headers.get('allow')).toBe('GET, POST');
      const origen = await post(nombre, { action: 'top' }, { Origin: 'http://evil.example' });
      expect(origen.status).toBe(403);
      expect((await post(nombre, { action: 'top' }, { Origin: base })).status).toBe(200);
      await post(nombre, { action: 'bottom' });
    });

    it('exige el token', async () => {
      expect((await fetch(`${base}/api/sessions/${nombre}/scroll`)).status).toBe(401);
    });
  });
});

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Json = Record<string, any>;

const ENTRADA = `# Teclado en iOS

Fecha: 2026-10-31 00:27
Estado: en curso

## Resumen

- Arreglo del teclado.

## Pendiente de ti

- Reinstalar la app en el iPhone
  y comprobar el teclado.

## Continuación recomendada

- Medir visualViewport.
`;

describe('API del historial', () => {
  const token = 'h'.repeat(64);
  const sock = `jdev-test-hist-${process.pid}-${Date.now().toString(36)}`;
  const auth = { Authorization: `Bearer ${token}` };
  let tmp: string;
  let harness: string;
  let proy: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let harnessId: string;

  const api = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });
  const json = async (r: Response) => (await r.json()) as Json;
  const evento = (tipo: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    const llega = new Promise<Json>((ok) => {
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as Json;
        if (m.type === tipo) ok(m);
      });
    });
    const abierto = new Promise((ok) => ws.once('open', ok));
    return { ws, llega, abierto };
  };

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-hist-api-'));
    harness = join(tmp, 'harness');
    harnessId = basename(harness);
    proy = join(harness, 'projects', 'demo');
    mkdirSync(join(proy, '.agent', 'history', 'archive'), { recursive: true });
    execFileSync('git', ['init', '-q', proy]);
    writeFileSync(join(proy, '.agent', 'history', '2026-10-31-0027-teclado.md'), ENTRADA);
    writeFileSync(join(proy, '.agent', 'history', '2026-10-30-1200-hecha.md'), '# Hecha\n\nFecha: 2026-10-30 12:00\nEstado: finalizada\n');
    writeFileSync(join(proy, '.agent', 'history', 'archive', '2026-01-01-0000-viejo.md'), '# Viejo\n');
    mkdirSync(join(harness, '.agent', 'history'), { recursive: true });
    writeFileSync(join(harness, '.agent', 'history', '2026-11-01-1010-panel.md'), '# Panel\n\nFecha: 2026-11-01 10:10\nEstado: bloqueada\n');
    writeFileSync(join(proy, 'secreto.md'), '# Secreto\n');

    mkdirSync(join(tmp, 'dist'));
    cfg = tmuxConfig(harness, {}, {
      socket: sock,
      confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'),
      launcher: () => ['sh', '-c', 'sleep 60'],
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
      uploadsDir: join(tmp, 'uploads'),
      pollMs: 200,
      stateFallbackMs: 200,
      backlogFallbackMs: 200,
      historyFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    let socketPath = '';
    try {
      socketPath = (await execFileAsync('tmux', ['-L', sock, 'start-server', ';', 'display-message', '-p', '#{socket_path}'], {
        env: { ...process.env, TMUX: '' },
      })).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exige token en todas las rutas', async () => {
    for (const [metodo, ruta] of [
      ['GET', '/api/history'],
      ['GET', '/api/history/demo/2026-10-31-0027-teclado.md'],
      ['POST', '/api/history/demo/2026-10-31-0027-teclado.md/pending'],
      ['POST', '/api/history/pending/mark-old'],
    ] as const) {
      expect((await fetch(`${base}${ruta}`, { method: metodo })).status, ruta).toBe(401);
    }
  });

  it('lista las entradas del harness y de los proyectos, con filtros', async () => {
    const c = await json(await api('GET', '/api/history'));
    expect(c.entries.map((e: Json) => `${e.project}/${e.file}`)).toEqual([
      `${harnessId}/2026-11-01-1010-panel.md`,
      'demo/2026-10-31-0027-teclado.md',
      'demo/2026-10-30-1200-hecha.md',
    ]);
    expect(c.entries[1]).toMatchObject({ title: 'Teclado en iOS', state: 'en curso', openPending: 1, firstPending: 'Reinstalar la app en el iPhone y comprobar el teclado.' });
    expect(c.entries.map((e: Json) => e.latest)).toEqual([true, true, false]);
    const solo = async (q: string) => (await json(await api('GET', `/api/history?${q}`))).entries.map((e: Json) => e.file);
    expect(await solo('project=demo')).toEqual(['2026-10-31-0027-teclado.md', '2026-10-30-1200-hecha.md']);
    expect(await solo('state=bloqueada')).toEqual(['2026-11-01-1010-panel.md']);
    expect(await solo('state=en%20curso')).toEqual(['2026-10-31-0027-teclado.md']);
    expect(await solo('pending=1')).toEqual(['2026-10-31-0027-teclado.md']);
    expect((await api('GET', '/api/history?state=rara')).status).toBe(400);
    expect((await api('GET', '/api/history?project=nada')).status).toBe(404);
    expect((await api('POST', '/api/history')).status).toBe(405);
  });

  it('devuelve el detalle y valida las rutas', async () => {
    const c = await json(await api('GET', '/api/history/demo/2026-10-31-0027-teclado.md'));
    expect(c.entry).toMatchObject({ path: '.agent/history/2026-10-31-0027-teclado.md', hasPendingSection: true });
    expect(c.entry.sections.map((s: Json) => s.title)).toEqual(['Resumen', 'Continuación recomendada']);
    expect((await api('GET', `/api/history/${harnessId}/2026-11-01-1010-panel.md`)).status).toBe(200);
    expect((await api('GET', '/api/history/demo/..%2Fsecreto.md')).status).toBe(400);
    expect((await api('GET', '/api/history/demo/archive')).status).toBe(400);
    expect((await api('GET', '/api/history/demo/archive/2026-01-01-0000-viejo.md')).status).toBe(404);
    expect((await api('GET', '/api/history/demo/falta.md')).status).toBe(404);
    expect((await api('GET', '/api/history/nada/x.md')).status).toBe(404);
    expect((await api('GET', '/api/history/demo/%E0%A4%A.md')).status).toBe(400);
    expect((await api('POST', '/api/history/demo/2026-10-31-0027-teclado.md')).status).toBe(405);
  });

  it('marca y desmarca con etag, Origin y aviso por /ws/events', async () => {
    const { ws, llega, abierto } = evento('history');
    await abierto;
    try {
      const ruta = '/api/history/demo/2026-10-31-0027-teclado.md/pending';
      const archivo = join(proy, '.agent', 'history', '2026-10-31-0027-teclado.md');
      const { entry } = await json(await api('GET', '/api/history/demo/2026-10-31-0027-teclado.md'));

      expect((await api('POST', ruta, { index: 0, done: true, etag: entry.etag }, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await api('POST', ruta, 'no-json')).status).toBe(400);
      expect((await api('POST', ruta, { index: 3, done: true, etag: entry.etag })).status).toBe(400);
      expect((await api('GET', ruta)).status).toBe(405);
      const conflicto = await api('POST', ruta, { index: 0, done: true, etag: 'viejo' });
      expect(conflicto.status).toBe(409);
      expect((await json(conflicto)).entry.etag).toBe(entry.etag);
      expect(readFileSync(archivo, 'utf8')).toBe(ENTRADA);

      const r = await api('POST', ruta, { index: 0, done: true, etag: entry.etag }, { Origin: `http://localhost:${srv.port}` });
      expect(r.status).toBe(200);
      const marcado = (await json(r)).entry;
      expect(marcado.pending[0]).toMatchObject({ done: true });
      const hoy = marcado.pending[0].doneDate as string;
      expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(readFileSync(archivo, 'utf8')).toBe(
        ENTRADA.replace('- Reinstalar la app en el iPhone\n  y comprobar el teclado.\n', `- [x] Reinstalar la app en el iPhone\n  y comprobar el teclado. (hecho ${hoy})\n`),
      );
      expect(await llega).toEqual({ type: 'history', project: 'demo' });
      expect((await json(await api('GET', '/api/history?pending=1'))).entries).toEqual([]);

      const vuelta = await api('POST', ruta, { index: 0, done: false, etag: marcado.etag });
      expect(vuelta.status).toBe(200);
      expect(readFileSync(archivo, 'utf8')).toBe(ENTRADA);
    } finally {
      ws.close();
    }
  });

  it('limpia los pendientes de entradas anteriores con Origin, validación y aviso', async () => {
    // El vigilante avisará de los archivos nuevos: se espera a esos avisos para
    // que no se confundan con el de la limpieza.
    const previos = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    const vistos = new Set<string>();
    const asentado = new Promise<void>((ok) => {
      previos.on('message', (d) => {
        const m = JSON.parse(String(d)) as Json;
        if (m.type === 'history') vistos.add(m.project);
        if (vistos.has('demo') && vistos.has(harnessId)) ok();
      });
    });
    await new Promise((ok) => previos.once('open', ok));
    const dir = join(proy, '.agent', 'history');
    const vieja = '# Vieja\n\nFecha: 2026-10-01 10:00\n\n## Pendiente de ti\n\n- Antiguo.\n- [x] Hecho. (hecho 2026-10-02)\n';
    const noUtf8 = Buffer.from('# Año\n\nFecha: 2026-09-01 10:00\n\n## Pendiente de ti\n\n- Configuración.\n', 'latin1');
    writeFileSync(join(dir, '2026-10-01-1000-vieja.md'), vieja);
    writeFileSync(join(dir, '2026-09-01-1000-latin1.md'), noUtf8);
    const viejaHarness = '# Vieja del harness\n\nFecha: 2026-10-01 09:00\n\n## Pendiente de ti\n\n- Del harness.\n';
    writeFileSync(join(harness, '.agent', 'history', '2026-10-01-0900-vieja.md'), viejaHarness);
    await asentado;
    previos.close();
    const ruta = '/api/history/pending/mark-old';
    const { ws, llega, abierto } = evento('history');
    await abierto;
    try {
      expect((await api('POST', ruta, {}, { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await api('GET', ruta)).status).toBe(405);
      expect((await api('POST', ruta, 'no-json')).status).toBe(400);
      expect((await api('POST', ruta, { project: 3 })).status).toBe(400);
      expect((await api('POST', ruta, { project: 'nada' })).status).toBe(404);
      const antes = readFileSync(join(proy, '.agent', 'history', '2026-10-31-0027-teclado.md'), 'utf8');

      const r = await api('POST', ruta, { project: 'demo' }, { Origin: `http://localhost:${srv.port}` });
      expect(r.status).toBe(200);
      const cuerpo = await json(r);
      expect(cuerpo).toMatchObject({ marked: 1, entries: 1, skipped: [{ project: 'demo', file: '2026-09-01-1000-latin1.md' }] });
      expect(cuerpo.skipped[0].reason).toMatch(/UTF-8/);
      expect(await llega).toEqual({ type: 'history', project: 'demo' });
      expect(readFileSync(join(dir, '2026-10-01-1000-vieja.md'), 'utf8')).toMatch(/^# Vieja\n\nFecha: 2026-10-01 10:00\n\n## Pendiente de ti\n\n- \[x\] Antiguo\. \(hecho \d{4}-\d{2}-\d{2}\)\n- \[x\] Hecho\. \(hecho 2026-10-02\)\n$/);
      // La última entrada del proyecto y el otro proyecto siguen igual.
      expect(readFileSync(join(proy, '.agent', 'history', '2026-10-31-0027-teclado.md'), 'utf8')).toBe(antes);
      expect(readFileSync(join(harness, '.agent', 'history', '2026-10-01-0900-vieja.md'), 'utf8')).toBe(viejaHarness);
      expect(readFileSync(join(dir, '2026-09-01-1000-latin1.md')).equals(noUtf8)).toBe(true);

      // Sin proyecto: todos.
      const todos = await json(await api('POST', ruta, {}));
      expect(todos).toMatchObject({ marked: 1, entries: 1 });
      expect(readFileSync(join(harness, '.agent', 'history', '2026-10-01-0900-vieja.md'), 'utf8')).toContain('- [x] Del harness. (hecho ');
    } finally {
      ws.close();
    }
  });

  it('avisa de entradas nuevas escritas por fuera', async () => {
    const { ws, llega, abierto } = evento('history');
    await abierto;
    try {
      writeFileSync(join(proy, '.agent', 'history', '2026-11-01-1200-nueva.md'), '# Nueva\n');
      expect(await llega).toEqual({ type: 'history', project: 'demo' });
    } finally {
      ws.close();
    }
  });
});

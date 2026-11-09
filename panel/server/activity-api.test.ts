import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActivityResponse } from '../shared/activity.ts';
import { ActivityIndex } from './activity-index.ts';
import { claudeAssistant, codexContext, codexMeta, codexTokenCount, makeRoots, put } from './activity-fixtures.ts';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

describe('GET /api/activity', () => {
  const token = 'a'.repeat(64);
  const sock = `jdev-test-activity-${process.pid}-${Date.now().toString(36)}`;
  const r = makeRoots();
  let harness: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  const get = (q = '', auth = true) => fetch(`${base}/api/activity${q}`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
  const hoy = new Date();
  const ts = (min: number) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 10, min).toISOString();

  beforeAll(async () => {
    harness = join(r.tmp, 'harness');
    const alfa = join(harness, 'projects', 'alfa');
    execFileSync('git', ['init', '-q', '-b', 'main', harness]);
    execFileSync('git', ['init', '-q', '-b', 'main', alfa]);
    mkdirSync(join(r.tmp, 'dist'));
    mkdirSync(join(r.tmp, 'config'));

    put(join(r.claude, '-x', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl'), claudeAssistant({ id: 'msg_1', ts: ts(0), cwd: alfa, out: 100, tools: [{ name: 'Agent', subagent: 'qa' }] }) + claudeAssistant({ id: 'msg_2', ts: ts(1), cwd: alfa, out: 50 }));
    const dir = join(r.codex, String(hoy.getFullYear()), String(hoy.getMonth() + 1).padStart(2, '0'), String(hoy.getDate()).padStart(2, '0'));
    put(join(dir, 'rollout-a.jsonl'), codexMeta(ts(0), alfa) + codexContext(ts(0), 'gpt-6-luna') + codexTokenCount({ ts: ts(2), total: 1030, out: 30 }));

    cfg = tmuxConfig(harness, {}, { socket: sock, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'), launcher: () => ['sh', '-c', 'sleep 60'] });
    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(r.tmp, 'dist'),
      configDir: join(r.tmp, 'config'),
      tmux: cfg,
      stateDir: join(r.tmp, 'state'),
      claudeConfigDir: join(r.tmp, 'claude'),
      codexHome: join(r.tmp, 'codex'),
      cacheDir: r.cache,
      uploadsDir: join(r.tmp, 'uploads'),
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
      socketPath = (await execFileAsync('tmux', ['-L', sock, 'start-server', ';', 'display-message', '-p', '#{socket_path}'], { env: { ...process.env, TMUX: '' } })).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(r.tmp, { recursive: true, force: true });
  });

  async function listo(q: string): Promise<ActivityResponse> {
    for (let i = 0; i < 100; i++) {
      const res = await get(q);
      const cuerpo = (await res.json()) as ActivityResponse;
      if (!cuerpo.indexing && cuerpo.updatedAt !== null) return cuerpo;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error('el índice no terminó');
  }

  it('exige el token y solo admite GET', async () => {
    expect((await get('', false)).status).toBe(401);
    const post = await fetch(`${base}/api/activity`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
  });

  it('rechaza un periodo o un agente desconocido', async () => {
    expect((await get('?range=siempre')).status).toBe(400);
    expect((await get('?agent=cursor')).status).toBe(400);
    expect((await get('?range=week&agent=all')).status).toBe(200);
  });

  it('por defecto da la semana de todos los agentes con lo indexado', async () => {
    const a = await listo('');
    expect(a.range).toBe('week');
    expect(a.agent).toBe('all');
    expect(a.totals.responses).toBe(3);
    expect(a.totals.output).toBe(180);
    expect(a.sessionsByAgent).toEqual({ claude: 1, codex: 1 });
    expect(a.days).toHaveLength(84);
    expect(a.agents).toEqual([{ name: 'qa', count: 1 }]);
    // Resuelve el proyecto del panel por el cwd.
    expect(a.byProject.map((p) => [p.id, p.output])).toEqual([['alfa', 180]]);
    expect(a.byProject[0]).toMatchObject({ mono: 'AL' });
    expect(a.byModel.map((m) => m.family).sort()).toEqual(['codex', 'opus']);
  });

  it('filtra por agente y por periodo', async () => {
    const c = await listo('?agent=codex&range=30d');
    expect(c.totals).toMatchObject({ responses: 1, output: 30, sessions: 1 });
    expect(c.previous).not.toBeNull();
    const todo = await listo('?range=all');
    expect(todo.previous).toBeNull();
  });

  it('escribe la caché solo en el directorio indicado y deja el índice reutilizable', async () => {
    await listo('');
    expect(existsSync(join(r.cache, 'activity-index.json'))).toBe(true);
    // Otro índice parte de lo guardado sin releer los transcripts.
    const otro = new ActivityIndex({ claudeProjectsDir: r.claude, codexSessionsDir: r.codex, cacheDir: r.cache });
    await otro.refresh();
    expect(otro.files.size).toBe(2);
    expect(otro.lastPass.files).toBe(0);
  });

  it('el arranque normal no indexa solo: sin la opción, no se toca la caché hasta que alguien pide la actividad', async () => {
    const tmp2 = mkdtempSync(join(tmpdir(), 'jdev-activity-start-'));
    const cache2 = join(tmp2, 'cache');
    const s2 = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(r.tmp, 'dist'),
      configDir: join(tmp2, 'config'),
      tmux: cfg,
      stateDir: join(tmp2, 'state'),
      claudeConfigDir: join(r.tmp, 'claude'),
      codexHome: join(r.tmp, 'codex'),
      cacheDir: cache2,
      uploadsDir: join(tmp2, 'uploads'),
    });
    try {
      await new Promise((ok) => setTimeout(ok, 150));
      expect(existsSync(cache2)).toBe(false);
    } finally {
      await s2.close();
      rmSync(tmp2, { recursive: true, force: true });
    }
  });
});

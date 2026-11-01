import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BacklogStore } from './backlog.ts';
import { itemSource } from './backlog-fixtures.ts';
import { HistoryStore } from './history.ts';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { buildOverview, compareActivity, entryTime, firstName } from './overview.ts';
import { listProjects } from './projects.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

const entrada = (titulo: string, fecha: string, estado: string, pendientes: string[] = []) =>
  `# ${titulo}\n\nFecha: ${fecha}\nEstado: ${estado}\n\n## Resumen\n\n- Algo.\n` +
  (pendientes.length ? `\n## Pendiente de ti\n\n${pendientes.join('\n')}\n` : '');

function elemento(proyecto: string, estado: string, id: string): void {
  const dir = join(proyecto, 'docs', 'backlog', estado);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), itemSource(id, estado));
}

// Fija el mtime de todo lo del backlog para que la actividad sea predecible.
function envejecer(proyecto: string, ms: number): void {
  const t = ms / 1000;
  for (const sub of ['', 'backlog', 'todo', 'in-progress', 'done']) {
    const dir = join(proyecto, 'docs', 'backlog', sub);
    try {
      execFileSync('find', [dir, '-maxdepth', '1', '-exec', 'touch', '-d', `@${t}`, '{}', ';']);
    } catch {
      // La carpeta no existe.
    }
  }
}

describe('lógica del resumen', () => {
  it('entryTime interpreta la fecha local de las entradas', () => {
    expect(entryTime('2026-11-01 10:05')).toBe(new Date(2026, 10, 1, 10, 5).getTime());
    expect(entryTime('2026-11-01')).toBe(new Date(2026, 10, 1).getTime());
    expect(entryTime('ayer')).toBe(0);
  });

  it('firstName toma el primer token del nombre de Git', () => {
    expect(firstName('Jorge González\n')).toBe('Jorge');
    expect(firstName('  Ana  ')).toBe('Ana');
    expect(firstName('   ')).toBeNull();
  });

  it('compareActivity ordena de más a menos reciente y desempata por id', () => {
    const lista = [
      { id: 'b', lastActivity: 5 },
      { id: 'a', lastActivity: 5 },
      { id: 'c', lastActivity: 9 },
      { id: 'd', lastActivity: 0 },
    ];
    expect(lista.sort(compareActivity).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('buildOverview y GET /api/overview', () => {
  const token = 'o'.repeat(64);
  const sock = `jdev-test-overview-${process.pid}-${Date.now().toString(36)}`;
  let tmp: string;
  let harness: string;
  let alfa: string;
  let beta: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-overview-'));
    harness = join(tmp, 'harness');
    alfa = join(harness, 'projects', 'alfa');
    beta = join(harness, 'projects', 'beta');
    execFileSync('git', ['init', '-q', '-b', 'main', harness]);
    execFileSync('git', ['-C', harness, 'config', 'user.name', 'Ana María López']);
    const commit = (dir: string) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=x', '-c', 'user.email=x@example.com', 'commit', '-q', '--allow-empty', '-m', 'base']);
    for (const p of [alfa, beta, join(harness, 'projects', 'oculto')]) {
      execFileSync('git', ['init', '-q', '-b', 'main', p]);
      commit(p);
    }
    execFileSync('git', ['-C', beta, 'checkout', '-q', '-b', 'feat/x']);
    // Un worktree abierto en alfa (basta con la carpeta con .git).
    mkdirSync(join(harness, 'projects', 'alfa.worktrees', 'uno'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'feat/uno', join(harness, 'projects', 'alfa.worktrees', 'uno')]);

    elemento(alfa, 'backlog', 'BL-20261020-1000-a');
    elemento(alfa, 'backlog', 'BL-20261020-1001-b');
    elemento(alfa, 'todo', 'BL-20261020-1002-c');
    elemento(alfa, 'in-progress', 'BL-20261020-1003-d');
    elemento(alfa, 'done', 'BL-20261020-1004-e');
    envejecer(alfa, new Date(2026, 9, 1).getTime());

    const hAlfa = join(alfa, '.agent', 'history');
    mkdirSync(hAlfa, { recursive: true });
    writeFileSync(join(hAlfa, '2026-10-30-0900-vieja.md'), entrada('Vieja', '2026-10-30 09:00', 'finalizada', ['- [ ] Uno', '- [x] Dos']));
    writeFileSync(join(hAlfa, '2026-10-31-1800-nueva.md'), entrada('Nueva', '2026-10-31 18:00', 'en curso', ['- Tres', '- Cuatro']));
    const hBeta = join(beta, '.agent', 'history');
    mkdirSync(hBeta, { recursive: true });
    writeFileSync(join(hBeta, '2026-11-01-1000-beta.md'), entrada('Beta', '2026-11-01 10:00', 'bloqueada'));
    const hOculto = join(harness, 'projects', 'oculto', '.agent', 'history');
    mkdirSync(hOculto, { recursive: true });
    writeFileSync(join(hOculto, '2026-11-01-1200-oculta.md'), entrada('Oculta', '2026-11-01 12:00', 'en curso', ['- Oculto']));
    for (let i = 0; i < 9; i++) {
      const f = join(hBeta, `2026-09-0${i + 1}-1000-e${i}.md`);
      writeFileSync(f, entrada(`E${i}`, `2026-09-0${i + 1} 10:00`, 'finalizada'));
      utimesSync(f, new Date(2026, 8, 1), new Date(2026, 8, 1));
    }

    mkdirSync(join(tmp, 'dist'));
    mkdirSync(join(tmp, 'config'));
    writeFileSync(join(tmp, 'config', 'panel.json'), JSON.stringify({ projects: { oculto: { visible: false } } }));
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
  });

  afterAll(async () => {
    await srv.close();
    let socketPath = '';
    try {
      socketPath = (
        await execFileAsync('tmux', ['-L', sock, 'start-server', ';', 'display-message', '-p', '#{socket_path}'], {
          env: { ...process.env, TMUX: '' },
        })
      ).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('recuentos, worktrees, último registro, pendientes y actividad reciente', async () => {
    const todos = await listProjects(harness, { oculto: { visible: false } });
    const visibles = todos.filter((p) => p.visible);
    const r = await buildOverview({
      projects: visibles,
      allProjects: todos,
      sessions: [{ project: 'alfa', updatedAt: new Date(2026, 10, 1, 11, 0).getTime() }],
      backlog: new BacklogStore(),
      history: new HistoryStore(),
      gitName: 'Ana',
    });
    // alfa tiene la sesión más reciente; beta, su entrada del 1 de noviembre; el harness, nada.
    expect(r.projects.map((p) => p.id)).toEqual(['alfa', 'beta', basename(harness)]);
    const [a, b, h] = r.projects;
    expect(a).toEqual({
      id: 'alfa',
      branch: 'main',
      backlog: { backlog: 2, todo: 1, inProgress: 1 },
      worktrees: 1,
      lastActivity: new Date(2026, 10, 1, 11, 0).getTime(),
      lastEntry: { title: 'Nueva', state: 'en curso', file: '2026-10-31-1800-nueva.md' },
    });
    expect(b).toMatchObject({
      branch: 'feat/x',
      backlog: { backlog: 0, todo: 0, inProgress: 0 },
      worktrees: 0,
      lastActivity: new Date(2026, 10, 1, 10, 0).getTime(),
      lastEntry: { title: 'Beta', state: 'bloqueada' },
    });
    expect(h).toMatchObject({ lastActivity: 0, lastEntry: null, worktrees: 0 });
    // Los ocultos no cuentan: 1 de «Vieja» + 2 de «Nueva».
    expect(r.history).toEqual({ openPending: 3, entriesWithPending: 2 });
    expect(r.recent).toHaveLength(8);
    expect(r.recent.map((e) => e.title).slice(0, 3)).toEqual(['Beta', 'Nueva', 'Vieja']);
    expect(r.recent.some((e) => e.project === 'oculto')).toBe(false);
    expect(r.gitName).toBe('Ana');
  });

  it('la última actividad usa el backlog si es lo más reciente', async () => {
    const todos = await listProjects(harness);
    const alfaP = todos.filter((p) => p.id === 'alfa');
    const futuro = new Date(2026, 10, 2, 9, 0).getTime();
    utimesSync(join(alfa, 'docs', 'backlog', 'todo', 'BL-20261020-1002-c.md'), futuro / 1000, futuro / 1000);
    const r = await buildOverview({ projects: alfaP, allProjects: todos, sessions: [], backlog: new BacklogStore(), history: new HistoryStore(), gitName: null });
    expect(r.projects[0]!.lastActivity).toBe(futuro);
    envejecer(alfa, new Date(2026, 9, 1).getTime());
  });

  it('GET /api/overview exige token y devuelve el resumen con gitName', async () => {
    const base = `http://127.0.0.1:${srv.port}`;
    expect((await fetch(`${base}/api/overview`)).status).toBe(401);
    const auth = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${base}/api/overview`, { method: 'POST', headers: auth })).status).toBe(405);
    const r = await fetch(`${base}/api/overview`, { headers: auth });
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as { projects: { id: string }[]; history: unknown; recent: unknown[]; gitName: string | null };
    expect(cuerpo.gitName).toBe('Ana');
    expect(cuerpo.projects.map((p) => p.id)).toEqual(['beta', 'alfa', basename(harness)]);
    expect(cuerpo.history).toEqual({ openPending: 3, entriesWithPending: 2 });
    expect(cuerpo.recent).toHaveLength(8);

    // Al mostrar el proyecto oculto en Ajustes, el resumen lo incluye sin esperar.
    await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects: { oculto: null } }),
    });
    const otra = (await (await fetch(`${base}/api/overview`, { headers: auth })).json()) as { projects: { id: string }[]; history: unknown };
    expect(otra.projects[0]!.id).toBe('oculto');
    expect(otra.history).toEqual({ openPending: 4, entriesWithPending: 3 });
  });
});

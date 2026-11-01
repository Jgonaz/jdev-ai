import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { backlogLatestMtime } from './backlog.ts';
import type { BacklogStore } from './backlog.ts';
import type { HistoryEntry, HistoryState, HistoryStore } from './history.ts';
import type { Project } from './projects.ts';

// Resumen de todos los proyectos para la pantalla Inicio (GET /api/overview).
// Solo lee: reutiliza las cachés por archivo del backlog y del historial.

const execFileAsync = promisify(execFile);

/** Número de entradas de «Actividad reciente». */
export const RECENT_ENTRIES = 8;

export type OverviewProject = {
  id: string;
  branch: string | null;
  backlog: { backlog: number; todo: number; inProgress: number };
  /** Worktrees abiertos del proyecto. */
  worktrees: number;
  /** Milisegundos desde la época de la última actividad (0 si no se conoce ninguna). */
  lastActivity: number;
  lastEntry: { title: string; state: HistoryState; file: string } | null;
};

export type Overview = {
  /** Proyectos visibles, de más a menos reciente por `lastActivity`. */
  projects: OverviewProject[];
  history: { openPending: number; entriesWithPending: number };
  recent: HistoryEntry[];
  /** Primer nombre de `git config user.name`, o null. */
  gitName: string | null;
};

/**
 * Instante local de la fecha de una entrada (`YYYY-MM-DD HH:MM` o
 * `YYYY-MM-DD`, que cuenta como el principio del día); 0 si no es legible.
 */
export function entryTime(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(fecha);
  if (!m) return 0;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Primer token del nombre de Git, o null si está vacío. */
export function firstName(userName: string): string | null {
  return userName.trim().split(/\s+/u)[0] || null;
}

/** Lee `git config user.name` (con la configuración local del harness, si la hay). Nunca lanza. */
export async function readGitName(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'config', 'user.name'], { timeout: 5000 });
    return firstName(stdout);
  } catch {
    return null;
  }
}

export type OverviewInput = {
  /** Proyectos visibles. */
  projects: readonly Project[];
  /** Todos los proyectos, para leer el historial sin vaciar la caché de los ocultos. */
  allProjects: readonly Project[];
  sessions: readonly { project: string; updatedAt: number }[];
  backlog: BacklogStore;
  history: HistoryStore;
  gitName: string | null;
};

/** Ordena por actividad (más reciente primero); a igualdad, por identificador. */
export function compareActivity(a: { id: string; lastActivity: number }, b: { id: string; lastActivity: number }): number {
  return b.lastActivity - a.lastActivity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function buildOverview(input: OverviewInput): Promise<Overview> {
  const visibles = new Set(input.projects.map((p) => p.id));
  const entradas = (await input.history.list(input.allProjects.map((p) => ({ id: p.id, path: p.path })))).filter((e) =>
    visibles.has(e.project),
  );

  const projects = await Promise.all(
    input.projects.map(async (p): Promise<OverviewProject> => {
      const [{ items }, mtimeBacklog] = await Promise.all([input.backlog.list(p.path), backlogLatestMtime(p.path)]);
      const backlog = { backlog: 0, todo: 0, inProgress: 0 };
      for (const it of items) {
        if (it.status === 'backlog') backlog.backlog++;
        else if (it.status === 'todo') backlog.todo++;
        else if (it.status === 'in-progress') backlog.inProgress++;
      }
      // Las entradas ya vienen de más reciente a más antigua.
      const ultima = entradas.find((e) => e.project === p.id) ?? null;
      let lastActivity = Math.max(mtimeBacklog, ultima ? entryTime(ultima.date) : 0);
      for (const s of input.sessions) if (s.project === p.id) lastActivity = Math.max(lastActivity, s.updatedAt);
      return {
        id: p.id,
        branch: p.branch,
        backlog,
        worktrees: p.worktrees.length,
        lastActivity,
        lastEntry: ultima ? { title: ultima.title, state: ultima.state, file: ultima.file } : null,
      };
    }),
  );
  projects.sort(compareActivity);

  let openPending = 0;
  let entriesWithPending = 0;
  for (const e of entradas) {
    openPending += e.openPending;
    if (e.openPending > 0) entriesWithPending++;
  }
  return {
    projects,
    history: { openPending, entriesWithPending },
    recent: entradas.slice(0, RECENT_ENTRIES),
    gitName: input.gitName,
  };
}

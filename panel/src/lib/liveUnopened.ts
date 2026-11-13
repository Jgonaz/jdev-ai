import type { ProjectInfo, SessionInfo, VisualState } from '../types.ts';
import { fallbackProject, isRunning, visualState } from './sessions.ts';
import { safeStorage } from './workspace.ts';

/** Sesión viva que no está en ninguna pestaña, lista para mostrar. */
export type LiveItem = {
  session: SessionInfo;
  project: ProjectInfo;
  state: VisualState;
  /** El proyecto está oculto en Ajustes; solo se lista si la sesión te espera. */
  hiddenProject: boolean;
};

/** «Viva» = el proceso sigue y no ha terminado (incluye las que no informan de turnos, como Codex). */
export function isLive(s: Pick<SessionInfo, 'alive' | 'state'>): boolean {
  return s.alive && s.state !== 'ended';
}

// Te espera primero; las que no informan de turnos («viva») cuentan como en reposo.
const RANK: Record<VisualState, number> = { waiting: 0, working: 1, idle: 2, alive: 2, shell: 2, done: 3, ended: 4 };

/**
 * Sesiones vivas que no están abiertas en pestañas: primero las terminales de
 * arranque en marcha y después por estado y actividad reciente. Los proyectos ocultos no cuentan, salvo las
 * sesiones que esperan (siempre cuentan, como en los avisos); `hideDone` omite
 * las hechas. Las archivadas no están aquí: tienen su propia sección. Una sesión de un proyecto desconocido se muestra con uno genérico.
 */
export function liveUnopened(
  sessions: readonly SessionInfo[],
  projects: readonly ProjectInfo[],
  openTabs: readonly string[],
  opciones: { hideDone?: boolean } = {},
): LiveItem[] {
  const abiertas = new Set(openTabs);
  const porId = new Map(projects.map((p) => [p.id, p]));
  const items: LiveItem[] = [];
  for (const session of sessions) {
    if (!isLive(session) || session.archived || abiertas.has(session.name)) continue;
    const state = visualState(session);
    if (opciones.hideDone && state === 'done') continue;
    const project = porId.get(session.project) ?? fallbackProject(session.project);
    const hiddenProject = !project.visible;
    if (hiddenProject && state !== 'waiting') continue;
    items.push({ session, project, state, hiddenProject });
  }
  return items.sort(
    (a, b) =>
      Number(isRunning(b.session)) - Number(isRunning(a.session)) ||
      RANK[a.state] - RANK[b.state] || b.session.updatedAt - a.session.updatedAt || a.session.name.localeCompare(b.session.name),
  );
}

export function liveCountLabel(n: number): string {
  return n === 1 ? 'Tienes 1 terminal viva: ábrela aquí o en la barra lateral.' : `Tienes ${n} terminales vivas: ábrelas aquí o en la barra lateral.`;
}

// ---------------------------------------------------------------- Plegado en la barra lateral

export const LIVE_COLLAPSED_KEY = 'jdev-panel:live-collapsed';

/** Plegado recordado del apartado «En segundo plano»: desplegado por defecto o ante un valor ilegible. */
export function loadLiveCollapsed(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(LIVE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveLiveCollapsed(plegado: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LIVE_COLLAPSED_KEY, plegado ? '1' : '0');
  } catch {
    // Almacenamiento bloqueado: el panel funciona igual, sin recordarlo.
  }
}

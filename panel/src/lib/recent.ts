import type { ProjectInfo, RecentSession, SessionRequest } from '../types.ts';
import { formatRelative } from './time.ts';

/** Misma ventana que usa el servidor (POSSIBLY_OPEN_MS) para marcar una sesión como posiblemente abierta. */
export const POSSIBLY_OPEN_MS = 3 * 60_000;
/** Recientes que se muestran por proyecto antes de «Ver más». */
export const RECENT_COLLAPSED = 3;

export type RecentGroup = { project: ProjectInfo; items: RecentSession[] };

/**
 * Agrupa las recientes por proyecto en el orden de la lista de proyectos.
 * Respeta los proyectos ocultos y, con `hideClosed`, las sesiones con la marca
 * [Closed]. Las de proyectos que ya no están en la lista no se pueden retomar y se omiten.
 */
export function groupRecent(
  recent: readonly RecentSession[],
  projects: readonly ProjectInfo[],
  opciones: { hideClosed?: boolean } = {},
): RecentGroup[] {
  const grupos: RecentGroup[] = [];
  for (const project of projects) {
    if (!project.visible) continue;
    const items = recent.filter((r) => r.project === project.id && !(opciones.hideClosed && r.closed));
    if (items.length > 0) grupos.push({ project, items });
  }
  return grupos;
}

/** Las primeras `RECENT_COLLAPSED` o todas si el grupo está desplegado. */
export function visibleRecent<T>(items: readonly T[], expandido: boolean, limite = RECENT_COLLAPSED): { shown: T[]; hidden: number } {
  if (expandido || items.length <= limite) return { shown: [...items], hidden: 0 };
  return { shown: items.slice(0, limite), hidden: items.length - limite };
}

/** Dónde trabajó la sesión: «principal» o «wt <worktree>». */
export function recentPlace(r: Pick<RecentSession, 'worktree'>): string {
  return r.worktree ? `wt ${r.worktree}` : 'principal';
}

/** Posiblemente abierta en otra ventana, según la hora actual (no la del último refresco de la lista). */
export function isPossiblyOpen(r: Pick<RecentSession, 'lastActivity'>, ahora: number): boolean {
  return ahora - r.lastActivity < POSSIBLY_OPEN_MS;
}

/** «hace 2 min», «hace 3 h», «ayer» o «ahora», con el mismo redondeo que la barra lateral. */
export function agoLabel(lastActivity: number, ahora: number): string {
  const t = formatRelative(lastActivity, ahora);
  return t === 'ahora' || t === 'ayer' ? t : `hace ${t}`;
}

/** «Actividad hace 2 min», con «Actividad hace menos de 1 min» para lo más reciente. */
export function activityAgo(r: Pick<RecentSession, 'lastActivity'>, ahora: number): string {
  return formatRelative(r.lastActivity, ahora) === 'ahora' ? 'Actividad hace menos de 1 min' : `Actividad ${agoLabel(r.lastActivity, ahora)}`;
}

/** Aviso destacado del diálogo de confirmación, o null si no hace falta. */
export function openElsewhereNotice(r: Pick<RecentSession, 'lastActivity'>, ahora: number): string | null {
  return isPossiblyOpen(r, ahora) ? `${activityAgo(r, ahora)}: puede seguir abierta en otra ventana.` : null;
}

/** Petición de POST /api/sessions para retomar la sesión en su checkout o worktree. */
export function resumeRequest(r: Pick<RecentSession, 'id' | 'project' | 'worktree'>): SessionRequest {
  return r.worktree
    ? { project: r.project, agent: 'claude', location: 'existing-worktree', feature: r.worktree, resume: r.id }
    : { project: r.project, agent: 'claude', location: 'main', resume: r.id };
}

/** Clave estable de lo que determina qué sesiones están en el panel: cambia al crear o terminar una. */
export function sessionNamesKey(sessions: readonly { name: string }[]): string {
  return sessions
    .map((s) => s.name)
    .sort()
    .join('|');
}

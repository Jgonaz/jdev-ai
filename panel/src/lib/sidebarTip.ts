import type { ProjectInfo, RecentSession, SessionInfo } from '../types.ts';
import { activityAgo } from './recent.ts';
import { AGENT_LABELS } from './sessions.ts';
import { artifactsLabel, hasWork, headerView, placeText, shellsLabel, subagentsLabel } from './statusline.ts';
import type { ContextView, Place, WorkCounts } from './statusline.ts';

// Vista del tooltip de las filas de la barra lateral: pura, para probarla sin
// montar nada. Reutiliza la de la cabecera de la terminal (`headerView`), así que
// el modelo, la barra de contexto y sus umbrales son los mismos.

/** Retraso con el ratón encima antes de abrir el tooltip (con el foco se abre al momento). */
export const TIP_DELAY_MS = 400;

/** Datos de la statusline de una sesión viva de Claude. */
export type TipLive = {
  /** «Opus 5.5 · medium», o null si la statusline aún no dice el modelo. */
  model: string | null;
  context: ContextView | null;
  /** Tiempo de sesión: «2 h 14 min». */
  elapsed: string;
  stale: boolean;
  /** «hace 20 min» si está desactualizado, o ''. */
  ago: string;
  counts: WorkCounts;
  /** «2 subagentes · 1 shell», o '' si no hay trabajo en curso. */
  work: string;
};

export type TipView = {
  /** Título completo, sin recortar. */
  title: string;
  project: { name: string; color: string };
  /** Lugar en una línea: «main», «wt ts7 · feat/ts7». */
  place: string;
  agent: string;
  /** Datos de la sesión viva; null en «Anteriores» y sin statusline. */
  live: TipLive | null;
  /** «Actividad hace 2 min» (solo en «Anteriores»). */
  activity: string | null;
};

/** «2 subagentes · 1 shell · 3 artifacts»; '' sin trabajo en curso. */
export function workSummary(c: WorkCounts): string {
  if (!hasWork(c)) return '';
  const partes: string[] = [];
  if (c.subagents > 0) partes.push(subagentsLabel(c.subagents));
  if (c.shells > 0) partes.push(shellsLabel(c.shells));
  if (c.artifacts > 0) partes.push(artifactsLabel(c.artifacts));
  return partes.join(' · ');
}

const agentLabel = (agent: string): string => AGENT_LABELS[agent] ?? agent;

/** Tooltip de una sesión del panel. Los datos de la statusline solo salen si está viva y los tiene. */
export function sessionTip(session: SessionInfo, project: Pick<ProjectInfo, 'name' | 'color'>, ahora: number): TipView {
  const v = headerView(session, ahora);
  const viva = session.alive && session.state !== 'ended';
  const conDatos = viva && session.usage !== null;
  return {
    title: session.title,
    project: { name: project.name, color: project.color },
    place: placeText(v.place),
    agent: agentLabel(session.agent),
    live: conDatos
      ? {
          model: session.usage!.model ? `${v.model}${v.effort ? ` · ${v.effort}` : ''}` : null,
          context: v.context,
          elapsed: v.elapsed,
          stale: v.stale,
          ago: v.ago,
          counts: v.counts,
          work: workSummary(v.counts),
        }
      : null,
    activity: null,
  };
}

/** Tooltip de una conversación de «Anteriores» (siempre de Claude). */
export function recentTip(r: RecentSession, project: Pick<ProjectInfo, 'name' | 'color' | 'branch' | 'worktrees'>, ahora: number): TipView {
  const lugar: Place = r.worktree
    ? { worktree: r.worktree, branch: project.worktrees.find((w) => w.name === r.worktree)?.branch ?? null }
    : { worktree: null, branch: project.branch };
  return {
    title: r.title,
    project: { name: project.name, color: project.color },
    place: placeText(lugar),
    agent: agentLabel('claude'),
    live: null,
    activity: activityAgo(r, ahora),
  };
}

import { splitDone } from './recent.ts';
import type { RecentGroup } from './recent.ts';
import type { ProjectGroup } from './sessions.ts';
import type { ProjectInfo, RecentSession, SessionInfo } from '../types.ts';

export type SidebarGroup = { project: ProjectInfo; sessions: SessionInfo[]; pending: RecentSession[]; done: RecentSession[] };

/**
 * Grupos de la barra lateral: un grupo por cada proyecto visible, en el orden
 * fijo de la lista de proyectos (el harness primero), tenga o no sesiones, para
 * que un proyecto recién creado aparezca sin abrir antes una conversación. Las
 * sesiones en marcha y las conversaciones recientes se reparten en su proyecto;
 * las de proyectos desconocidos van al final, como grupos aparte.
 */
export function mergeGroups(vivas: readonly ProjectGroup[], recientes: readonly RecentGroup[], projects: readonly ProjectInfo[]): SidebarGroup[] {
  const porId = new Map<string, SidebarGroup>();
  for (const p of projects) {
    if (p.visible) porId.set(p.id, { project: p, sessions: [], pending: [], done: [] });
  }
  const huerfanos: SidebarGroup[] = [];
  const grupo = (project: ProjectInfo): SidebarGroup => {
    const existente = porId.get(project.id) ?? huerfanos.find((g) => g.project.id === project.id);
    if (existente) return existente;
    const nuevo: SidebarGroup = { project, sessions: [], pending: [], done: [] };
    huerfanos.push(nuevo);
    return nuevo;
  };
  for (const g of vivas) grupo(g.project).sessions = g.sessions;
  for (const g of recientes) Object.assign(grupo(g.project), splitDone(g.items));
  return [...porId.values(), ...huerfanos];
}

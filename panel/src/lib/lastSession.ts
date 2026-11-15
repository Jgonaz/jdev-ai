import type { AgentId, ProjectInfo } from '../types.ts';
import { AGENT_CHOICES } from './sessions.ts';
import { safeStorage } from './workspace.ts';

/** Proyecto y agente con los que se creó la última sesión desde el panel. */
export type LastSession = { project: string; agent: AgentId };

export const LAST_SESSION_KEY = 'jdev-panel:last-session';

/** Lo recordado; null si no hay nada, está corrupto o el agente ya no existe. */
export function loadLastSession(storage: Pick<Storage, 'getItem'> | null = safeStorage()): LastSession | null {
  try {
    const v = JSON.parse(storage?.getItem(LAST_SESSION_KEY) ?? 'null') as Partial<LastSession> | null;
    if (!v || typeof v.project !== 'string' || v.project === '') return null;
    if (typeof v.agent !== 'string' || !Object.hasOwn(AGENT_CHOICES, v.agent)) return null;
    return { project: v.project, agent: v.agent as AgentId };
  } catch {
    return null;
  }
}

export function saveLastSession(v: LastSession, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LAST_SESSION_KEY, JSON.stringify(v));
  } catch {
    // Almacenamiento bloqueado o lleno: el panel funciona igual, sin recordarlo.
  }
}

/** Proyecto que se propone al abrir: el de la terminal activa o el primero que no sea el harness. */
export function defaultProject(projects: readonly ProjectInfo[], activo: string | undefined): string {
  if (activo && projects.some((p) => p.id === activo)) return activo;
  return (projects.find((p) => !p.harness) ?? projects[0])?.id ?? '';
}

/**
 * Proyecto y agente que se proponen para una sesión nueva. Los valores explícitos
 * (`explicit`, p. ej. «Trabajar en esto» del backlog) mandan; después, lo último
 * usado si el proyecto sigue existiendo; y si no, el de la terminal activa y el
 * agente de Ajustes. `project` es '' si no hay proyectos.
 */
export function suggestSession(opciones: {
  projects: readonly ProjectInfo[];
  last: LastSession | null;
  explicit?: { project?: string; agent?: AgentId };
  activeProject?: string;
  settingsAgent: AgentId;
}): LastSession {
  const { projects, last, explicit, activeProject, settingsAgent } = opciones;
  const recordado = last && projects.some((p) => p.id === last.project) ? last : null;
  return {
    project: defaultProject(projects, explicit?.project ?? recordado?.project ?? activeProject),
    agent: explicit?.agent ?? recordado?.agent ?? settingsAgent,
  };
}

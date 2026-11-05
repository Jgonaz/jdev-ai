import type { ArchiveList, ProjectInfo, RecentSession, SessionInfo, VisualState } from '../types.ts';
import { fallbackProject, visualState } from './sessions.ts';
import { safeStorage } from './workspace.ts';

// Lógica pura de lo archivado en la barra lateral: qué se muestra en «Archivadas
// (N)», cómo se aplica la lista del servidor y el plegado recordado. Archivar solo
// aparta: la sesión sigue viva y, si espera, sigue contando en los avisos.

/** Una fila de «Archivadas»: una sesión del panel o una conversación de Claude. */
export type ArchivedEntry =
  | { kind: 'session'; session: SessionInfo; project: ProjectInfo; state: VisualState; hiddenProject: boolean }
  | { kind: 'conversation'; recent: RecentSession; project: ProjectInfo };

// Te espera primero, como en «En segundo plano»; las terminadas al final.
const RANK: Record<VisualState, number> = { waiting: 0, working: 1, idle: 2, alive: 2, shell: 2, closed: 3, ended: 4 };

/**
 * Filas de «Archivadas»: primero las sesiones (por estado y actividad reciente) y
 * después las conversaciones (las más recientes primero). Con las mismas reglas
 * que el resto de la barra: los proyectos ocultos no cuentan, salvo las sesiones
 * que esperan (siempre se avisan), y `hideClosed` omite lo marcado [Closed].
 * Una sesión de un proyecto desconocido se muestra con uno genérico; una
 * conversación de un proyecto que ya no está no se puede retomar y se omite.
 */
export function archivedEntries(
  sessions: readonly SessionInfo[],
  recent: readonly RecentSession[],
  projects: readonly ProjectInfo[],
  opciones: { hideClosed?: boolean } = {},
): ArchivedEntry[] {
  const porId = new Map(projects.map((p) => [p.id, p]));
  const vivas: Extract<ArchivedEntry, { kind: 'session' }>[] = [];
  for (const session of sessions) {
    if (!session.archived) continue;
    const state = visualState(session);
    if (opciones.hideClosed && state === 'closed') continue;
    const project = porId.get(session.project) ?? fallbackProject(session.project);
    const hiddenProject = !project.visible;
    if (hiddenProject && state !== 'waiting') continue;
    vivas.push({ kind: 'session', session, project, state, hiddenProject });
  }
  vivas.sort(
    (a, b) => RANK[a.state] - RANK[b.state] || b.session.updatedAt - a.session.updatedAt || a.session.name.localeCompare(b.session.name),
  );
  const conversaciones: Extract<ArchivedEntry, { kind: 'conversation' }>[] = [];
  for (const r of recent) {
    if (!r.archived || (opciones.hideClosed && r.closed)) continue;
    const project = porId.get(r.project);
    if (!project?.visible) continue;
    conversaciones.push({ kind: 'conversation', recent: r, project });
  }
  conversaciones.sort((a, b) => b.recent.lastActivity - a.recent.lastActivity || a.recent.id.localeCompare(b.recent.id));
  return [...vivas, ...conversaciones];
}

export const archivedKey = (e: ArchivedEntry): string => (e.kind === 'session' ? `s:${e.session.name}` : `c:${e.recent.id}`);

/** Sesiones y conversaciones que siguen en su proyecto y en «Anteriores». */
export const notArchived = <T extends { archived: boolean }>(items: readonly T[]): T[] => items.filter((i) => !i.archived);

/**
 * Aplica la lista del servidor a lo que ya hay en pantalla, sin esperar al
 * siguiente evento. Una sesión cuenta como archivada si coincide el nombre y la
 * creación (el nombre de tmux se reutiliza). Devuelve las mismas referencias si
 * nada cambia.
 */
export function applyArchive<T extends SessionInfo | RecentSession>(items: readonly T[], lista: ArchiveList): T[] {
  const sesiones = new Set(lista.sessions.map((s) => `${s.name}\0${s.created}`));
  const conversaciones = new Set(lista.conversations);
  let cambiado = false;
  const salida = items.map((i) => {
    const archived = 'name' in i ? sesiones.has(`${i.name}\0${i.created}`) : conversaciones.has(i.id);
    if (archived === i.archived) return i;
    cambiado = true;
    return { ...i, archived };
  });
  return cambiado ? salida : (items as T[]);
}

export function archivedHeading(n: number): string {
  return `Archivadas (${n})`;
}

// ---------------------------------------------------------------- Plegado en la barra lateral

export const ARCHIVED_COLLAPSED_KEY = 'jdev-panel:archived-collapsed';

/** Plegado recordado de «Archivadas»: desplegado por defecto o ante un valor ilegible. */
export function loadArchivedCollapsed(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(ARCHIVED_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveArchivedCollapsed(plegado: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(ARCHIVED_COLLAPSED_KEY, plegado ? '1' : '0');
  } catch {
    // Almacenamiento bloqueado: el panel funciona igual, sin recordarlo.
  }
}

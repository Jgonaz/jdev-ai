// Tipos de la API del panel (reflejan las respuestas de panel/server).
export type { Settings, ProjectOverride } from '../shared/settings-schema.ts';

export type SessionState = 'waiting' | 'working' | 'idle' | 'ended' | 'alive';

export type SessionInfo = {
  name: string;
  project: string;
  agent: string;
  /** Nombre del worktree ('' en el checkout principal). */
  worktree: string;
  branch: string | null;
  state: SessionState;
  /** true si el agente informa de turnos (Claude con hooks). */
  tracked: boolean;
  title: string;
  closed: boolean;
  alive: boolean;
  updatedAt: number;
  created: number;
};

export type Worktree = { name: string; path: string; branch: string | null };

export type ProjectInfo = {
  id: string;
  name: string;
  path: string;
  harness: boolean;
  branch: string | null;
  worktrees: Worktree[];
  mono: string;
  color: string;
  visible: boolean;
  defaultMono: string;
  defaultColor: string;
};

export type AgentId = 'claude' | 'codex' | 'copilot' | 'opencode';
export type LocationId = 'main' | 'new-worktree' | 'existing-worktree';

export type SessionRequest = {
  project: string;
  agent: AgentId;
  location: LocationId;
  feature?: string;
  prompt?: string;
  /** Id de una sesión reciente de Claude que se retoma (sin prompt). */
  resume?: string;
};

/** Sesión reciente de Claude que se puede retomar (GET /api/recent). */
export type RecentSession = {
  id: string;
  project: string;
  /** Nombre del worktree ('' en el checkout principal). */
  worktree: string;
  title: string;
  closed: boolean;
  /** Milisegundos desde la época de la última modificación del transcript. */
  lastActivity: number;
  /** Actividad en los últimos minutos: puede seguir abierta en otra ventana. */
  possiblyOpen: boolean;
  sizeBytes: number;
};

/** Estado visual de una sesión: lo que se pinta en luces, chips y textos. */
export type VisualState = 'waiting' | 'working' | 'idle' | 'closed' | 'alive' | 'ended';

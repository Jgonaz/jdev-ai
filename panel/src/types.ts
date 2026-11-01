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
  /** Texto del aviso del agente mientras espera ('' si no espera o no se conoce). */
  notice: string;
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

// ------------------------------------------------------------------ Backlog

export type BacklogState = 'backlog' | 'todo' | 'in-progress' | 'done' | 'discarded';
export type BacklogWarning = 'legacy' | 'invalid-yaml' | 'status-mismatch' | 'id-mismatch';

/** Elemento de GET /api/projects/:id/backlog (campos de las tarjetas). */
export type BacklogItem = {
  /** Nombre del archivo sin `.md`. */
  id: string;
  file: string;
  /** Estado según la carpeta (manda sobre el campo `status`). */
  status: BacklogState;
  title: string;
  type: string | null;
  priority: string | null;
  created: string | null;
  updated: string | null;
  summary: string | null;
  /** Tiempo estimado de lectura del resumen, en segundos (0 sin resumen). */
  readSeconds: number;
  warnings: BacklogWarning[];
  etag: string;
};

/** Elemento completo de GET /api/projects/:id/backlog/:itemId. */
export type BacklogDetail = BacklogItem & {
  header: Record<string, unknown> | null;
  /** Markdown tras el título `#`. */
  body: string;
  source: string;
  /** Ruta relativa a la raíz del proyecto (docs/backlog/<estado>/<archivo>). */
  path: string;
};

export type BacklogList = { items: BacklogItem[]; pending: number; hasBacklog: boolean };

/** Cambio de un archivo de docs/backlog en la vista previa del commit. */
export type CommitFile = { status: 'moved' | 'modified' | 'added' | 'deleted'; path: string; from?: string };

/** GET /api/projects/:id/backlog/commit-preview. */
export type CommitPreview = {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  remote: string | null;
  files: CommitFile[];
  message: string;
  fingerprint: string;
};

export type CommitPhase = 'commit' | 'push' | 'done' | 'error';

export type Guide = { path: string; title: string; updated: number };
export type GuideContent = { path: string; title: string; source: string };

export type WorktreeDetail = Worktree & {
  ahead: number | null;
  behind: number | null;
  dirty: boolean | null;
  /** Nombres de tmux de las sesiones del panel en este worktree. */
  sessions: string[];
};
export type WorktreeList = { base: string | null; worktrees: WorktreeDetail[] };

// ---------------------------------------------------------------- Historial

export type HistoryState = 'finalizada' | 'en curso' | 'bloqueada' | 'desconocido';

/** Entrada de GET /api/history (campos de la lista). */
export type HistoryEntry = {
  project: string;
  file: string;
  title: string;
  /** `YYYY-MM-DD HH:MM` o, si solo se conoce el día, `YYYY-MM-DD`. */
  date: string;
  /** La fecha no viene de un `Fecha:` válido (nombre del archivo o mtime). */
  approxDate: boolean;
  state: HistoryState;
  /** Primer pendiente sin marcar, o null. */
  firstPending: string | null;
  openPending: number;
  totalPending: number;
  etag: string;
  /** Es la última entrada de su proyecto (criterio de bin/session-status): sus pendientes son los vigentes. */
  latest: boolean;
};

export type PendingPoint = { index: number; text: string; done: boolean; doneDate: string | null };

/** Entrada completa de GET /api/history/:project/:file. */
export type HistoryDetail = HistoryEntry & {
  /** `.agent/history/<archivo>`. */
  path: string;
  rawState: string | null;
  /** Secciones `## ` sin «Pendiente de ti»; título '' para el texto previo a la primera. */
  sections: { title: string; body: string }[];
  hasPendingSection: boolean;
  pending: PendingPoint[];
  pendingNotes: string;
};

/** POST /api/history/pending/mark-old. */
export type MarkOldResult = {
  marked: number;
  entries: number;
  skipped: { project: string; file: string; reason: string }[];
};

// ------------------------------------------------------------------- Inicio

/** Proyecto de GET /api/overview. */
export type OverviewProject = {
  id: string;
  branch: string | null;
  backlog: { backlog: number; todo: number; inProgress: number };
  worktrees: number;
  /** Milisegundos desde la época (0 si no se conoce). */
  lastActivity: number;
  lastEntry: { title: string; state: HistoryState; file: string } | null;
};

/** GET /api/overview: resumen de los proyectos visibles para Inicio. */
export type Overview = {
  projects: OverviewProject[];
  /** Pendientes vigentes: solo los de la última entrada de cada proyecto visible. */
  history: { openPending: number; entriesWithPending: number };
  recent: HistoryEntry[];
  gitName: string | null;
};

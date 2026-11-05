import type { AgentId, ProjectInfo, ProjectOverride, SessionInfo, VisualState } from '../types.ts';

export const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  opencode: 'OpenCode',
  shell: 'Terminal',
};

/** Nombre del producto de cada agente, como se muestra en la cabecera global. */
export const AGENT_PRODUCTS: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
  opencode: 'OpenCode',
  shell: 'Terminal',
};

/** Opciones de agente (diálogo Nueva sesión, menú de la cabecera y Ajustes). */
export const AGENT_CHOICES: Record<AgentId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  opencode: 'OpenCode',
  shell: 'Terminal (sin agente)',
};

/** Agente «Terminal (sin agente)»: una shell normal, sin estado de turnos ni avisos. */
export const SHELL_AGENT = 'shell';

export const isShell = (s: Pick<SessionInfo, 'agent'>): boolean => s.agent === SHELL_AGENT;

export const STATE_LABELS: Record<VisualState, string> = {
  waiting: 'Te espera',
  working: 'Trabajando',
  idle: 'En reposo',
  closed: 'Cerrada',
  alive: 'Viva',
  ended: 'Terminada',
  shell: 'Terminal',
};

/**
 * Estado visual de una sesión. Una sesión que te espera o trabaja manda sobre la
 * marca «cerrada»; las que no informan de turnos (tracked=false) solo pueden
 * estar vivas o terminadas. Una terminal sin agente no tiene turnos ni marca
 * «cerrada»: o está viva (`shell`, con su icono) o terminó.
 */
export function visualState(s: Pick<SessionInfo, 'state' | 'closed' | 'alive' | 'tracked'> & { agent?: string }): VisualState {
  if (s.agent === SHELL_AGENT) return s.alive && s.state !== 'ended' ? 'shell' : 'ended';
  if (s.tracked) {
    if (s.state === 'waiting') return 'waiting';
    if (s.state === 'working') return 'working';
  }
  if (s.closed) return 'closed';
  if (!s.alive || s.state === 'ended') return 'ended';
  if (!s.tracked) return 'alive';
  return 'idle';
}

/** Proyecto con los overrides de Ajustes aplicados al instante, sin esperar a la API. */
export function effectiveProject(p: ProjectInfo, override: ProjectOverride | undefined): ProjectInfo {
  return {
    ...p,
    mono: override?.mono ?? p.defaultMono,
    color: override?.color ?? p.defaultColor,
    visible: override?.visible ?? true,
  };
}

/** Proyecto desconocido (sesión de un proyecto que ya no está en la lista). */
export function fallbackProject(id: string): ProjectInfo {
  return {
    id,
    name: id,
    path: '',
    harness: false,
    branch: null,
    worktrees: [],
    mono: id.slice(0, 2).toUpperCase() || '?',
    color: '#9aa1a9',
    visible: true,
    defaultMono: id.slice(0, 2).toUpperCase() || '?',
    defaultColor: '#9aa1a9',
  };
}

export type ProjectGroup = { project: ProjectInfo; sessions: SessionInfo[] };

/**
 * Agrupa las sesiones por proyecto manteniendo el orden de la lista de proyectos
 * (el harness primero). Los proyectos sin sesiones no se listan y los marcados
 * como no visibles se omiten; las sesiones de proyectos desconocidos van al final.
 */
export function groupSessions(
  sessions: readonly SessionInfo[],
  projects: readonly ProjectInfo[],
  opciones: { hideClosed?: boolean } = {},
): ProjectGroup[] {
  const visibles = opciones.hideClosed ? sessions.filter((s) => visualState(s) !== 'closed') : sessions;
  const grupos: ProjectGroup[] = [];
  const conocidos = new Set(projects.map((p) => p.id));
  for (const project of projects) {
    if (!project.visible) continue;
    const propias = visibles.filter((s) => s.project === project.id);
    if (propias.length > 0) grupos.push({ project, sessions: propias });
  }
  const huerfanas = new Map<string, SessionInfo[]>();
  for (const s of visibles) {
    if (conocidos.has(s.project)) continue;
    huerfanas.set(s.project, [...(huerfanas.get(s.project) ?? []), s]);
  }
  for (const [id, lista] of huerfanas) grupos.push({ project: fallbackProject(id), sessions: lista });
  return grupos;
}

/** Línea de metadatos: «wt zona-segura-ios · claude», «main · codex». */
export function sessionMeta(s: Pick<SessionInfo, 'worktree' | 'branch' | 'agent'>): string {
  const lugar = s.worktree ? `wt ${s.worktree}` : (s.branch ?? 'principal');
  return `${lugar} · ${s.agent === SHELL_AGENT ? 'terminal' : s.agent}`;
}

/** Dónde trabaja la sesión, para la cabecera de la terminal. */
export function sessionPlace(s: Pick<SessionInfo, 'worktree' | 'branch'>): string {
  if (s.worktree) return `wt ${s.branch ?? `feat/${s.worktree}`}`;
  return s.branch ?? 'principal';
}

export function waitingCount(sessions: readonly SessionInfo[]): number {
  return sessions.filter((s) => visualState(s) === 'waiting').length;
}

export function waitingLabel(n: number): string {
  return n === 1 ? '1 sesión te espera' : `${n} sesiones te esperan`;
}

/** Texto del chip de estado de la cabecera de una terminal. */
export function stateChip(s: SessionInfo, relativo: string): string {
  const v = visualState(s);
  const base = STATE_LABELS[v];
  return v === 'closed' || v === 'alive' || v === 'ended' || v === 'shell' ? base : `${base} · ${relativo}`;
}

/** Comando para abrir la misma sesión desde otra terminal (`socket` es el que usa el servidor). */
export function attachCommand(sesion: string, socket: string): string {
  return `tmux -L ${socket} attach -t ${sesion}`;
}

import { StateStore, deriveState, stateByTmuxSession } from './states.ts';
import type { SessionState } from './states.ts';
import { TitleReader, bestTitle, defaultTitle, parseTitle } from './titles.ts';
import { createSession, killSession, listSessions } from './tmux.ts';
import type { CreateOptions, SessionPlan, TmuxConfig } from './tmux.ts';
import type { Project } from './projects.ts';

export type SessionInfo = {
  name: string;
  project: string;
  agent: string;
  /** Nombre del worktree ('' en el checkout principal). */
  worktree: string;
  /** Rama del worktree o del checkout principal, si se conoce. */
  branch: string | null;
  state: SessionState;
  /** true si el agente informa de turnos (hay archivo de estado de Claude). */
  tracked: boolean;
  title: string;
  closed: boolean;
  alive: boolean;
  /** Milisegundos desde la época del último cambio conocido. */
  updatedAt: number;
  created: number;
  /** Comando equivalente de bin/agent, si se conoce (solo en la respuesta de creación). */
  command?: string;
};

/**
 * Instante del último cambio de una sesión que se muestra como «hace X».
 *
 * Con estado de hooks (tracked) es el `updated_at` del archivo de estado; si no
 * es legible (0), la creación. Sin estado es la creación: no se usa
 * `session_activity` de tmux porque también cambia al adjuntar un cliente o
 * redimensionar, y la última salida del pane (`window_activity`) tampoco
 * sirve: un redimensionado hace que la shell se repinte y cuenta como salida.
 */
export function lastChange(created: number, file: { updatedAt: number } | undefined): number {
  return file && file.updatedAt > 0 ? file.updatedAt : created;
}

const PROJECTS_TTL_MS = 10000;
const EMIT_DEBOUNCE_MS = 100;

export type SessionServiceOptions = {
  tmux: TmuxConfig;
  stateDir: string;
  listProjects: () => Promise<Project[]>;
  /** Se invoca (con debounce) cuando cambia algo de la lista combinada. */
  onChange: (sesiones: SessionInfo[]) => void;
  /** Relectura periódica de tmux y de los títulos. */
  pollMs?: number;
  stateFallbackMs?: number;
};

/**
 * Combina las sesiones de tmux, el estado de los hooks y los títulos del
 * transcript en la lista que sirve el panel, y avisa de los cambios.
 */
export class SessionService {
  private readonly opts: SessionServiceOptions;
  private readonly states: StateStore;
  private readonly titles = new TitleReader();
  private current: SessionInfo[] = [];
  private emitted = '';
  private projects: { at: number; list: Project[] } | null = null;
  private poll: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private running: Promise<SessionInfo[]> | null = null;
  private again = false;
  /** Sesiones del panel creadas con `resume`: nombre de tmux → id de la sesión retomada. */
  private readonly resumed = new Map<string, string>();

  constructor(opts: SessionServiceOptions) {
    this.opts = opts;
    this.states = new StateStore(opts.stateDir, () => this.schedule(), opts.stateFallbackMs);
  }

  get tmux(): TmuxConfig {
    return this.opts.tmux;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.states.start();
    this.emitted = JSON.stringify(await this.refresh());
    this.poll = setInterval(() => this.schedule(), this.opts.pollMs ?? 2000);
    this.poll.unref();
  }

  stop(): void {
    this.stopped = true;
    this.states.stop();
    if (this.poll) clearInterval(this.poll);
    if (this.timer) clearTimeout(this.timer);
    this.poll = this.timer = null;
  }

  /** Última lista calculada. */
  list(): SessionInfo[] {
    return this.current;
  }

  /**
   * Ids de las sesiones de Claude que ya están en el panel: las de los archivos
   * de estado cuya sesión de tmux sigue en la lista (y es posterior a la
   * creación de esa sesión, porque los nombres se reutilizan) y las retomadas
   * con `resume` desde el panel, por si Claude las continúa con otro id.
   */
  panelSessionIds(): Set<string> {
    const creada = new Map(this.current.map((s) => [s.name, s.created]));
    const ids = new Set<string>();
    for (const f of this.states.snapshot()) {
      const desde = creada.get(f.tmuxSession);
      if (desde !== undefined && f.updatedAt >= Math.floor(desde / 1000) * 1000) ids.add(f.sessionId);
    }
    for (const [name, id] of this.resumed) {
      if (creada.has(name)) ids.add(id);
      else this.resumed.delete(name);
    }
    return ids;
  }

  /** Proyectos (con ramas) con una caché corta: listProjects ejecuta git. */
  async projectList(forzar = false): Promise<Project[]> {
    const ahora = Date.now();
    if (forzar || !this.projects || ahora - this.projects.at > PROJECTS_TTL_MS) {
      this.projects = { at: ahora, list: await this.opts.listProjects() };
    }
    return this.projects.list;
  }

  async create(plan: SessionPlan, opciones: CreateOptions): Promise<SessionInfo> {
    const { name } = await createSession(this.opts.tmux, plan, opciones);
    this.emitIfChanged(await this.refresh());
    if (plan.resume) this.resumed.set(name, plan.resume);
    const info = this.current.find((s) => s.name === name);
    if (!info) throw new Error('la sesión se creó pero ya no está en tmux');
    return { ...info, command: plan.command };
  }

  kill(name: string): Promise<boolean> {
    return killSession(this.opts.tmux, name).then(async (existia) => {
      this.emitIfChanged(await this.refresh());
      return existia;
    });
  }

  private schedule(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh().then((lista) => this.emitIfChanged(lista));
    }, EMIT_DEBOUNCE_MS);
    this.timer.unref();
  }

  private emitIfChanged(lista: SessionInfo[]): void {
    const firma = JSON.stringify(lista);
    if (firma === this.emitted) return;
    this.emitted = firma;
    if (!this.stopped) this.opts.onChange(lista);
  }

  /** Recalcula la lista. Las llamadas concurrentes se serializan. */
  refresh(): Promise<SessionInfo[]> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let lista: SessionInfo[];
      do {
        this.again = false;
        lista = await this.compute();
      } while (this.again && !this.stopped);
      return lista;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async compute(): Promise<SessionInfo[]> {
    let sesiones;
    try {
      sesiones = await listSessions(this.opts.tmux);
    } catch (e) {
      console.error('No se pudo listar las sesiones de tmux:', e instanceof Error ? e.message : e);
      return this.current;
    }
    await this.states.refresh();
    const estados = stateByTmuxSession(this.states.snapshot(), sesiones);
    let proyectos: Project[] = [];
    try {
      proyectos = await this.projectList();
    } catch {
      // Sin ramas, pero la lista sigue sirviéndose.
    }

    const lista: SessionInfo[] = [];
    for (const s of sesiones) {
      const file = estados.get(s.name);
      const bruto = file?.transcriptPath ? bestTitle(await this.titles.readTitles(file.transcriptPath)) : null;
      const parsed = bruto === null ? null : parseTitle(bruto);
      const proyecto = proyectos.find((p) => p.id === s.project);
      const branch = s.worktree
        ? (proyecto?.worktrees.find((w) => w.name === s.worktree)?.branch ?? null)
        : (proyecto?.branch ?? null);
      lista.push({
        name: s.name,
        project: s.project,
        agent: s.agent,
        worktree: s.worktree,
        branch,
        state: deriveState(file, s.alive),
        tracked: file !== undefined,
        title: parsed && parsed.title !== '' ? parsed.title : defaultTitle(s.project, s.agent, s.created),
        closed: parsed?.closed ?? false,
        alive: s.alive,
        updatedAt: lastChange(s.created, file),
        created: s.created,
      });
    }
    lista.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));
    this.current = lista;
    return lista;
  }
}

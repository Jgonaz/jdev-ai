import { dirname, join } from 'node:path';
import type { ArchiveStore } from './archive.ts';
import { DirStore } from './dirstore.ts';
import { claudeConfigDir } from './paths.ts';
import { StateStore, deriveState, stateByTmuxSession } from './states.ts';
import type { SessionState } from './states.ts';
import { CLOSED_MARK, TitleReader, appendCustomTitle, bestTitle, defaultTitle, parseTitle, resolveTranscript } from './titles.ts';
import { createSession, isPanelSessionName, killSession, listSessions, setSessionTitle } from './tmux.ts';
import type { CreateOptions, SessionPlan, TmuxConfig } from './tmux.ts';
import { ACTIVITY_MAX_BYTES, STATUSLINE_MAX_BYTES, accountFrom, deriveActivity, followTargets, parseActivityLog, parseStatusline } from './usage.ts';
import type { Account, ActivityEvent, SessionActivity, SessionUsage, Statusline } from './usage.ts';
import type { Project } from './projects.ts';
import type { FollowContext } from './follow.ts';

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
  /**
   * Texto del aviso del agente mientras la sesión espera (p. ej. el permiso que
   * pide), tal como llega de Claude; '' si no espera o no se conoce.
   */
  notice: string;
  /**
   * Modelo, esfuerzo, contexto y worktree según la statusline de Claude (solo en
   * las sesiones de Claude lanzadas desde el panel que ya la han escrito).
   */
  usage: SessionUsage | null;
  /** Subagentes, shells en segundo plano y artifacts de la sesión; null si no hay ninguno. */
  activity: SessionActivity | null;
  /** La persona la ha archivado: sigue viva, pero se muestra aparte en la barra lateral. */
  archived: boolean;
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

/** Agente de las terminales sin agente (una shell normal): no tienen estado de hooks, statusline ni seguimiento. */
export const SHELL_AGENT = 'shell';

const PROJECTS_TTL_MS = 10000;
const EMIT_DEBOUNCE_MS = 100;

export type SessionServiceOptions = {
  tmux: TmuxConfig;
  stateDir: string;
  /** Statusline de Claude por sesión; por defecto, `statusline/` junto a stateDir. */
  statuslineDir?: string;
  /** Registro de actividad por sesión; por defecto, `activity/` junto a stateDir. */
  activityDir?: string;
  /** Lista de archivadas; sin ella, ninguna sesión lo está. */
  archive?: ArchiveStore;
  /** Directorio de proyectos de Claude (con los transcripts); por defecto, el de CLAUDE_CONFIG_DIR o ~/.claude. */
  claudeProjectsDir?: string;
  listProjects: () => Promise<Project[]>;
  /** Se invoca (con debounce) cuando cambia algo de la lista combinada. */
  onChange: (sesiones: SessionInfo[]) => void;
  /** Se invoca cuando cambian los límites de la cuenta (null si dejan de conocerse). */
  onAccount?: (account: Account | null) => void;
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
  private readonly statuslines: DirStore<Statusline>;
  private readonly activities: DirStore<ActivityEvent[]>;
  private readonly titles = new TitleReader();
  private current: SessionInfo[] = [];
  private emitted = '';
  private account: Account | null = null;
  private emittedAccount = 'null';
  /** Sesión de Claude → instante del último SessionStart visto: la actividad anterior es de una ejecución previa. */
  private readonly restarted = new Map<string, number>();
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
    this.statuslines = new DirStore<Statusline>({
      dir: opts.statuslineDir ?? join(dirname(opts.stateDir), 'statusline'),
      ext: '.json',
      maxBytes: STATUSLINE_MAX_BYTES,
      // El nombre manda: una statusline que dice ser de otra sesión no se usa.
      parse: (contenido, mtimeMs, id) => {
        const s = parseStatusline(contenido, mtimeMs);
        return s && s.sessionId === id ? s : null;
      },
      onChange: () => this.schedule(),
      pollMs: opts.stateFallbackMs,
    });
    this.activities = new DirStore<ActivityEvent[]>({
      dir: opts.activityDir ?? join(dirname(opts.stateDir), 'activity'),
      ext: '.jsonl',
      maxBytes: ACTIVITY_MAX_BYTES,
      parse: (contenido) => parseActivityLog(contenido),
      onChange: () => this.schedule(),
      pollMs: opts.stateFallbackMs,
    });
  }

  get tmux(): TmuxConfig {
    return this.opts.tmux;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await Promise.all([this.states.start(), this.statuslines.start(), this.activities.start()]);
    this.emitted = JSON.stringify(await this.refresh());
    this.emittedAccount = JSON.stringify(this.account);
    this.poll = setInterval(() => this.schedule(), this.opts.pollMs ?? 2000);
    this.poll.unref();
  }

  stop(): void {
    this.stopped = true;
    this.states.stop();
    this.statuslines.stop();
    this.activities.stop();
    if (this.poll) clearInterval(this.poll);
    if (this.timer) clearTimeout(this.timer);
    this.poll = this.timer = null;
  }

  /** Última lista calculada. */
  list(): SessionInfo[] {
    return this.current;
  }

  /**
   * Lo necesario para seguir los subagentes y shells de una sesión del panel:
   * su session_id, su transcript y qué ids constan en su actividad. null si la
   * sesión no existe o aún no ha dejado estado de Claude.
   */
  followContext(name: string): FollowContext | null {
    const sesion = this.current.find((s) => s.name === name);
    // Una terminal sin agente no tiene hooks ni nada que seguir.
    if (!sesion || sesion.agent === SHELL_AGENT) return null;
    const file = stateByTmuxSession(this.states.snapshot(), this.current).get(name);
    if (!file) return null;
    return {
      sessionId: file.sessionId,
      transcriptPath: file.transcriptPath,
      cwd: file.cwd,
      targets: followTargets(this.activities.snapshot().get(file.sessionId) ?? [], this.restarted.get(file.sessionId) ?? 0),
    };
  }

  /** Límites de la cuenta de la statusline más reciente de una sesión del panel; null si no se conocen. */
  accountLimits(): Account | null {
    return this.account;
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

  /**
   * Cambia el título de una sesión. Con transcript de Claude (archivo de estado
   * con transcript_path dentro del directorio de proyectos de Claude) añade una
   * línea custom-title, que es de donde Claude y bin/session-title leen el
   * título, y conserva la marca «[Closed] » si la tenía. Sin transcript (otros
   * agentes, o Claude sin estado aún) lo guarda en la opción @jdev_title de la
   * sesión de tmux. `title` ya viene validado. Devuelve false si la sesión no
   * existe; lanza TranscriptRejected si su transcript queda fuera de Claude.
   */
  async rename(name: string, title: string): Promise<boolean> {
    const sesiones = await listSessions(this.opts.tmux);
    if (!sesiones.some((s) => s.name === name)) return false;
    await this.states.refresh();
    const file = stateByTmuxSession(this.states.snapshot(), sesiones).get(name);
    const real = file?.transcriptPath
      ? await resolveTranscript(file.transcriptPath, this.opts.claudeProjectsDir ?? join(claudeConfigDir(), 'projects'))
      : null;
    if (file && real) {
      const actual = bestTitle(await this.titles.readTitles(real));
      const cerrada = actual !== null && parseTitle(actual).closed;
      await appendCustomTitle(real, file.sessionId, cerrada ? `${CLOSED_MARK}${title}` : title);
    } else if (!(await setSessionTitle(this.opts.tmux, name, title))) {
      return false;
    }
    this.emitIfChanged(await this.refresh());
    return true;
  }

  /**
   * Archiva o desarchiva una sesión del panel. Al archivar devuelve false si la
   * sesión no existe; al desarchivar basta con quitarla de la lista, exista o no.
   */
  async setArchived(name: string, archived: boolean): Promise<boolean> {
    const archive = this.opts.archive;
    if (!archive) return false;
    const sesion = (await listSessions(this.opts.tmux)).find((s) => s.name === name);
    if (archived && !sesion) return false;
    if (archive.setSession(name, sesion?.created ?? 0, archived)) this.emitIfChanged(await this.refresh());
    return true;
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
    const cuenta = JSON.stringify(this.account);
    if (cuenta !== this.emittedAccount) {
      this.emittedAccount = cuenta;
      if (!this.stopped) this.opts.onAccount?.(this.account);
    }
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
    // Solo con una lista de tmux leída con éxito: un fallo no debe vaciar lo archivado.
    this.opts.archive?.pruneSessions(sesiones);
    await Promise.all([this.states.refresh(), this.statuslines.refresh(), this.activities.refresh()]);
    const estados = stateByTmuxSession(this.states.snapshot(), sesiones);
    // Si dentro de una terminal sin agente se lanza un agente, sus hooks dejarían
    // un estado atribuido a esa sesión: no se tiene en cuenta (sería un «te espera»).
    for (const s of sesiones) if (s.agent === SHELL_AGENT) estados.delete(s.name);
    this.noteRestarts();
    await this.pruneEnded(sesiones);
    let proyectos: Project[] = [];
    try {
      proyectos = await this.projectList();
    } catch {
      // Sin ramas, pero la lista sigue sirviéndose.
    }

    const lista: SessionInfo[] = [];
    for (const s of sesiones) {
      const file = estados.get(s.name);
      // Prioridad: título propio del transcript (custom-title), el del renombrado
      // sin transcript (@jdev_title) y el que genera Claude (ai-title).
      const titulos = file?.transcriptPath ? await this.titles.readTitles(file.transcriptPath) : { custom: null, ai: null };
      const bruto = titulos.custom ?? (s.title !== '' ? s.title : null) ?? titulos.ai;
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
        notice: file && s.alive && file.state === 'waiting' ? file.message : '',
        usage: (file ? this.statuslines.snapshot().get(file.sessionId)?.usage : undefined) ?? null,
        // Una sesión terminada ya no tiene nada en marcha, aunque su último Stop dijera otra cosa.
        activity:
          file && s.alive && file.state !== 'ended'
            ? deriveActivity(this.activities.snapshot().get(file.sessionId) ?? [], this.restarted.get(file.sessionId) ?? 0)
            : null,
        archived: this.opts.archive?.hasSession(s.name, s.created) ?? false,
      });
    }
    lista.sort((a, b) => a.created - b.created || a.name.localeCompare(b.name));
    this.current = lista;
    this.account = accountFrom(
      [...estados.values()].flatMap((f) => {
        const st = this.statuslines.snapshot().get(f.sessionId);
        return st ? [st] : [];
      }),
    );
    return lista;
  }

  /**
   * Un SessionStart (sesión nueva, reanudada o tras /clear) deja sin efecto la
   * actividad registrada antes: sus subagentes ya no existen.
   */
  private noteRestarts(): void {
    for (const f of this.states.snapshot()) {
      if (f.event === 'SessionStart') this.restarted.set(f.sessionId, Math.max(this.restarted.get(f.sessionId) ?? 0, f.updatedAt));
    }
  }

  /**
   * Borra la statusline y la actividad de las sesiones del panel que ya han
   * terminado: su sesión de tmux ya no existe o es posterior al último estado
   * que dejó (el nombre se reutilizó). Los archivos de estado no se tocan.
   */
  private async pruneEnded(sesiones: readonly { name: string; created: number }[]): Promise<void> {
    const creada = new Map(sesiones.map((s) => [s.name, s.created]));
    for (const f of this.states.snapshot()) {
      if (!isPanelSessionName(f.tmuxSession)) continue;
      const desde = creada.get(f.tmuxSession);
      if (desde !== undefined && f.updatedAt >= Math.floor(desde / 1000) * 1000) continue;
      this.restarted.delete(f.sessionId);
      if (this.statuslines.snapshot().has(f.sessionId)) await this.statuslines.remove(f.sessionId);
      if (this.activities.snapshot().has(f.sessionId)) await this.activities.remove(f.sessionId);
    }
  }
}

import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Project } from './projects.ts';

// Todas las llamadas a tmux usan execFile (sin shell) contra un servidor propio
// (`tmux -L <socket> -f panel/tmux.conf`), para no mezclarse con el tmux personal.

// «shell» no es un agente: es una terminal normal (la shell de login de la
// persona) en la carpeta de un proyecto, sin bin/agent.
export const AGENT_IDS = ['claude', 'codex', 'copilot', 'opencode', 'shell'] as const;
export type AgentId = (typeof AGENT_IDS)[number];
export const LOCATION_IDS = ['main', 'new-worktree', 'existing-worktree'] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

export const DEFAULT_SOCKET = 'jdev';
// Valor de JDEV_SURFACE de las sesiones que crea el panel.
export const PANEL_SURFACE = 'panel';
export const MAX_PROMPT_LENGTH = 20000;
// Id de una sesión de Claude (UUID en minúsculas), tal como nombra sus transcripts.
const RESUME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Nombre de una sesión del panel: jdev-<proyecto saneado>-<n>.
const SESSION_NAME = /^jdev-[a-z0-9_-]+-[0-9]+$/;
const SOCKET_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

const AGENT_FLAGS: Record<Exclude<AgentId, 'shell'>, string | null> = {
  claude: null, // Claude es el agente por defecto de bin/agent
  codex: '--codex',
  copilot: '--copilot',
  opencode: '--opencode',
};

// Variables del entorno del panel que se pasan a cada sesión. Un servidor tmux
// longevo conserva el entorno con el que arrancó, que puede estar desfasado
// (PATH, directorios XDG); así las sesiones ven el actual.
const FORWARDED_ENV = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'CLAUDE_CONFIG_DIR',
];

export class SessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionInputError';
  }
}

export type SessionInput = {
  project: string;
  agent: AgentId;
  location: LocationId;
  feature?: string;
  prompt?: string;
  /** Id de una sesión de Claude que se retoma (solo con agent claude y sin prompt). */
  resume?: string;
};

export type SessionPlan = {
  project: string;
  agent: AgentId;
  location: LocationId;
  /** Nombre del worktree ('' en el checkout principal). */
  worktree: string;
  /** Id de la sesión de Claude que se retoma, si se pidió. */
  resume?: string;
  /** Argumentos de bin/agent, como lista (vacía en una terminal sin agente). */
  agentArgs: string[];
  /** Argv completo: ruta de bin/agent y sus argumentos (la shell de login en una terminal sin agente). */
  argv: string[];
  /**
   * Carpeta de trabajo de la sesión de tmux. Con bin/agent es la del harness
   * (bin/agent resuelve el proyecto); en una terminal sin agente, la del proyecto
   * o la de su worktree. Si falta, la del harness.
   */
  cwd?: string;
  /** Comando legible equivalente, para mostrarlo en la interfaz. */
  command: string;
};

export type TmuxConfig = {
  socket: string;
  confFile: string;
  harnessRoot: string;
  /**
   * Solo para pruebas: sustituye `<harness>/bin/agent <args>` por otro comando
   * (recibe los argumentos de bin/agent y devuelve el argv a ejecutar).
   */
  launcher?: (agentArgs: string[]) => string[];
};

export type TmuxSession = {
  name: string;
  project: string;
  agent: string;
  worktree: string;
  /** Milisegundos desde la época. */
  created: number;
  activity: number;
  /** false si el proceso de la sesión terminó pero la sesión sigue en tmux. */
  alive: boolean;
  attached: number;
  /** Título propio guardado con el renombrado del panel (@jdev_title); '' si no hay. */
  title: string;
};

export function tmuxConfig(
  harnessRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  extra: Partial<Pick<TmuxConfig, 'launcher' | 'socket' | 'confFile'>> = {},
): TmuxConfig {
  const socket = extra.socket ?? (env.JDEV_PANEL_TMUX_SOCKET || DEFAULT_SOCKET);
  if (!SOCKET_NAME.test(socket)) throw new Error(`nombre de socket de tmux no válido: ${socket}`);
  return {
    socket,
    confFile: extra.confFile ?? join(harnessRoot, 'panel', 'tmux.conf'),
    harnessRoot,
    launcher: extra.launcher,
  };
}

export function isPanelSessionName(name: string): boolean {
  return SESSION_NAME.test(name);
}

// ---------------------------------------------------------------- Validación

// Mismo criterio que validate_feature de bin/worktree: [a-z0-9._-], sin empezar
// por «.» ni «-», sin «..» y válido como rama (feat/<feature>): ningún
// componente puede terminar en «.» ni en «.lock».
export function validateFeature(feature: unknown): string {
  if (typeof feature !== 'string' || feature === '') {
    throw new SessionInputError('Indica el nombre de la feature.');
  }
  if (feature.length > 100) throw new SessionInputError('El nombre de la feature es demasiado largo (máximo 100).');
  if (feature.startsWith('.') || feature.startsWith('-')) {
    throw new SessionInputError('El nombre de la feature no puede empezar por «.» ni por «-».');
  }
  if (feature.includes('..')) throw new SessionInputError('El nombre de la feature no puede contener «..».');
  if (/[^a-z0-9._-]/.test(feature)) {
    throw new SessionInputError('El nombre de la feature solo admite minúsculas, números, «.», «_» y «-».');
  }
  if (feature.endsWith('.') || feature.endsWith('.lock')) {
    throw new SessionInputError('El nombre de la feature no es válido como rama de Git (no puede acabar en «.» ni en «.lock»).');
  }
  return feature;
}

function isAgent(valor: unknown): valor is AgentId {
  return typeof valor === 'string' && (AGENT_IDS as readonly string[]).includes(valor);
}

function isLocation(valor: unknown): valor is LocationId {
  return typeof valor === 'string' && (LOCATION_IDS as readonly string[]).includes(valor);
}

// Cita un argumento para mostrarlo en la interfaz como lo escribiría una
// persona en una shell. Solo es presentación: nunca se ejecuta.
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  if (!/["$`\\!]/.test(arg)) return `"${arg}"`;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

// Valida la petición contra la lista de proyectos y construye los argumentos de
// bin/agent como lista. Lanza SessionInputError con un mensaje apto para
// mostrar a la persona.
export function planSession(
  entrada: unknown,
  projects: readonly Project[],
  harnessRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): SessionPlan {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
    throw new SessionInputError('Se esperaba un objeto con la sesión a crear.');
  }
  const e = entrada as Record<string, unknown>;

  if (typeof e.project !== 'string' || e.project === '') throw new SessionInputError('Indica el proyecto.');
  const project = projects.find((p) => p.id === e.project);
  if (!project) throw new SessionInputError(`El proyecto «${e.project}» no existe.`);

  const agent = e.agent ?? 'claude';
  if (!isAgent(agent)) throw new SessionInputError('Agente no válido: usa claude, codex, copilot, opencode o shell.');

  const location = e.location ?? 'main';
  if (!isLocation(location)) {
    throw new SessionInputError('Ubicación no válida: usa main, new-worktree o existing-worktree.');
  }

  const esShell = agent === 'shell';
  if (esShell && location === 'new-worktree') {
    throw new SessionInputError('Una terminal sin agente no crea worktrees: usa el checkout principal o un worktree existente.');
  }

  let worktree = '';
  if (location !== 'main') {
    if (project.harness) {
      throw new SessionInputError('El propio harness no admite worktrees: usa el checkout principal.');
    }
    const feature = validateFeature(e.feature);
    if (location === 'existing-worktree' && !project.worktrees.some((w) => w.name === feature)) {
      throw new SessionInputError(`El worktree «${feature}» no existe en ${project.id}.`);
    }
    worktree = feature;
  }

  let prompt = '';
  if (e.prompt !== undefined && e.prompt !== null) {
    if (typeof e.prompt !== 'string') throw new SessionInputError('El prompt debe ser un texto.');
    if (esShell && e.prompt.trim() !== '') throw new SessionInputError('Una terminal sin agente no admite prompt inicial.');
    if (e.prompt.length > MAX_PROMPT_LENGTH) {
      throw new SessionInputError(`El prompt es demasiado largo (máximo ${MAX_PROMPT_LENGTH} caracteres).`);
    }
    if (e.prompt.includes('\0')) throw new SessionInputError('El prompt no puede contener caracteres nulos.');
    prompt = e.prompt.trim() === '' ? '' : e.prompt;
  }

  let resume = '';
  if (e.resume !== undefined && e.resume !== null) {
    if (esShell) throw new SessionInputError('Una terminal sin agente no retoma sesiones.');
    if (typeof e.resume !== 'string' || !RESUME_ID.test(e.resume)) {
      throw new SessionInputError('El id de la sesión a retomar no es válido.');
    }
    if (agent !== 'claude') throw new SessionInputError('Solo se pueden retomar sesiones de Claude.');
    if (prompt) throw new SessionInputError('No se puede indicar un prompt al retomar una sesión.');
    resume = e.resume;
  }

  if (esShell) return planShell(project, worktree, location, env);

  // bin/agent resuelve los proyectos dentro de projects/; el propio harness se
  // abre con «.» desde su carpeta (el cwd de la sesión de tmux).
  const agentArgs: string[] = [project.harness ? '.' : project.id];
  const flag = AGENT_FLAGS[agent];
  if (flag) agentArgs.push(flag);
  if (worktree) agentArgs.push('--wt', worktree);
  if (prompt) agentArgs.push('--', prompt);
  if (resume) agentArgs.push('--', '--resume', resume);

  const agentPath = join(harnessRoot, 'bin', 'agent');
  return {
    project: project.id,
    agent,
    location,
    worktree,
    ...(resume ? { resume } : {}),
    agentArgs,
    argv: [agentPath, ...agentArgs],
    command: ['bin/agent', ...agentArgs].map(shellQuote).join(' '),
  };
}

// Shell de login de la persona: `$SHELL` si es una ruta absoluta ejecutable
// (tmux ejecuta el argv sin pasar por una shell, así que no se resuelve por
// PATH) y, si no, bash.
function loginShell(env: NodeJS.ProcessEnv): string {
  const candidata = env.SHELL;
  if (candidata && isAbsolute(candidata)) {
    try {
      if (statSync(candidata).isFile()) {
        accessSync(candidata, constants.X_OK);
        return candidata;
      }
    } catch {
      // No existe o no es ejecutable: se usa bash.
    }
  }
  return 'bash';
}

// Terminal sin agente: la shell de login, interactiva (sin «-c»), en la carpeta
// del proyecto o de su worktree. Esa carpeta tiene que existir.
function planShell(project: Project, worktree: string, location: LocationId, env: NodeJS.ProcessEnv): SessionPlan {
  const carpeta = worktree ? project.worktrees.find((w) => w.name === worktree)?.path : project.path;
  let esDirectorio = false;
  try {
    esDirectorio = carpeta !== undefined && carpeta !== '' && statSync(carpeta).isDirectory();
  } catch {
    // No existe: se rechaza abajo.
  }
  if (!carpeta || !esDirectorio) {
    throw new SessionInputError(
      worktree
        ? `La carpeta del worktree «${worktree}» no existe en ${project.id}.`
        : `La carpeta del proyecto «${project.id}» no existe.`,
    );
  }
  const shell = loginShell(env);
  const argv = [shell, '-l'];
  return {
    project: project.id,
    agent: 'shell',
    location,
    worktree,
    agentArgs: [],
    argv,
    cwd: carpeta,
    command: `cd ${shellQuote(carpeta)} && ${argv.map(shellQuote).join(' ')}`,
  };
}

// ------------------------------------------------------------------ Ejecución

type ExecResult = { stdout: string; stderr: string };

export class TmuxError extends Error {
  readonly stderr: string;
  readonly code: number | string | null;
  constructor(mensaje: string, stderr: string, code: number | string | null) {
    super(mensaje);
    this.name = 'TmuxError';
    this.stderr = stderr;
    this.code = code;
  }
}

function tmuxEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Dentro de un tmux, un cliente nuevo se negaría a anidarse.
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

export function tmuxBaseArgs(cfg: TmuxConfig): string[] {
  return ['-L', cfg.socket, '-f', cfg.confFile];
}

function runTmux(cfg: TmuxConfig, args: string[]): Promise<ExecResult> {
  return new Promise((ok, ko) => {
    execFile(
      'tmux',
      [...tmuxBaseArgs(cfg), ...args],
      { env: tmuxEnv(), timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (error: ExecFileException | null, stdout, stderr) => {
        if (error) {
          ko(new TmuxError(`tmux ${args[0] ?? ''} falló: ${stderr.trim() || error.message}`, stderr, error.code ?? null));
          return;
        }
        ok({ stdout, stderr });
      },
    );
  });
}

// tmux trata como separador de comandos un argumento que termina en «;». Para
// que un prompt o un valor acabado en «;» llegue intacto se escapa como «\;».
function arg(valor: string): string {
  return valor.endsWith(';') ? `${valor.slice(0, -1)}\\;` : valor;
}

// El servidor puede no estar arrancado (nadie ha creado sesiones todavía): no es un error.
function sinServidor(e: unknown): boolean {
  return e instanceof TmuxError && /no server running|error connecting to|no sessions|server exited unexpectedly|No such file or directory/i.test(e.stderr);
}

const LIST_FORMAT = [
  '#{session_name}',
  '#{@jdev_project}',
  '#{@jdev_agent}',
  '#{@jdev_worktree}',
  '#{@jdev_created}',
  '#{session_activity}',
  '#{session_created}',
  '#{session_attached}',
  '#{pane_dead}',
  '#{@jdev_title}',
].join('\t');

export async function listSessions(cfg: TmuxConfig): Promise<TmuxSession[]> {
  let salida: string;
  try {
    salida = (await runTmux(cfg, ['list-sessions', '-F', LIST_FORMAT])).stdout;
  } catch (e) {
    if (sinServidor(e)) return [];
    throw e;
  }
  const sesiones: TmuxSession[] = [];
  for (const linea of salida.split('\n')) {
    if (linea === '') continue;
    const [name = '', project = '', agent = '', worktree = '', createdIso = '', activity = '', created = '', attached = '', dead = '', title = ''] =
      linea.split('\t');
    if (!isPanelSessionName(name)) continue;
    const creadaIso = Date.parse(createdIso);
    sesiones.push({
      name,
      project,
      agent,
      worktree,
      created: Number.isNaN(creadaIso) ? Number(created) * 1000 : creadaIso,
      activity: Number(activity) * 1000,
      alive: dead !== '1',
      attached: Number(attached) || 0,
      title,
    });
  }
  return sesiones;
}

export async function sessionExists(cfg: TmuxConfig, name: string): Promise<boolean> {
  if (!isPanelSessionName(name)) return false;
  return (await listSessions(cfg)).some((s) => s.name === name);
}

// Directorio actual del panel activo de una sesión del panel (el del proceso
// del agente, que puede haber cambiado de carpeta), o null si la sesión no
// existe. Sirve para resolver rutas relativas que aparecen en su terminal.
export async function paneCurrentPath(cfg: TmuxConfig, name: string): Promise<string | null> {
  if (!isPanelSessionName(name)) return null;
  let salida: string;
  try {
    salida = (await runTmux(cfg, ['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}'])).stdout;
  } catch (e) {
    if (sinServidor(e) || (e instanceof TmuxError && /can't find (session|pane)/i.test(e.stderr))) return null;
    throw e;
  }
  // Solo se quita el salto de línea final: una ruta puede acabar en espacio.
  const ruta = salida.replace(/\r?\n$/, '');
  return ruta.startsWith('/') ? ruta : null;
}

// ------------------------------------------------------------------- Scroll

// Posición en el historial de tmux del panel activo de una sesión. El historial
// lo tiene tmux (cada terminal del panel es un cliente suyo), no xterm.js: la
// barra de scroll del panel se alimenta de aquí.
export type PaneScroll = {
  /** El panel está en copy-mode (el usuario ha subido por el historial). */
  inMode: boolean;
  /** Líneas por encima del final que se están viendo; 0 si no está en copy-mode. */
  position: number;
  /** Líneas guardadas en el historial, sin contar las visibles. */
  history: number;
  /** Alto visible del panel, en líneas. */
  height: number;
  /**
   * La aplicación usa la pantalla alternativa (Claude Code a pantalla completa,
   * vim, less…): el historial es suyo, no de tmux, y la barra le manda sus teclas.
   */
  alternate: boolean;
};

export const SCROLL_ACTIONS = ['top', 'bottom', 'page-up', 'page-down', 'line'] as const;
export type ScrollAction = (typeof SCROLL_ACTIONS)[number];
export type ScrollRequest = { action: ScrollAction; line?: number };
// Cota de «line»: de sobra para el máximo de history-limit (100000) y evita números absurdos.
export const MAX_SCROLL_LINE = 1_000_000;

/**
 * Valida el cuerpo de POST /api/sessions/:name/scroll. `line` es la posición
 * que se quiere ver, en la misma unidad que `position` de GET: líneas por encima
 * del final (0 = abajo, `history` = lo más antiguo). Es lo que entiende goto-line
 * de tmux, que cuenta desde abajo.
 */
export function checkScrollRequest(entrada: unknown): ScrollRequest {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
    throw new SessionInputError('Se esperaba un objeto con la acción de scroll.');
  }
  const e = entrada as Record<string, unknown>;
  const action = e.action;
  if (typeof action !== 'string' || !(SCROLL_ACTIONS as readonly string[]).includes(action)) {
    throw new SessionInputError(`Acción de scroll no válida: usa ${SCROLL_ACTIONS.join(', ')}.`);
  }
  if (action !== 'line') {
    if (e.line !== undefined) throw new SessionInputError('«line» solo se admite con la acción «line».');
    return { action: action as ScrollAction };
  }
  const line = e.line;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 0 || line > MAX_SCROLL_LINE) {
    throw new SessionInputError(`«line» debe ser un entero entre 0 y ${MAX_SCROLL_LINE}.`);
  }
  return { action: 'line', line };
}

function noSession(e: unknown): boolean {
  return sinServidor(e) || (e instanceof TmuxError && /can't find (session|pane|window)/i.test(e.stderr));
}

const SCROLL_FORMAT = ['#{pane_in_mode}', '#{scroll_position}', '#{history_size}', '#{pane_height}', '#{alternate_on}'].join('\t');

/** Posición de scroll de la sesión, o null si no existe. */
export async function paneScroll(cfg: TmuxConfig, name: string): Promise<PaneScroll | null> {
  if (!isPanelSessionName(name)) return null;
  let salida: string;
  try {
    salida = (await runTmux(cfg, ['display-message', '-p', '-t', `=${name}:`, SCROLL_FORMAT])).stdout;
  } catch (e) {
    if (noSession(e)) return null;
    throw e;
  }
  const [modo = '', posicion = '', historia = '', alto = '', alterna = ''] = salida.replace(/\r?\n$/, '').split('\t');
  // Con un objetivo inexistente display-message no falla: imprime los campos vacíos.
  if (!/^[0-9]+$/.test(alto)) return null;
  const entero = (v: string) => (/^[0-9]+$/.test(v) ? Number(v) : 0);
  const inMode = modo !== '0' && modo !== '';
  return {
    inMode,
    position: inMode ? entero(posicion) : 0,
    history: entero(historia),
    height: entero(alto),
    alternate: alterna === '1',
  };
}

/**
 * Teclas de scroll que se mandan a una aplicación en pantalla alternativa. Son
 * las de Claude Code a pantalla completa (RePág/AvPág, Ctrl+Inicio/Ctrl+Fin) y
 * valen también para less y vim. `line` no tiene equivalente: no se sabe dónde
 * está la aplicación, así que no hace nada.
 */
const ALTERNATE_KEYS: Partial<Record<ScrollAction, string>> = {
  top: 'C-Home',
  bottom: 'C-End',
  'page-up': 'PPage',
  'page-down': 'NPage',
};

/**
 * Mueve la vista por el historial de tmux y devuelve la posición resultante, o
 * null si la sesión no existe. Entrar en copy-mode usa `-e` (sale solo al llegar
 * abajo), como la rueda. `bottom` sin estar en copy-mode no hace nada. Si la
 * aplicación está en pantalla alternativa (y tmux no está en copy-mode), tmux no
 * tiene historial: la orden se traduce a teclas de la aplicación.
 */
export async function scrollPane(cfg: TmuxConfig, name: string, peticion: ScrollRequest): Promise<PaneScroll | null> {
  if (!isPanelSessionName(name)) return null;
  const t = `=${name}:`;
  const previo = await paneScroll(cfg, name);
  if (previo === null) return null;
  if (previo.alternate && !previo.inMode) {
    const tecla = ALTERNATE_KEYS[peticion.action];
    if (tecla) {
      try {
        await runTmux(cfg, ['send-keys', '-t', t, tecla]);
      } catch (e) {
        if (noSession(e)) return null;
        throw e;
      }
    }
    return paneScroll(cfg, name);
  }
  const entrar = ['copy-mode', '-e', '-t', t];
  const tecla = (...x: string[]) => ['send-keys', '-X', '-t', t, ...x];
  try {
    switch (peticion.action) {
      case 'top':
        await runTmux(cfg, [...entrar, ';', ...tecla('history-top')]);
        break;
      case 'page-up':
        await runTmux(cfg, [...entrar, ';', ...tecla('page-up')]);
        break;
      case 'line':
        await runTmux(cfg, [...entrar, ';', ...tecla('goto-line', String(peticion.line))]);
        break;
      case 'page-down':
      case 'bottom': {
        // Fuera de copy-mode no hay nada que bajar y send-keys -X fallaría.
        if (previo.inMode) await runTmux(cfg, tecla(peticion.action === 'bottom' ? 'cancel' : 'page-down'));
        break;
      }
    }
  } catch (e) {
    if (noSession(e)) return null;
    // Salió de copy-mode entre la lectura y la orden (p. ej. página abajo hasta el final).
    if (!(e instanceof TmuxError && /not in a mode/i.test(e.stderr))) throw e;
  }
  return paneScroll(cfg, name);
}

function sanitizeProject(project: string): string {
  const s = project
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'x' : s;
}

// Primer número libre para ese proyecto saneado.
function nextName(existentes: readonly TmuxSession[], base: string): string {
  const usados = new Set<number>();
  const prefijo = `jdev-${base}-`;
  for (const s of existentes) {
    if (!s.name.startsWith(prefijo)) continue;
    const n = s.name.slice(prefijo.length);
    if (/^[0-9]+$/.test(n)) usados.add(Number(n));
  }
  let n = 1;
  while (usados.has(n)) n++;
  return `${prefijo}${n}`;
}

export type CreateOptions = {
  /** Líneas de historial de tmux para la sesión (ajuste de scroll). */
  historyLimit?: number;
};

export type CreatedSession = { name: string; plan: SessionPlan };

// Crea la sesión en segundo plano ejecutando bin/agent (o el lanzador de
// pruebas) y guarda los metadatos como opciones de usuario en la misma
// invocación de tmux, para que nunca exista una sesión sin ellos.
export async function createSession(
  cfg: TmuxConfig,
  plan: SessionPlan,
  opciones: CreateOptions = {},
): Promise<CreatedSession> {
  const historial = Math.min(100000, Math.max(100, Math.trunc(opciones.historyLimit ?? 5000)));
  // El lanzador de pruebas sustituye a bin/agent, no a la shell de una terminal sin agente.
  const argv = cfg.launcher && plan.agent !== 'shell' ? cfg.launcher(plan.agentArgs) : plan.argv;
  if (argv.length === 0) throw new Error('el lanzador no devolvió ningún comando');
  const base = sanitizeProject(plan.project);
  const entorno = [
    ...FORWARDED_ENV.flatMap((k) => {
      const v = process.env[k];
      return v === undefined || v === '' ? [] : ['-e', arg(`${k}=${v}`)];
    }),
    // Superficie de trabajo (rules/surface.md). Va siempre, también al retomar
    // una sesión, porque --resume arranca un proceso nuevo; bin/agent la valida
    // y la exporta, y no se hereda del entorno del panel.
    '-e',
    `JDEV_SURFACE=${PANEL_SURFACE}`,
    // Claude Code con su renderizador clásico (no el de pantalla completa): así
    // su salida queda en el historial de tmux y la barra de scroll del panel
    // puede mostrar la posición y arrastrarse. A pantalla completa el historial
    // es virtual y no expone dónde está. Los demás agentes lo ignoran.
    '-e',
    'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1',
    // En una terminal sin agente, $SHELL es la shell que se lanza (un servidor tmux longevo podría tener otra).
    ...(plan.agent === 'shell' && isAbsolute(argv[0]!) ? ['-e', arg(`SHELL=${argv[0]}`)] : []),
  ];

  for (let intento = 0; intento < 5; intento++) {
    const name = nextName(await listSessions(cfg), base);
    const meta = (clave: string, valor: string) => [';', 'set-option', '-t', `=${name}:`, clave, arg(valor)];
    try {
      await runTmux(cfg, [
        // history-limit global antes de crear: solo afecta a los paneles nuevos.
        'set-option', '-g', 'history-limit', String(historial),
        ';', 'new-session', '-d', '-s', name, '-c', plan.cwd ?? cfg.harnessRoot, ...entorno, '--', ...argv.map(arg),
        ...meta('@jdev_project', plan.project),
        ...meta('@jdev_agent', plan.agent),
        ...meta('@jdev_worktree', plan.worktree),
        ...meta('@jdev_created', new Date().toISOString()),
      ]);
      return { name, plan };
    } catch (e) {
      // Otra petición pudo quedarse con el mismo número: se reintenta con el siguiente.
      if (e instanceof TmuxError && /duplicate session/i.test(e.stderr)) continue;
      throw e;
    }
  }
  throw new Error('no se pudo asignar un nombre de sesión libre');
}

// Guarda el título propio de una sesión en la opción de usuario @jdev_title (para
// los agentes sin transcript con custom-title). Devuelve false si la sesión no existe.
export async function setSessionTitle(cfg: TmuxConfig, name: string, title: string): Promise<boolean> {
  if (!isPanelSessionName(name)) return false;
  try {
    await runTmux(cfg, ['set-option', '-t', `=${name}:`, '@jdev_title', arg(title)]);
  } catch (e) {
    if (sinServidor(e) || (e instanceof TmuxError && /can't find (session|pane)/i.test(e.stderr))) return false;
    throw e;
  }
  return true;
}

// Termina una sesión del panel (nunca otra). Devuelve false si no existía.
export async function killSession(cfg: TmuxConfig, name: string): Promise<boolean> {
  if (!isPanelSessionName(name)) return false;
  if (!(await sessionExists(cfg, name))) return false;
  try {
    await runTmux(cfg, ['kill-session', '-t', `=${name}`]);
  } catch (e) {
    // Se cerró entre la comprobación y el kill: el resultado es el mismo.
    if (e instanceof TmuxError && /can't find session|no server running/i.test(e.stderr)) return true;
    throw e;
  }
  return true;
}

// Cierra el servidor tmux del socket configurado (solo para limpiar pruebas).
export async function killServer(cfg: TmuxConfig): Promise<void> {
  try {
    await runTmux(cfg, ['kill-server']);
  } catch (e) {
    if (!sinServidor(e)) throw e;
  }
}

// Comando y argumentos para adjuntar un cliente a la sesión (lo ejecuta node-pty).
export function attachCommand(cfg: TmuxConfig, name: string): { file: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (!isPanelSessionName(name)) throw new Error(`nombre de sesión no válido: ${name}`);
  return {
    file: 'tmux',
    args: [...tmuxBaseArgs(cfg), 'attach-session', '-t', `=${name}`],
    env: { ...tmuxEnv(), TERM: 'xterm-256color' },
  };
}

import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
import { join } from 'node:path';
import type { Project } from './projects.ts';

// Todas las llamadas a tmux usan execFile (sin shell) contra un servidor propio
// (`tmux -L <socket> -f panel/tmux.conf`), para no mezclarse con el tmux personal.

export const AGENT_IDS = ['claude', 'codex', 'copilot', 'opencode'] as const;
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

const AGENT_FLAGS: Record<AgentId, string | null> = {
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
  /** Argumentos de bin/agent, como lista. */
  agentArgs: string[];
  /** Argv completo: ruta de bin/agent y sus argumentos. */
  argv: string[];
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
export function planSession(entrada: unknown, projects: readonly Project[], harnessRoot: string): SessionPlan {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
    throw new SessionInputError('Se esperaba un objeto con la sesión a crear.');
  }
  const e = entrada as Record<string, unknown>;

  if (typeof e.project !== 'string' || e.project === '') throw new SessionInputError('Indica el proyecto.');
  const project = projects.find((p) => p.id === e.project);
  if (!project) throw new SessionInputError(`El proyecto «${e.project}» no existe.`);

  const agent = e.agent ?? 'claude';
  if (!isAgent(agent)) throw new SessionInputError('Agente no válido: usa claude, codex, copilot u opencode.');

  const location = e.location ?? 'main';
  if (!isLocation(location)) {
    throw new SessionInputError('Ubicación no válida: usa main, new-worktree o existing-worktree.');
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
    if (e.prompt.length > MAX_PROMPT_LENGTH) {
      throw new SessionInputError(`El prompt es demasiado largo (máximo ${MAX_PROMPT_LENGTH} caracteres).`);
    }
    if (e.prompt.includes('\0')) throw new SessionInputError('El prompt no puede contener caracteres nulos.');
    prompt = e.prompt.trim() === '' ? '' : e.prompt;
  }

  let resume = '';
  if (e.resume !== undefined && e.resume !== null) {
    if (typeof e.resume !== 'string' || !RESUME_ID.test(e.resume)) {
      throw new SessionInputError('El id de la sesión a retomar no es válido.');
    }
    if (agent !== 'claude') throw new SessionInputError('Solo se pueden retomar sesiones de Claude.');
    if (prompt) throw new SessionInputError('No se puede indicar un prompt al retomar una sesión.');
    resume = e.resume;
  }

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
    const [name = '', project = '', agent = '', worktree = '', createdIso = '', activity = '', created = '', attached = '', dead = ''] =
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
  const argv = cfg.launcher ? cfg.launcher(plan.agentArgs) : plan.argv;
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
  ];

  for (let intento = 0; intento < 5; intento++) {
    const name = nextName(await listSessions(cfg), base);
    const meta = (clave: string, valor: string) => [';', 'set-option', '-t', `=${name}:`, clave, arg(valor)];
    try {
      await runTmux(cfg, [
        // history-limit global antes de crear: solo afecta a los paneles nuevos.
        'set-option', '-g', 'history-limit', String(historial),
        ';', 'new-session', '-d', '-s', name, '-c', cfg.harnessRoot, ...entorno, '--', ...argv.map(arg),
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

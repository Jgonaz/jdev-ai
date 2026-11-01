import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { TmuxSession } from './tmux.ts';

// Estado de turno que bin/session-state deja por sesión de Claude en
// ${XDG_STATE_HOME:-~/.local/state}/jdev-ai/sessions/<session_id>.json.

export const AGENT_STATES = ['waiting', 'working', 'idle', 'ended'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/**
 * Estado visible de una sesión del panel: los cuatro de Claude, más «alive» para
 * las sesiones que no informan de turnos (Codex, Copilot, OpenCode o Claude
 * antes de su primer evento) y siguen vivas.
 */
export type SessionState = AgentState | 'alive';

export type StateFile = {
  sessionId: string;
  state: AgentState;
  event: string;
  /** Milisegundos desde la época (0 si la fecha no es legible). */
  updatedAt: number;
  project: string;
  agent: string;
  worktree: string;
  transcriptPath: string;
  cwd: string;
  tmuxSession: string;
};

const POLL_MS = 5000;
const DEBOUNCE_MS = 50;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

// Convierte el JSON de un archivo de estado; devuelve null si no es válido.
// JSON.parse ya decodifica los escapes con que lo escribe bin/session-state.
export function parseStateFile(contenido: string): StateFile | null {
  let obj: unknown;
  try {
    obj = JSON.parse(contenido);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const sessionId = texto(o.session_id);
  if (sessionId === '' || !(AGENT_STATES as readonly unknown[]).includes(o.state)) return null;
  const fecha = Date.parse(texto(o.updated_at));
  return {
    sessionId,
    state: o.state as AgentState,
    event: texto(o.event),
    updatedAt: Number.isNaN(fecha) ? 0 : fecha,
    project: texto(o.project),
    agent: texto(o.agent),
    worktree: texto(o.worktree),
    transcriptPath: texto(o.transcript_path),
    cwd: texto(o.cwd),
    tmuxSession: texto(o.tmux_session),
  };
}

type Cached = { mtimeMs: number; size: number; file: StateFile | null };

/**
 * Lee y vigila el directorio de estado. Cambios por fs.watch (con debounce) y
 * una relectura periódica de respaldo, porque fs.watch puede perder eventos o
 * no existir aún si ningún hook ha escrito todavía. Ignora archivos ocultos,
 * temporales y JSON no válido.
 */
export class StateStore {
  private readonly dir: string;
  private readonly pollMs: number;
  private readonly onChange: () => void;
  private readonly cache = new Map<string, Cached>();
  private files: StateFile[] = [];
  private signature = '[]';
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = true;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(dir: string, onChange: () => void = () => {}, pollMs: number = POLL_MS) {
    this.dir = dir;
    this.onChange = onChange;
    this.pollMs = pollMs;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.tryWatch();
    await this.refresh();
    this.poll = setInterval(() => {
      this.tryWatch();
      void this.refresh();
    }, this.pollMs);
    this.poll.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.poll) clearInterval(this.poll);
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.poll = this.debounce = this.watcher = null;
  }

  /** Último contenido leído (no relee). */
  snapshot(): readonly StateFile[] {
    return this.files;
  }

  private tryWatch(): void {
    if (this.watcher || this.stopped) return;
    try {
      this.watcher = watch(this.dir, { persistent: false }, () => this.schedule());
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // El directorio aún no existe: lo reintenta la relectura periódica.
    }
  }

  private schedule(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.refresh();
    }, DEBOUNCE_MS);
    this.debounce.unref();
  }

  /** Relee el directorio; avisa solo si algo cambió. Las llamadas se serializan. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.load();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async load(): Promise<void> {
    let nombres: string[];
    try {
      nombres = (await readdir(this.dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
    } catch {
      nombres = [];
    }
    const vistos = new Set<string>();
    const archivos: StateFile[] = [];
    for (const nombre of nombres) {
      vistos.add(nombre);
      const ruta = join(this.dir, nombre);
      try {
        const st = await stat(ruta);
        if (!st.isFile()) continue;
        let c = this.cache.get(nombre);
        if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
          c = { mtimeMs: st.mtimeMs, size: st.size, file: parseStateFile(await readFile(ruta, 'utf8')) };
          this.cache.set(nombre, c);
        }
        if (c.file) archivos.push(c.file);
      } catch {
        // Desapareció entre readdir y stat o está a medio renombrar: se ignora.
      }
    }
    for (const k of this.cache.keys()) if (!vistos.has(k)) this.cache.delete(k);

    archivos.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    const firma = JSON.stringify(archivos);
    this.files = archivos;
    if (firma !== this.signature) {
      this.signature = firma;
      if (!this.stopped) this.onChange();
    }
  }
}

/**
 * Para cada sesión de tmux, el estado más reciente que la menciona. Se descartan
 * los anteriores a la creación de la sesión: un nombre de tmux se reutiliza al
 * terminar una sesión y el archivo de la anterior no debe heredarse.
 */
export function stateByTmuxSession(
  files: readonly StateFile[],
  sesiones: readonly Pick<TmuxSession, 'name' | 'created'>[],
): Map<string, StateFile> {
  const creada = new Map(sesiones.map((s) => [s.name, s.created]));
  const mejor = new Map<string, StateFile>();
  for (const f of files) {
    if (f.tmuxSession === '') continue;
    const desde = creada.get(f.tmuxSession);
    if (desde === undefined || f.updatedAt < Math.floor(desde / 1000) * 1000) continue;
    const actual = mejor.get(f.tmuxSession);
    if (!actual || f.updatedAt > actual.updatedAt) mejor.set(f.tmuxSession, f);
  }
  return mejor;
}

/**
 * Estado visible: si hay archivo de estado, el de Claude (pero «ended» si el
 * proceso de la sesión ya terminó, aunque el último evento no lo dijera); sin
 * él, solo viva o terminada.
 */
export function deriveState(file: StateFile | undefined, alive: boolean): SessionState {
  if (!file) return alive ? 'alive' : 'ended';
  return alive ? file.state : 'ended';
}

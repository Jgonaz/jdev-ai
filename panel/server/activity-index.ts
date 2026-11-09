import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, rename, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { openRegularFile } from './safefile.ts';

// Índice incremental de la actividad con los agentes. Lee, solo para calcular
// cifras, los transcripts de Claude Code (<claude>/projects/<slug>/<id>.jsonl y
// <id>/subagents/agent-*.jsonl) y las sesiones de Codex
// (<codex>/sessions/AAAA/MM/DD/rollout-*.jsonl), y guarda por archivo y por día
// local unos agregados pequeños en una caché que se puede borrar sin perder nada.
// Nunca escribe en los transcripts ni en sus carpetas.

export const INDEX_VERSION = 1;
export const INDEX_FILE = 'activity-index.json';
/** Una línea más larga se salta: son adjuntos o instrucciones, no respuestas. */
export const MAX_LINE_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
/** Cuánto de una línea gigante se conserva para sacar los metadatos del arranque. */
const HEAD_BYTES = 32 * 1024;
/** Un hueco entre respuestas mayor que esto cuenta como esto. */
export const ACTIVE_GAP_MS = 5 * 60 * 1000;
/** Tope de claves distintas por mapa y día, para que datos extraños no inflen la caché. */
const MAX_KEYS = 300;
const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const SAVE_EVERY_MS = 30000;

export type AgentKind = 'claude' | 'codex';

/** Agregados de un día local de un archivo. */
export type DayAgg = {
  /** Respuestas. */
  r: number;
  /** Tokens de entrada (sin caché), de salida, caché leída y caché escrita. */
  i: number;
  o: number;
  cr: number;
  cw: number;
  /** Respuestas por modelo. */
  m: Record<string, number>;
  /** Por directorio de trabajo: [respuestas, tokens de salida]. */
  p: Record<string, [number, number]>;
  /** Usos por herramienta y lanzamientos por tipo de subagente. */
  t: Record<string, number>;
  a: Record<string, number>;
};

export type FileEntry = {
  agent: AgentKind;
  /** Subagente de Claude o sesión secundaria de Codex: suma uso, pero no es una sesión. */
  sub: boolean;
  ino: number;
  size: number;
  mtimeMs: number;
  /** Hasta dónde se ha leído (siempre al final de una línea completa). */
  offset: number;
  /** Última respuesta contada (ms), para los huecos de las horas activas; 0 si ninguna. */
  lastTs: number;
  /** Estado de lectura de Codex: último cwd y modelo vistos y último total acumulado. */
  cwd: string;
  model: string;
  lastTotal: number;
  metaSeen: boolean;
  /** Intervalos con actividad, en segundos desde la época: [inicio, fin, inicio, fin, …]. */
  act: number[];
  days: Record<string, DayAgg>;
  /** Claude: respuestas ya contadas (id sin «msg_» → tokens de salida contados). */
  ids: Record<string, number>;
};

export type IndexOptions = {
  claudeProjectsDir: string;
  codexSessionsDir: string;
  cacheDir: string;
  /** Cada cuánto se repite la pasada (ms); por defecto 5 min. */
  intervalMs?: number;
  now?: () => number;
  chunkBytes?: number;
  maxLineBytes?: number;
};

type Found = { key: string; path: string; agent: AgentKind; sub: boolean; ino: number; size: number; mtimeMs: number };

const A1 = Buffer.from('"type":"assistant"');
const A2 = Buffer.from('"type": "assistant"');
const X_META = Buffer.from('"session_meta"');
const X_CTX = Buffer.from('"turn_context"');
const X_COUNT = Buffer.from('"token_count"');
const X_CALL = Buffer.from('"type":"function_call"');
const X_CUSTOM = Buffer.from('"type":"custom_tool_call"');

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Clave de mapa segura: sin «__proto__» y de longitud acotada. */
function safeKey(v: unknown, max = 200): string | null {
  if (typeof v !== 'string' || v === '' || v === '__proto__') return null;
  return v.length > max ? v.slice(0, max) : v;
}

function bump(rec: Record<string, number>, key: string | null, n = 1): void {
  if (key === null) return;
  if (Object.hasOwn(rec, key)) rec[key]! += n;
  else if (Object.keys(rec).length < MAX_KEYS) rec[key] = n;
}

function emptyDay(): DayAgg {
  return { r: 0, i: 0, o: 0, cr: 0, cw: 0, m: {}, p: {}, t: {}, a: {} };
}

function emptyEntry(agent: AgentKind, sub: boolean): FileEntry {
  return {
    agent,
    sub,
    ino: 0,
    size: 0,
    mtimeMs: 0,
    offset: 0,
    lastTs: 0,
    cwd: '',
    model: '',
    lastTotal: -1,
    metaSeen: false,
    act: [],
    days: {},
    ids: {},
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Día local AAAA-MM-DD de un instante. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- Validación de la caché al cargarla ----------

function reviveRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!esObjeto(v)) return out;
  for (const [k, n] of Object.entries(v)) if (k !== '__proto__' && Object.keys(out).length < MAX_KEYS) out[k] = num(n);
  return out;
}

function reviveDay(v: unknown): DayAgg | null {
  if (!esObjeto(v)) return null;
  const p: Record<string, [number, number]> = {};
  if (esObjeto(v.p)) {
    for (const [k, par] of Object.entries(v.p)) {
      if (k === '__proto__' || Object.keys(p).length >= MAX_KEYS) continue;
      if (Array.isArray(par)) p[k] = [num(par[0]), num(par[1])];
    }
  }
  return { r: num(v.r), i: num(v.i), o: num(v.o), cr: num(v.cr), cw: num(v.cw), m: reviveRecord(v.m), p, t: reviveRecord(v.t), a: reviveRecord(v.a) };
}

function reviveEntry(v: unknown): FileEntry | null {
  if (!esObjeto(v) || (v.agent !== 'claude' && v.agent !== 'codex')) return null;
  const e = emptyEntry(v.agent, v.sub === true);
  e.ino = num(v.ino);
  e.size = num(v.size);
  e.mtimeMs = typeof v.mtimeMs === 'number' && Number.isFinite(v.mtimeMs) ? v.mtimeMs : 0;
  e.offset = num(v.offset);
  e.lastTs = num(v.lastTs);
  e.cwd = str(v.cwd);
  e.model = str(v.model);
  e.lastTotal = typeof v.lastTotal === 'number' && Number.isFinite(v.lastTotal) ? v.lastTotal : -1;
  e.metaSeen = v.metaSeen === true;
  if (Array.isArray(v.act)) e.act = v.act.map(num);
  if (e.act.length % 2 === 1) e.act.pop();
  if (esObjeto(v.days)) {
    for (const [k, d] of Object.entries(v.days)) {
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(k) ? reviveDay(d) : null;
      if (dia) e.days[k] = dia;
    }
  }
  e.ids = reviveRecord(v.ids);
  if (e.offset > e.size) return null;
  return e;
}

// ---------- Índice ----------

export class ActivityIndex {
  private readonly o: Required<Omit<IndexOptions, 'now'>> & { now: () => number };
  readonly files = new Map<string, FileEntry>();
  /** Respuestas de Claude ya contadas, con el archivo que las cuenta: una respuesta repetida en otro transcript se salta. */
  private readonly owners = new Map<string, string>();
  private loaded = false;
  private dirty = false;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastSave = 0;
  private dayCache: { from: number; to: number; key: string } | null = null;
  /** Fin de la última pasada completa (ms); null si no hubo ninguna. */
  updatedAt: number | null = null;
  indexing = false;
  progress: { done: number; total: number } | null = null;
  /** Instante de la última vez que una pasada empezó. */
  lastPassAt = 0;
  /** Qué leyó la última pasada completa: archivos y bytes (cero si todo estaba al día). */
  lastPass = { files: 0, bytes: 0 };

  constructor(opts: IndexOptions) {
    this.o = {
      intervalMs: 5 * 60 * 1000,
      now: Date.now,
      chunkBytes: CHUNK_BYTES,
      maxLineBytes: MAX_LINE_BYTES,
      ...opts,
    };
  }

  /** Empieza una pasada en segundo plano y las repite cada 5 minutos. Idempotente. */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.refresh(), this.o.intervalMs);
    this.timer.unref();
    void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** ¿Hay algo que enseñar ya (una caché cargada o una pasada completa)? */
  get hasData(): boolean {
    return this.updatedAt !== null || this.files.size > 0;
  }

  /** Una sola pasada a la vez: quien llama mientras hay una espera a esa. */
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running ??= this.pass()
      .catch((e: unknown) => {
        console.error('Indexado de actividad:', e instanceof Error ? e.message : e);
      })
      .finally(() => {
        this.running = null;
        this.indexing = false;
        this.progress = null;
      });
    return this.running;
  }

  /** Espera a que acabe la pasada en curso, como mucho `ms`. */
  async settle(ms: number): Promise<void> {
    if (!this.running) return;
    let t: NodeJS.Timeout | undefined;
    await Promise.race([this.running, new Promise<void>((ok) => (t = setTimeout(ok, ms)))]);
    clearTimeout(t);
  }

  private cachePath(): string {
    return join(this.o.cacheDir, INDEX_FILE);
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const abierto = await openRegularFile(this.cachePath());
      if (!abierto) return;
      let texto: string;
      try {
        if (abierto.stat.size > MAX_CACHE_BYTES) return;
        texto = await abierto.fh.readFile('utf8');
      } finally {
        await abierto.fh.close();
      }
      const crudo: unknown = JSON.parse(texto);
      // Otra versión de formato o una caché corrupta: se reconstruye desde cero.
      if (!esObjeto(crudo) || crudo.version !== INDEX_VERSION || !esObjeto(crudo.files)) return;
      for (const [key, v] of Object.entries(crudo.files)) {
        const e = reviveEntry(v);
        if (!e) continue;
        this.files.set(key, e);
        for (const id of Object.keys(e.ids)) if (!this.owners.has(id)) this.owners.set(id, key);
      }
      if (typeof crudo.updatedAt === 'number') this.updatedAt = crudo.updatedAt;
    } catch {
      this.files.clear();
      this.owners.clear();
      this.updatedAt = null;
    }
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    this.lastSave = this.o.now();
    const destino = this.cachePath();
    const temporal = `${destino}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await mkdir(this.o.cacheDir, { recursive: true, mode: 0o700 });
      const cuerpo = JSON.stringify({ version: INDEX_VERSION, updatedAt: this.updatedAt, files: Object.fromEntries(this.files) });
      await writeFile(temporal, cuerpo, { mode: 0o600, flag: 'wx' });
      await chmod(temporal, 0o600);
      await rename(temporal, destino);
    } catch (e) {
      this.dirty = true;
      console.error('No se pudo guardar la caché de actividad:', e instanceof Error ? e.message : e);
    }
  }

  // ---------- Descubrimiento ----------

  private async statFound(path: string): Promise<Pick<Found, 'ino' | 'size' | 'mtimeMs'> | null> {
    try {
      const st = await lstat(path);
      return st.isFile() ? { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private async dirs(dir: string, re?: RegExp): Promise<string[]> {
    try {
      const l = await readdir(dir, { withFileTypes: true });
      return l.filter((d) => d.isDirectory() && (!re || re.test(d.name))).map((d) => d.name);
    } catch {
      return [];
    }
  }

  private async regulars(dir: string, re: RegExp): Promise<string[]> {
    try {
      const l = await readdir(dir, { withFileTypes: true });
      return l.filter((d) => d.isFile() && re.test(d.name)).map((d) => d.name);
    } catch {
      return [];
    }
  }

  /** Candidatos sin estadísticas: los enlaces simbólicos y lo que no sea archivo regular ni se listan. */
  private async candidates(): Promise<Omit<Found, 'ino' | 'size' | 'mtimeMs'>[]> {
    const out: Omit<Found, 'ino' | 'size' | 'mtimeMs'>[] = [];
    const root = this.o.claudeProjectsDir;
    for (const slug of await this.dirs(root)) {
      const dir = join(root, slug);
      for (const n of await this.regulars(dir, /\.jsonl$/)) {
        out.push({ key: `claude:${slug}/${n}`, path: join(dir, n), agent: 'claude', sub: false });
      }
      for (const sesion of await this.dirs(dir)) {
        const sub = join(dir, sesion, 'subagents');
        for (const n of await this.regulars(sub, /^agent-.*\.jsonl$/)) {
          out.push({ key: `claude:${slug}/${sesion}/subagents/${n}`, path: join(sub, n), agent: 'claude', sub: true });
        }
      }
    }
    const sroot = this.o.codexSessionsDir;
    for (const y of await this.dirs(sroot, /^\d{4}$/)) {
      for (const m of await this.dirs(join(sroot, y), /^\d{2}$/)) {
        for (const d of await this.dirs(join(sroot, y, m), /^\d{2}$/)) {
          const dir = join(sroot, y, m, d);
          for (const n of await this.regulars(dir, /^rollout-.*\.jsonl$/)) {
            out.push({ key: `codex:${y}/${m}/${d}/${n}`, path: join(dir, n), agent: 'codex', sub: false });
          }
        }
      }
    }
    return out;
  }

  private async discover(): Promise<Found[]> {
    const cand = await this.candidates();
    const found: Found[] = [];
    // Estadísticas en paralelo acotado: son unos miles de lstat.
    let i = 0;
    const worker = async () => {
      for (;;) {
        const c = cand[i++];
        if (!c) return;
        const st = await this.statFound(c.path);
        if (st) found.push({ ...c, ...st });
      }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    return found;
  }

  // ---------- Pasada ----------

  private release(key: string, e: FileEntry): void {
    for (const id of Object.keys(e.ids)) if (this.owners.get(id) === key) this.owners.delete(id);
  }

  private async pass(): Promise<void> {
    this.indexing = true;
    this.lastPassAt = this.o.now();
    await this.load();
    const found = await this.discover();
    const claves = new Set(found.map((f) => f.key));
    for (const [key, e] of [...this.files]) {
      if (claves.has(key)) continue;
      this.release(key, e);
      this.files.delete(key);
      this.dirty = true;
    }
    // Primero los más antiguos: una sesión retomada repite respuestas de la original, que debe ser quien las cuente.
    const todo = found
      .filter((f) => {
        const e = this.files.get(f.key);
        return !e || e.size !== f.size || e.ino !== f.ino;
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    const total = todo.reduce((n, f) => n + f.size, 0);
    this.progress = { done: 0, total };
    let hecho = 0;
    for (const f of todo) {
      if (this.stopped) return;
      try {
        await this.readFile(f);
      } catch {
        // Un archivo ilegible se reintenta en la pasada siguiente.
      }
      hecho += f.size;
      this.progress = { done: hecho, total };
      if (this.dirty && this.o.now() - this.lastSave > SAVE_EVERY_MS) await this.save();
    }
    this.lastPass = { files: todo.length, bytes: total };
    this.updatedAt = this.o.now();
    this.dirty = true;
    await this.save();
  }

  private async readFile(f: Found): Promise<void> {
    const abierto = await openRegularFile(f.path);
    if (!abierto) return;
    const { fh, stat } = abierto;
    try {
      let e = this.files.get(f.key);
      // Encoge o es otro archivo (otra identidad): se relee entero.
      if (e && (stat.ino !== e.ino || stat.size < e.size)) {
        this.release(f.key, e);
        e = undefined;
      }
      if (!e) {
        e = emptyEntry(f.agent, f.sub);
        e.ino = stat.ino;
        this.files.set(f.key, e);
      }
      await this.scan(f.key, fh, e, stat.size);
      e.ino = stat.ino;
      e.size = stat.size;
      e.mtimeMs = stat.mtimeMs;
      this.dirty = true;
    } finally {
      await fh.close();
    }
  }

  /** Lee de e.offset a `size` por trozos, línea a línea, sin dejar nunca una línea a medias contada. */
  private async scan(key: string, fh: import('node:fs/promises').FileHandle, e: FileEntry, size: number): Promise<void> {
    const max = this.o.maxLineBytes;
    const buf = Buffer.allocUnsafe(this.o.chunkBytes);
    let pos = e.offset;
    let committed = e.offset;
    let carry: Buffer[] = [];
    let carryLen = 0;
    // Línea gigante en curso: se descarta, salvo su cabeza.
    let over = false;
    let head: Buffer | null = null;

    const linea = (b: Buffer) => (e.agent === 'claude' ? this.claudeLine(key, e, b) : this.codexLine(e, b));
    const gigante = (h: Buffer) => {
      if (e.agent === 'codex') this.codexOversize(e, h);
    };

    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - pos), pos);
      if (bytesRead <= 0) break;
      const chunk = buf.subarray(0, bytesRead);
      let start = 0;
      while (start < bytesRead) {
        const nl = chunk.indexOf(0x0a, start);
        if (nl < 0) {
          if (!over) {
            const resto = bytesRead - start;
            if (carryLen + resto > max) {
              over = true;
              head = Buffer.concat([...carry, chunk.subarray(start)]).subarray(0, HEAD_BYTES);
              carry = [];
              carryLen = 0;
            } else {
              carry.push(Buffer.from(chunk.subarray(start)));
              carryLen += resto;
            }
          }
          break;
        }
        if (over) {
          gigante(head!);
          over = false;
          head = null;
        } else if (carryLen + (nl - start) > max) {
          gigante(Buffer.concat([...carry, chunk.subarray(start, nl)]).subarray(0, HEAD_BYTES));
        } else if (carryLen > 0) {
          linea(Buffer.concat([...carry, chunk.subarray(start, nl)]));
        } else {
          linea(chunk.subarray(start, nl));
        }
        carry = [];
        carryLen = 0;
        start = nl + 1;
        committed = pos + start;
      }
      pos += bytesRead;
      e.offset = committed;
    }
  }

  // ---------- Contabilidad ----------

  private day(e: FileEntry, ms: number): DayAgg {
    let c = this.dayCache;
    if (!c || ms < c.from || ms >= c.to) {
      const d = new Date(ms);
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      c = this.dayCache = { from, to, key: dayKey(ms) };
    }
    return (e.days[c.key] ??= emptyDay());
  }

  /** Suma el tiempo desde la respuesta anterior (el hueco, con tope de 5 min) a las horas activas. */
  private addActive(e: FileEntry, ms: number): void {
    if (e.lastTs > 0 && ms > e.lastTs) {
      const gap = ms - e.lastTs;
      const ini = Math.floor((gap <= ACTIVE_GAP_MS ? e.lastTs : ms - ACTIVE_GAP_MS) / 1000);
      const fin = Math.floor(ms / 1000);
      const n = e.act.length;
      if (n >= 2 && ini <= e.act[n - 1]! && ini >= e.act[n - 2]!) {
        if (fin > e.act[n - 1]!) e.act[n - 1] = fin;
      } else if (fin > ini) {
        e.act.push(ini, fin);
      }
    }
    if (ms > e.lastTs) e.lastTs = ms;
  }

  private claudeLine(key: string, e: FileEntry, b: Buffer): void {
    if (!b.includes(A1) && !b.includes(A2)) return;
    let o: unknown;
    try {
      o = JSON.parse(b.toString('utf8'));
    } catch {
      return;
    }
    if (!esObjeto(o) || o.type !== 'assistant' || !esObjeto(o.message)) return;
    const msg = o.message;
    const model = safeKey(msg.model);
    const id = safeKey(msg.id, 120);
    const ms = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (model === null || id === null || !Number.isFinite(ms) || model === '<synthetic>' || !esObjeto(msg.usage)) return;

    const clave = id.startsWith('msg_') ? id.slice(4) : id;
    const dueno = this.owners.get(clave);
    // Esa respuesta ya la cuenta otro transcript (una sesión retomada repite la historia).
    if (dueno !== undefined && dueno !== key) return;

    const u = msg.usage;
    const salida = num(u.output_tokens);
    const cwd = safeKey(o.cwd, 500) ?? '';
    const dia = this.day(e, ms);
    const previo = Object.hasOwn(e.ids, clave) ? e.ids[clave]! : undefined;
    if (previo === undefined) {
      this.owners.set(clave, key);
      e.ids[clave] = salida;
      dia.r++;
      dia.i += num(u.input_tokens);
      dia.o += salida;
      dia.cr += num(u.cache_read_input_tokens);
      dia.cw += num(u.cache_creation_input_tokens);
      bump(dia.m, model);
      this.project(dia, cwd, 1, salida);
    } else if (salida > previo) {
      // La misma respuesta repetida en streaming: solo cuenta lo que crece su salida.
      e.ids[clave] = salida;
      dia.o += salida - previo;
      this.project(dia, cwd, 0, salida - previo);
    }

    if (Array.isArray(msg.content)) {
      for (const bloque of msg.content) {
        if (!esObjeto(bloque) || bloque.type !== 'tool_use') continue;
        const nombre = safeKey(bloque.name, 100);
        bump(dia.t, nombre);
        if ((nombre === 'Agent' || nombre === 'Task') && esObjeto(bloque.input)) {
          bump(dia.a, safeKey(bloque.input.subagent_type, 100));
        }
      }
    }
    this.addActive(e, ms);
  }

  private project(dia: DayAgg, cwd: string, r: number, o: number): void {
    const p = Object.hasOwn(dia.p, cwd) ? dia.p[cwd]! : Object.keys(dia.p).length < MAX_KEYS ? (dia.p[cwd] = [0, 0]) : null;
    if (p) {
      p[0] += r;
      p[1] += o;
    }
  }

  private codexLine(e: FileEntry, b: Buffer): void {
    const meta = b.includes(X_META);
    const ctx = !meta && b.includes(X_CTX);
    const count = !meta && !ctx && b.includes(X_COUNT);
    const call = !meta && !ctx && !count && (b.includes(X_CALL) || b.includes(X_CUSTOM));
    if (!meta && !ctx && !count && !call) return;
    let o: unknown;
    try {
      o = JSON.parse(b.toString('utf8'));
    } catch {
      return;
    }
    if (!esObjeto(o) || !esObjeto(o.payload)) return;
    const p = o.payload;
    const ms = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;

    if (o.type === 'session_meta') {
      // Solo manda la primera: una sesión retomada puede traer copias de las anteriores.
      if (e.metaSeen) return;
      e.metaSeen = true;
      const cwd = safeKey(p.cwd, 500);
      if (cwd) e.cwd = cwd;
      e.sub = esObjeto(p.source) && esObjeto(p.source.subagent) ? true : p.thread_source === 'subagent' || p.thread_source === 'guardian_review';
      return;
    }
    if (o.type === 'turn_context') {
      const model = safeKey(p.model);
      if (model) e.model = model;
      const cwd = safeKey(p.cwd, 500);
      if (cwd) e.cwd = cwd;
      return;
    }
    if (!Number.isFinite(ms)) return;

    if (o.type === 'event_msg' && p.type === 'token_count') {
      const info = p.info;
      if (!esObjeto(info) || !esObjeto(info.last_token_usage)) return;
      // Codex repite el mismo evento sin respuesta nueva: el total acumulado no cambia.
      const total = esObjeto(info.total_token_usage) && typeof info.total_token_usage.total_tokens === 'number' ? info.total_token_usage.total_tokens : null;
      if (total !== null) {
        if (total === e.lastTotal) return;
        e.lastTotal = total;
      }
      const u = info.last_token_usage;
      const cacheada = num(u.cached_input_tokens);
      const escrita = num(u.cache_write_input_tokens);
      const salida = num(u.output_tokens);
      const dia = this.day(e, ms);
      dia.r++;
      // En Codex la entrada incluye lo cacheado: se separa para que cuadre con Claude.
      dia.i += Math.max(0, num(u.input_tokens) - cacheada - escrita);
      dia.o += salida;
      dia.cr += cacheada;
      dia.cw += escrita;
      bump(dia.m, e.model || 'codex');
      this.project(dia, e.cwd, 1, salida);
      this.addActive(e, ms);
      return;
    }
    if (o.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      const nombre = safeKey(p.name, 100);
      if (nombre === null) return;
      const dia = this.day(e, ms);
      bump(dia.t, nombre);
      if (nombre === 'spawn_agent' && typeof p.arguments === 'string') {
        try {
          const args: unknown = JSON.parse(p.arguments);
          bump(dia.a, safeKey(esObjeto(args) ? args.agent_type : null, 100) ?? 'default');
        } catch {
          bump(dia.a, 'default');
        }
      }
    }
  }

  /** Cabeza de una línea gigante de Codex: solo interesa el session_meta, que lleva el cwd al principio. */
  private codexOversize(e: FileEntry, head: Buffer): void {
    if (e.metaSeen || !head.includes(X_META)) return;
    const t = head.toString('utf8');
    e.metaSeen = true;
    const cwd = /"cwd":("(?:[^"\\]|\\.)*")/.exec(t);
    if (cwd) {
      try {
        const v = safeKey(JSON.parse(cwd[1]!), 500);
        if (v) e.cwd = v;
      } catch {
        // Cabeza cortada a mitad de una cadena: sin cwd.
      }
    }
    e.sub = /"source":\{"subagent"/.test(t) || /"thread_source":"(?:subagent|guardian_review)"/.test(t);
  }
}

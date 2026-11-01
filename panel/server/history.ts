import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { localDate, writeAtomic } from './backlog.ts';

// Lectura del historial de iteraciones (rules/history.md) del checkout
// principal de cada proyecto: `.agent/history/*.md`, sin subcarpetas (p. ej.
// archive/) ni enlaces simbólicos. La única escritura es la marca de un punto
// de «Pendiente de ti» como hecho (`- [x] … (hecho YYYY-MM-DD)`) o su retirada.

export const HISTORY_DIR = join('.agent', 'history');
export const STATES = ['finalizada', 'en curso', 'bloqueada'] as const;
export type HistoryState = (typeof STATES)[number] | 'desconocido';

const MAX_ENTRY_BYTES = 1024 * 1024;
const PENDING_TITLE = 'Pendiente de ti';

// Nombre de una entrada: un solo componente `.md`, sin barras, sin `..` y sin
// empezar por punto (temporales y ocultos).
export const ENTRY_FILE_RE = /^(?!\.)(?!.*\.\.)[^/\\\0]{1,200}\.md$/;

export type PendingPoint = {
  /** Posición del punto en «Pendiente de ti» (0, 1, …). */
  index: number;
  /** Texto del punto con las líneas de continuación unidas, sin `[x] ` ni `(hecho …)`. */
  text: string;
  done: boolean;
  /** Fecha del sufijo `(hecho YYYY-MM-DD)`, si la tiene. */
  doneDate: string | null;
};

export type HistorySection = { title: string; body: string };

export type HistoryEntry = {
  project: string;
  file: string;
  title: string;
  /** `YYYY-MM-DD HH:MM` o, si solo se conoce el día, `YYYY-MM-DD`. */
  date: string;
  /** La fecha no viene de un `Fecha: YYYY-MM-DD HH:MM` válido. */
  approxDate: boolean;
  state: HistoryState;
  /** Texto del primer pendiente sin marcar, o null. */
  firstPending: string | null;
  openPending: number;
  totalPending: number;
  etag: string;
};

export type HistoryDetail = HistoryEntry & {
  /** Ruta relativa a la raíz del proyecto, con barras `/`. */
  path: string;
  /** Valor literal de `Estado:`, o null si no hay. */
  rawState: string | null;
  /** Secciones `## ` en orden, sin «Pendiente de ti» (va en `pending`). */
  sections: HistorySection[];
  hasPendingSection: boolean;
  pending: PendingPoint[];
  /** Texto de «Pendiente de ti» que no forma parte de ningún punto. */
  pendingNotes: string;
};

export class HistoryError extends Error {
  readonly status: number;
  readonly entry?: HistoryDetail;
  constructor(status: number, message: string, entry?: HistoryDetail) {
    super(message);
    this.name = 'HistoryError';
    this.status = status;
    this.entry = entry;
  }
}

export const isHistoryState = (v: unknown): v is HistoryState =>
  typeof v === 'string' && ((STATES as readonly string[]).includes(v) || v === 'desconocido');

// ------------------------------------------------------------------- Análisis

/** Línea sin su salto (`\n` o `\r\n`). */
const contenido = (l: string) => l.replace(/\r?\n$/, '').replace(/\r$/, '');

const pad = (n: number) => String(n).padStart(2, '0');
const fechaLocal = (ms: number) => {
  const d = new Date(ms);
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function diaValido(y: string, m: string, d: string): boolean {
  const mes = Number(m);
  const dia = Number(d);
  return Number(y) > 1900 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
}
function horaValida(h: string, mi: string): boolean {
  return Number(h) <= 23 && Number(mi) <= 59;
}

// Fecha de `Fecha:` si cumple el formato; si no, del nombre
// (YYYY-MM-DD-HHMM) y, en último caso, del día de `Fecha:` o del nombre, o del mtime.
export function entryDate(fecha: string | null, file: string, mtimeMs: number): { date: string; approxDate: boolean } {
  const f = fecha?.trim() ?? '';
  let m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(f);
  if (m && diaValido(m[1]!, m[2]!, m[3]!) && horaValida(m[4]!, m[5]!)) return { date: f, approxDate: false };
  m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-|\.md$)/.exec(file);
  if (m && diaValido(m[1]!, m[2]!, m[3]!) && horaValida(m[4]!, m[5]!)) {
    return { date: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`, approxDate: true };
  }
  for (const texto of [f, file]) {
    m = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/.exec(texto);
    if (m && diaValido(m[1]!, m[2]!, m[3]!)) return { date: `${m[1]}-${m[2]}-${m[3]}`, approxDate: true };
  }
  return { date: fechaLocal(mtimeMs), approxDate: true };
}

// Por prefijo, como bin/session-status: algunas entradas añaden detalles tras
// el estado («finalizada (sin commit)»). Además de «terminada…» y «cerrad…»
// (los sinónimos de bin/session-status), acepta «completad…» y «completo».
export function entryState(estado: string | null): HistoryState {
  const e = (estado ?? '').trim().toLowerCase();
  if (/^(finalizada|terminada|cerrad|completad|completo)/.test(e)) return 'finalizada';
  if (e.startsWith('en curso')) return 'en curso';
  if (e.startsWith('bloqueada')) return 'bloqueada';
  return 'desconocido';
}

type RawPoint = {
  /** Índices de la primera y la última línea del punto en el archivo. */
  first: number;
  last: number;
  /** Texto con las continuaciones unidas por un espacio, como section_points. */
  text: string;
};

type Parsed = {
  /** BOM inicial (`\uFEFF`) o ''; no forma parte de la primera línea. */
  bom: string;
  title: string;
  fecha: string | null;
  rawState: string | null;
  sections: HistorySection[];
  hasPendingSection: boolean;
  points: RawPoint[];
  pendingNotes: string;
};

/**
 * Puntos de una sección con el criterio de `section_points` de
 * bin/session-status: un punto empieza en `- ` y sigue con las líneas
 * sangradas con dos o más espacios; cualquier otra línea lo cierra.
 */
function puntos(lineas: string[], desde: number, hasta: number): { points: RawPoint[]; notas: string[] } {
  const points: RawPoint[] = [];
  const notas: string[] = [];
  let actual: RawPoint | null = null;
  for (let i = desde; i < hasta; i++) {
    const l = contenido(lineas[i]!);
    if (l.startsWith('- ')) {
      if (actual) points.push(actual);
      actual = { first: i, last: i, text: l.slice(2) };
      continue;
    }
    if (actual && /^ {2,}[^ ]/.test(l)) {
      actual.text += ` ${l.replace(/^ +/, '')}`;
      actual.last = i;
      continue;
    }
    if (actual) points.push(actual);
    actual = null;
    notas.push(l);
  }
  if (actual) points.push(actual);
  return { points, notas };
}

function parse(source: string, file: string): Parsed & { lineas: string[] } {
  // Cada línea conserva su salto para poder reescribir el archivo idéntico. El
  // BOM se aparta para que no estropee el título y se repone al escribir.
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lineas = source.slice(bom.length).split(/(?<=\n)/);
  let title: string | null = null;
  let fecha: string | null = null;
  let rawState: string | null = null;
  const cabeceras: { title: string; line: number }[] = [];
  const preambulo: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = contenido(lineas[i]!);
    if (/^## /.test(l)) {
      cabeceras.push({ title: l.slice(3).trim(), line: i });
      continue;
    }
    if (cabeceras.length > 0) continue;
    if (title === null && /^#[ \t]+\S/.test(l)) {
      title = l.replace(/^#[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      continue;
    }
    const f = /^Fecha:[ \t]*(.*)$/.exec(l);
    if (f && fecha === null) {
      fecha = f[1]!.trim();
      continue;
    }
    const e = /^Estado:[ \t]*(.*)$/.exec(l);
    if (e && rawState === null) {
      rawState = e[1]!.trim();
      continue;
    }
    preambulo.push(l);
  }

  const sections: HistorySection[] = [];
  const intro = preambulo.join('\n').trim();
  if (intro !== '') sections.push({ title: '', body: intro });
  let hasPendingSection = false;
  let points: RawPoint[] = [];
  let pendingNotes = '';
  cabeceras.forEach((c, k) => {
    const fin = k + 1 < cabeceras.length ? cabeceras[k + 1]!.line : lineas.length;
    // Solo la primera «Pendiente de ti», como section_points.
    if (c.title === PENDING_TITLE && !hasPendingSection) {
      hasPendingSection = true;
      const r = puntos(lineas, c.line + 1, fin);
      points = r.points;
      pendingNotes = r.notas.join('\n').trim();
      return;
    }
    const body = lineas
      .slice(c.line + 1, fin)
      .map(contenido)
      .join('\n')
      .trim();
    sections.push({ title: c.title, body });
  });
  return {
    lineas,
    bom,
    title: title && title !== '' ? title : file.replace(/\.md$/, ''),
    fecha,
    rawState,
    sections,
    hasPendingSection,
    points,
    pendingNotes,
  };
}

const HECHO_RE = /[ \t]?\(hecho (\d{4}-\d{2}-\d{2})\)[ \t]*$/;

function pendingPoint(p: RawPoint, index: number): PendingPoint {
  const done = p.text.startsWith('[x] ');
  let text = done ? p.text.slice(4) : p.text;
  let doneDate: string | null = null;
  if (done) {
    const m = HECHO_RE.exec(text);
    if (m) {
      doneDate = m[1]!;
      text = text.slice(0, m.index);
    }
  }
  return { index, text: text.trim(), done, doneDate };
}

export type EntryContext = { project: string; file: string; etag: string; mtimeMs: number };

export function parseEntry(source: string, ctx: EntryContext): HistoryDetail {
  const p = parse(source, ctx.file);
  const pending = p.points.map(pendingPoint);
  const abiertos = pending.filter((x) => !x.done);
  return {
    project: ctx.project,
    file: ctx.file,
    title: p.title,
    ...entryDate(p.fecha, ctx.file, ctx.mtimeMs),
    state: entryState(p.rawState),
    firstPending: abiertos[0]?.text ?? null,
    openPending: abiertos.length,
    totalPending: pending.length,
    etag: ctx.etag,
    path: `.agent/history/${ctx.file}`,
    rawState: p.rawState,
    sections: p.sections,
    hasPendingSection: p.hasPendingSection,
    pending,
    pendingNotes: p.pendingNotes,
  };
}

export function toListEntry(d: HistoryDetail): HistoryEntry {
  const { path: _p, rawState: _r, sections: _s, hasPendingSection: _h, pending: _pe, pendingNotes: _n, ...entry } = d;
  return entry;
}

/**
 * Marca (`done`) o desmarca el punto `index` de «Pendiente de ti» tocando solo
 * su primera línea (`- ` ↔ `- [x] `) y el final de la última
 * (` (hecho YYYY-MM-DD)`). Conserva el resto del texto y los saltos de línea.
 * Devuelve el texto sin cambios si el punto ya estaba así. Lanza
 * HistoryError(400) si el punto no existe.
 */
export function editPending(source: string, index: number, done: boolean, today: string): string {
  const p = parse(source, 'x.md');
  const punto = p.points[index];
  if (!punto) throw new HistoryError(400, p.hasPendingSection ? 'Ese pendiente no existe en la entrada.' : 'La entrada no tiene «Pendiente de ti».');
  const yaHecho = punto.text.startsWith('[x] ');
  if (yaHecho === done) return source;
  const lineas = [...p.lineas];
  const cambiar = (i: number, f: (c: string) => string) => {
    const l = lineas[i]!;
    const salto = /\r?\n$/.exec(l)?.[0] ?? '';
    lineas[i] = f(l.slice(0, l.length - salto.length)) + salto;
  };
  if (done) {
    cambiar(punto.first, (c) => `- [x] ${c.slice(2)}`);
    cambiar(punto.last, (c) => `${c} (hecho ${today})`);
  } else {
    cambiar(punto.first, (c) => `- ${c.slice(6)}`);
    cambiar(punto.last, (c) => c.replace(HECHO_RE, ''));
  }
  return p.bom + lineas.join('');
}

/**
 * Texto UTF-8 estricto de una entrada, conservando el BOM, o HistoryError(422)
 * si los bytes no son UTF-8 válido: reescribirlos tras una decodificación con
 * pérdidas cambiaría bytes fuera del punto marcado.
 */
export function decodeStrict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new HistoryError(422, 'La entrada no está en UTF-8; no se puede marcar sin alterarla.');
  }
}

// ---------------------------------------------------------------------- Lectura

type Archivo = { file: string; abs: string; mtimeMs: number; size: number };

const etagDe = (s: { mtimeMs: number; size: number }) => `${s.mtimeMs}-${s.size}`;

type Carpeta = { ok: true; dir: string } | { ok: false; status: 403 | 404 };

/**
 * Ruta real de la carpeta de historial de un proyecto. Si `.agent` o
 * `.agent/history` son enlaces que llevan fuera del proyecto (comparando las
 * rutas reales), el historial se ignora (403); si no existe o no es una
 * carpeta, 404.
 */
async function carpetaHistorial(projectPath: string): Promise<Carpeta> {
  let dir: string;
  let raiz: string;
  try {
    [dir, raiz] = await Promise.all([realpath(join(projectPath, HISTORY_DIR)), realpath(projectPath)]);
    if (!(await lstat(dir)).isDirectory()) return { ok: false, status: 404 };
  } catch {
    return { ok: false, status: 404 };
  }
  if (!dir.startsWith(raiz + sep)) return { ok: false, status: 403 };
  return { ok: true, dir };
}

// Archivos regulares `*.md` de .agent/history/, sin seguir enlaces y sin subcarpetas.
async function scan(projectPath: string): Promise<Archivo[]> {
  const c = await carpetaHistorial(projectPath);
  if (!c.ok) return [];
  const dir = c.dir;
  let nombres: string[];
  try {
    nombres = await readdir(dir);
  } catch {
    return [];
  }
  const archivos: Archivo[] = [];
  for (const file of nombres.sort()) {
    if (!ENTRY_FILE_RE.test(file)) continue;
    const abs = join(dir, file);
    try {
      const s = await lstat(abs);
      if (s.isFile() && s.size <= MAX_ENTRY_BYTES) archivos.push({ file, abs, mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      // Desaparecido entre readdir y lstat.
    }
  }
  return archivos;
}

/** Firma del historial de un proyecto: cambia si se crea, borra o edita una entrada. */
export async function historySignature(projectPath: string): Promise<string> {
  return (await scan(projectPath)).map((a) => `${a.file}:${etagDe(a)}`).join('|');
}

export const historyDirs = (projectPath: string): string[] => [join(projectPath, HISTORY_DIR)];

export type HistoryProject = { id: string; path: string };
export type HistoryFilters = { project?: string | null; state?: HistoryState | null; pending?: boolean };

/** Más reciente primero; a igual fecha, por nombre de archivo descendente. */
export function compareEntries(a: HistoryEntry, b: HistoryEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.file !== b.file) return a.file < b.file ? 1 : -1;
  return a.project < b.project ? -1 : a.project > b.project ? 1 : 0;
}

/** Lector del historial con caché por archivo (mtime y tamaño) y cola en serie por archivo para las marcas. */
export class HistoryStore {
  private readonly cache = new Map<string, { etag: string; entry: HistoryDetail }>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Para pruebas: número de archivos leídos del disco. */
  reads = 0;

  private async load(project: string, a: Archivo): Promise<HistoryDetail | null> {
    const etag = etagDe(a);
    const enCache = this.cache.get(a.abs);
    if (enCache && enCache.etag === etag && enCache.entry.project === project) return enCache.entry;
    let source: string;
    try {
      source = await readFile(a.abs, 'utf8');
    } catch {
      return null;
    }
    this.reads++;
    const entry = parseEntry(source, { project, file: a.file, etag, mtimeMs: a.mtimeMs });
    this.cache.set(a.abs, { etag, entry });
    return entry;
  }

  async list(projects: readonly HistoryProject[], filters: HistoryFilters = {}): Promise<HistoryEntry[]> {
    const entradas: HistoryEntry[] = [];
    const vistos = new Set<string>();
    for (const p of projects) {
      if (filters.project && p.id !== filters.project) continue;
      for (const a of await scan(p.path)) {
        vistos.add(a.abs);
        const e = await this.load(p.id, a);
        if (!e) continue;
        if (filters.state && e.state !== filters.state) continue;
        if (filters.pending && e.openPending === 0) continue;
        entradas.push(toListEntry(e));
      }
    }
    // Sin filtro de proyecto se conoce todo lo que existe: se olvida lo borrado.
    if (!filters.project) for (const k of this.cache.keys()) if (!vistos.has(k)) this.cache.delete(k);
    return entradas.sort(compareEntries);
  }

  /** Archivo de una entrada, o HistoryError 400 (nombre no válido), 403 (fuera del proyecto o de la carpeta), 404 o 413. */
  private async localizar(project: HistoryProject, file: string): Promise<Archivo> {
    if (!ENTRY_FILE_RE.test(file)) throw new HistoryError(400, 'Nombre de entrada no válido.');
    const c = await carpetaHistorial(project.path);
    if (!c.ok) {
      throw c.status === 403
        ? new HistoryError(403, 'La carpeta de historial queda fuera del proyecto.')
        : new HistoryError(404, 'La entrada no existe.');
    }
    const dir = c.dir;
    const abs = join(dir, file);
    let s;
    try {
      s = await lstat(abs);
    } catch {
      throw new HistoryError(404, 'La entrada no existe.');
    }
    if (!s.isFile()) throw new HistoryError(404, 'La entrada no existe.');
    if (s.size > MAX_ENTRY_BYTES) throw new HistoryError(413, 'La entrada supera 1 MB.');
    // Defensa adicional: la ruta real sigue dentro de la carpeta real del historial.
    try {
      const real = await realpath(abs);
      if (!real.startsWith(dir + sep)) throw new HistoryError(403, 'La entrada queda fuera de .agent/history.');
    } catch (e) {
      if (e instanceof HistoryError) throw e;
      throw new HistoryError(404, 'La entrada no existe.');
    }
    return { file, abs, mtimeMs: s.mtimeMs, size: s.size };
  }

  /** Entrada completa, o HistoryError 400 (nombre no válido), 403 (fuera del proyecto o de la carpeta), 404 o 413. */
  async get(project: HistoryProject, file: string): Promise<HistoryDetail> {
    const entry = await this.load(project.id, await this.localizar(project, file));
    if (!entry) throw new HistoryError(404, 'La entrada no existe.');
    return entry;
  }

  private serial<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
    const previo = this.locks.get(clave) ?? Promise.resolve();
    const actual = previo.then(tarea, tarea);
    const cola = actual.catch(() => {});
    this.locks.set(clave, cola);
    void cola.then(() => {
      if (this.locks.get(clave) === cola) this.locks.delete(clave);
    });
    return actual;
  }

  /**
   * Marca o desmarca un pendiente: valida la petición y el etag (409 con la
   * entrada actual) y escribe de forma atómica conservando los permisos.
   * Rechaza con 422 los archivos que no son UTF-8 válido.
   */
  setPending(project: HistoryProject, file: string, index: unknown, done: unknown, etag: unknown, today = localDate()): Promise<HistoryDetail> {
    const clave = join(project.path, HISTORY_DIR, file);
    return this.serial(clave, async () => {
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new HistoryError(400, 'Índice de pendiente no válido.');
      if (typeof done !== 'boolean') throw new HistoryError(400, 'Falta «done» (true o false).');
      if (typeof etag !== 'string' || etag === '') throw new HistoryError(400, 'Falta el etag de la entrada.');
      const archivo = await this.localizar(project, file);
      const actual = await this.get(project, file);
      if (actual.etag !== etag) throw new HistoryError(409, 'La entrada ha cambiado en disco desde que se abrió.', actual);
      const abs = archivo.abs;
      let bytes: Buffer;
      try {
        bytes = await readFile(abs);
      } catch {
        throw new HistoryError(404, 'La entrada no existe.');
      }
      const source = decodeStrict(bytes);
      const nuevo = editPending(source, index, done, today);
      if (nuevo === source) return actual;
      try {
        await writeAtomic(abs, nuevo);
      } catch (e) {
        throw new HistoryError(500, `No se pudo guardar la entrada${e instanceof Error ? `: ${e.message}` : ''}.`);
      }
      this.cache.delete(abs);
      return this.get(project, file);
    });
  }
}

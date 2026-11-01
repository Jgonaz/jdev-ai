import { execFile } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';

// Lectura y cambio de estado del backlog de un proyecto (formato de
// rules/backlog.md). Solo se lee el checkout principal: docs/backlog/<estado>/.
// La carpeta es la fuente de verdad del estado.

const execFileAsync = promisify(execFile);

export const STATES = ['backlog', 'todo', 'in-progress', 'done', 'discarded'] as const;
export type BacklogState = (typeof STATES)[number];

// Patrón de rules/backlog.md (BL-YYYYMMDD-HHMM-slug, el sufijo de un nombre
// repetido cabe en el slug). Sin puntos ni barras: no puede formar una ruta.
export const ITEM_ID_RE = /^BL-[0-9]{8}-[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BACKLOG_DIR = join('docs', 'backlog');
const MAX_ITEM_BYTES = 1024 * 1024;
const WORDS_PER_MINUTE = 200;

export type BacklogWarning = 'legacy' | 'invalid-yaml' | 'status-mismatch' | 'id-mismatch';

export type BacklogItem = {
  /** Nombre del archivo sin `.md`; no depende del campo `id` de la cabecera. */
  id: string;
  file: string;
  /** Estado según la carpeta. */
  status: BacklogState;
  title: string;
  type: string | null;
  priority: string | null;
  created: string | null;
  updated: string | null;
  summary: string | null;
  /** Tiempo estimado de lectura del resumen; 0 si no hay resumen. */
  readSeconds: number;
  warnings: BacklogWarning[];
  etag: string;
};

export type BacklogDetail = BacklogItem & {
  /** Cabecera YAML analizada; null en el formato antiguo o con YAML inválido. */
  header: Record<string, unknown> | null;
  /** Markdown tras el título `#`. */
  body: string;
  source: string;
  /** Ruta relativa a la raíz del proyecto, con barras `/`. */
  path: string;
};

export class BacklogError extends Error {
  readonly status: number;
  readonly item?: BacklogDetail;
  constructor(status: number, message: string, item?: BacklogDetail) {
    super(message);
    this.name = 'BacklogError';
    this.status = status;
    this.item = item;
  }
}

export const isBacklogState = (v: unknown): v is BacklogState =>
  typeof v === 'string' && (STATES as readonly string[]).includes(v);

// ------------------------------------------------------------------- Análisis

type Split = {
  /** Texto de la cabecera (sin los `---`), o null si no hay o no se cierra. */
  header: string | null;
  /** Desplazamiento de la cabecera y del resto dentro del texto. */
  headerStart: number;
  headerEnd: number;
  rest: string;
  /** Empieza por `---` pero la cabecera no se cierra. */
  unclosed: boolean;
};

function splitFrontMatter(source: string): Split {
  const apertura = /^﻿?---[ \t]*\r?\n/.exec(source);
  if (!apertura) return { header: null, headerStart: 0, headerEnd: 0, rest: source, unclosed: false };
  const inicio = apertura[0].length;
  const cierre = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;
  const resto = source.slice(inicio);
  // Una cabecera vacía (`---` seguido de `---`) también cuenta.
  const m = cierre.exec(resto);
  if (!m) return { header: null, headerStart: 0, headerEnd: 0, rest: source, unclosed: true };
  const fin = inicio + m.index;
  return { header: source.slice(inicio, fin), headerStart: inicio, headerEnd: fin, rest: source.slice(fin + m[0].length), unclosed: false };
}

// Analiza la cabecera en modo seguro: esquema core (fechas como texto), sin
// etiquetas propias y con el límite de alias por defecto de `yaml`. Devuelve
// null si el YAML no es válido o no es un mapa.
export function parseHeader(texto: string): Record<string, unknown> | null {
  let doc;
  try {
    doc = parseDocument(texto, { schema: 'core', customTags: [], uniqueKeys: true, prettyErrors: false });
  } catch {
    return null;
  }
  if (doc.errors.length > 0) return null;
  // Una etiqueta desconocida (p. ej. `!!js/function`) solo da un aviso en `yaml`: aquí invalida la cabecera.
  if (doc.warnings.length > 0) return null;
  let valor: unknown;
  try {
    valor = doc.toJS({ maxAliasCount: 50 });
  } catch {
    return null;
  }
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  return valor as Record<string, unknown>;
}

const texto = (v: unknown): string | null =>
  typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null;

const esValla = (l: string) => /^\s{0,3}(```|~~~)/.test(l);

// Índice de la primera línea `# Título` fuera de bloques de código, o -1.
function indiceTitulo(lineas: string[]): number {
  let enCodigo = false;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (esValla(l)) enCodigo = !enCodigo;
    else if (!enCodigo && /^#[ \t]+\S/.test(l)) return i;
  }
  return -1;
}

const limpiarTitulo = (l: string) => l.replace(/^#[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '').trim();

// Primer párrafo tras `## Resumen` (hasta una línea en blanco o un título).
export function extractSummary(body: string): string | null {
  const lineas = body.split(/\r?\n/);
  let enCodigo = false;
  let i = 0;
  for (; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (esValla(l)) enCodigo = !enCodigo;
    else if (!enCodigo && /^##[ \t]+resumen[ \t]*#*[ \t]*$/i.test(l.trim())) break;
  }
  if (i >= lineas.length) return null;
  i++;
  while (i < lineas.length && lineas[i]!.trim() === '') i++;
  const parrafo: string[] = [];
  for (; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (l.trim() === '' || /^#{1,6}[ \t]/.test(l) || esValla(l)) break;
    parrafo.push(l.trim());
  }
  return parrafo.length > 0 ? parrafo.join('\n') : null;
}

// A 200 palabras por minuto, redondeado a 10 s y con un mínimo de 10 s.
export function readSeconds(texto: string | null): number {
  if (!texto) return 0;
  const palabras = texto.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
  if (palabras === 0) return 0;
  return Math.max(10, Math.round(((palabras / WORDS_PER_MINUTE) * 60) / 10) * 10);
}

// Metadatos de la lista del formato antiguo (`- Tipo: finding`), solo hasta el
// primer `## ` tras el título, para no tomar listas del detalle.
function legacyMetadata(lineas: string[]): Record<string, string> {
  const claves: Record<string, string> = { id: 'id', tipo: 'type', estado: 'status', prioridad: 'priority', creado: 'created', actualizado: 'updated' };
  const meta: Record<string, string> = {};
  for (const l of lineas) {
    if (/^##[ \t]/.test(l)) break;
    const m = /^[-*][ \t]+(?:\*\*)?([\p{L}]+)(?:\*\*)?[ \t]*:[ \t]*(?:\*\*[ \t]*)?(.*)$/u.exec(l.trim());
    if (!m) continue;
    const clave = claves[m[1]!.toLowerCase()];
    const valor = m[2]!.replace(/`/g, '').trim();
    if (clave && valor !== '' && !(clave in meta)) meta[clave] = valor;
  }
  return meta;
}

export type ParseContext = { id: string; file: string; status: BacklogState; etag: string };

export function parseItem(source: string, ctx: ParseContext): BacklogDetail {
  const partes = splitFrontMatter(source);
  const warnings: BacklogWarning[] = [];
  let header: Record<string, unknown> | null = null;
  if (partes.header !== null) {
    header = parseHeader(partes.header);
    if (header === null) warnings.push('legacy', 'invalid-yaml');
  } else if (partes.unclosed) {
    warnings.push('legacy', 'invalid-yaml');
  } else {
    warnings.push('legacy');
  }

  const lineas = partes.rest.split(/\r?\n/);
  const t = indiceTitulo(lineas);
  const tituloDoc = t >= 0 ? limpiarTitulo(lineas[t]!) : null;
  const body = (t >= 0 ? lineas.slice(t + 1).join('\n') : partes.rest).replace(/^\s*\n/, '');
  const meta: Record<string, string | null> = header
    ? {
        id: texto(header.id),
        title: texto(header.title),
        type: texto(header.type),
        status: texto(header.status),
        priority: texto(header.priority),
        created: texto(header.created),
        updated: texto(header.updated),
      }
    : legacyMetadata(t >= 0 ? lineas.slice(t + 1) : lineas);

  if (header) {
    if (meta.status !== null && meta.status !== ctx.status) warnings.push('status-mismatch');
    if (meta.id !== null && meta.id !== ctx.id) warnings.push('id-mismatch');
  }
  const summary = extractSummary(body);
  return {
    id: ctx.id,
    file: ctx.file,
    status: ctx.status,
    title: meta.title ?? tituloDoc ?? ctx.id,
    type: meta.type ?? null,
    priority: meta.priority ?? null,
    created: meta.created ?? null,
    updated: meta.updated ?? null,
    summary,
    readSeconds: readSeconds(summary),
    warnings,
    etag: ctx.etag,
    header,
    body,
    source,
    path: `docs/backlog/${ctx.status}/${ctx.file}`,
  };
}

export function toListItem(d: BacklogDetail): BacklogItem {
  const { header: _h, body: _b, source: _s, path: _p, ...item } = d;
  return item;
}

// ---------------------------------------------------------- Edición de cabecera

// Valor escalar de una línea `clave: valor` de primer nivel, con comillas
// opcionales y comentario final opcional. El grupo 3 es el valor.
const lineaClave = (clave: string) => new RegExp(`^(${clave}:[ \\t]*)(["']?)([^"'#\\r\\n]*?)\\2([ \\t]*(?:#.*)?)$`);

/**
 * Cambia solo las líneas `status:` y `updated:` de la cabecera, sin
 * reserializar el YAML: conserva comentarios, comillas, orden y saltos de
 * línea. Añade `updated` tras `status` si falta. Devuelve el texto nuevo o
 * lanza BacklogError(422) si la cabecera no admite la edición mínima.
 */
export function editHeader(source: string, status: BacklogState, today: string): string {
  const partes = splitFrontMatter(source);
  if (partes.header === null) throw new BacklogError(422, 'El elemento no tiene cabecera YAML.');
  // Cada línea conserva su propio salto (\n o \r\n): el resto del texto queda idéntico.
  const lineas = partes.header.split(/(?<=\n)/);
  const eol = partes.header.includes('\r\n') ? '\r\n' : '\n';
  const reStatus = lineaClave('status');
  const reUpdated = lineaClave('updated');
  const sustituir = (i: number, re: RegExp, valor: string) => {
    const [, contenido, salto] = /^(.*?)(\r?\n)?$/s.exec(lineas[i]!)!;
    const m = re.exec(contenido!);
    if (!m) throw new BacklogError(422, 'La cabecera tiene un formato que el panel no sabe editar sin reescribirla; cambia el estado a mano.');
    lineas[i] = `${m[1]}${m[2]}${valor}${m[2]}${m[4]}${salto ?? ''}`;
  };
  // Si la cabecera no acaba en salto de línea (p. ej. vacía), se añade uno antes de insertar.
  const asegurarSalto = (i: number) => {
    if (i >= 0 && i < lineas.length && !lineas[i]!.endsWith('\n')) lineas[i] += eol;
  };
  let iStatus = lineas.findIndex((l) => /^status:/.test(l));
  if (iStatus >= 0) {
    sustituir(iStatus, reStatus, status);
  } else {
    // Sin `status`: se añade al final de la cabecera.
    asegurarSalto(lineas.length - 1);
    lineas.push(`status: ${status}${eol}`);
    iStatus = lineas.length - 1;
  }
  if (lineas.findIndex((l) => /^updated:/.test(l)) >= 0) {
    sustituir(lineas.findIndex((l) => /^updated:/.test(l)), reUpdated, today);
  } else {
    asegurarSalto(iStatus);
    lineas.splice(iStatus + 1, 0, `updated: ${today}${eol}`);
  }

  const cabecera = lineas.join('');
  const nuevo = source.slice(0, partes.headerStart) + cabecera + source.slice(partes.headerEnd);
  // Comprobación final: la cabecera editada sigue siendo YAML válido con esos valores.
  const comprobada = parseHeader(cabecera);
  if (!comprobada || comprobada.status !== status || texto(comprobada.updated) !== today) {
    throw new BacklogError(422, 'La cabecera tiene un formato que el panel no sabe editar sin reescribirla; cambia el estado a mano.');
  }
  return nuevo;
}

// ------------------------------------------------------------------ Transiciones

// rules/backlog.md, más las vueltas atrás para deshacer errores (siempre por
// acción explícita de la persona). done ↔ discarded no se permite.
const TRANSITIONS: Record<BacklogState, readonly BacklogState[]> = {
  backlog: ['todo', 'in-progress', 'done', 'discarded'],
  todo: ['in-progress', 'done', 'discarded', 'backlog'],
  'in-progress': ['done', 'discarded', 'todo', 'backlog'],
  done: ['backlog', 'todo', 'in-progress'],
  discarded: ['backlog', 'todo', 'in-progress'],
};

export const allowedTransitions = (from: BacklogState): readonly BacklogState[] => TRANSITIONS[from];

export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------- Lectura

type Entrada = { state: BacklogState; file: string; abs: string; mtimeMs: number; size: number };

// Incluye la carpeta: un `git mv` externo conserva mtime y tamaño, y sin el
// estado un detalle obsoleto podría mover el elemento desde otra carpeta.
const etagDe = (s: { state: BacklogState; mtimeMs: number; size: number }) => `${s.state}:${s.mtimeMs}-${s.size}`;

// Archivos regulares `BL-….md` de cada carpeta de estado. Los enlaces
// simbólicos se ignoran: podrían apuntar fuera del proyecto.
async function scan(projectPath: string): Promise<{ hasBacklog: boolean; entries: Entrada[] }> {
  const raiz = join(projectPath, BACKLOG_DIR);
  try {
    if (!(await lstat(raiz)).isDirectory()) return { hasBacklog: false, entries: [] };
  } catch {
    return { hasBacklog: false, entries: [] };
  }
  const entries: Entrada[] = [];
  for (const state of STATES) {
    const dir = join(raiz, state);
    let nombres: string[];
    try {
      if (!(await lstat(dir)).isDirectory()) continue;
      nombres = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of nombres.sort()) {
      if (!file.endsWith('.md') || !ITEM_ID_RE.test(file.slice(0, -3))) continue;
      const abs = join(dir, file);
      try {
        const s = await lstat(abs);
        if (s.isFile()) entries.push({ state, file, abs, mtimeMs: s.mtimeMs, size: s.size });
      } catch {
        // Desaparecido entre readdir y lstat.
      }
    }
  }
  return { hasBacklog: true, entries };
}

/** Firma del contenido del backlog: cambia si se crea, mueve, borra o edita un elemento. */
export async function backlogSignature(projectPath: string): Promise<string> {
  const { hasBacklog, entries } = await scan(projectPath);
  return `${hasBacklog ? 1 : 0}|${entries.map((e) => `${e.state}/${e.file}:${etagDe(e)}`).join('|')}`;
}

/**
 * Último cambio conocido de docs/backlog en milisegundos (0 sin backlog): el
 * mtime más reciente entre sus elementos y sus carpetas de estado, que cambian
 * al mover o borrar un elemento aunque los archivos no se modifiquen.
 */
export async function backlogLatestMtime(projectPath: string): Promise<number> {
  const { hasBacklog, entries } = await scan(projectPath);
  if (!hasBacklog) return 0;
  let max = 0;
  for (const e of entries) max = Math.max(max, e.mtimeMs);
  for (const dir of [join(projectPath, BACKLOG_DIR), ...STATES.map((st) => join(projectPath, BACKLOG_DIR, st))]) {
    try {
      const st = await lstat(dir);
      if (st.isDirectory()) max = Math.max(max, st.mtimeMs);
    } catch {
      // Carpeta de estado inexistente.
    }
  }
  return Math.floor(max);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

/** Número de cambios sin commit en docs/backlog (un renombrado cuenta como uno). 0 si no es un repositorio. */
export async function pendingChanges(projectPath: string): Promise<number> {
  try {
    const salida = await git(projectPath, ['status', '--porcelain', '--untracked-files=all', '--', 'docs/backlog']);
    return salida.split('\n').filter((l) => l.trim() !== '').length;
  } catch {
    return 0;
  }
}

async function isTracked(projectPath: string, rel: string): Promise<boolean> {
  try {
    await git(projectPath, ['ls-files', '--error-unmatch', '--', rel]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lector del backlog con caché por archivo (mtime y tamaño) y serialización de
 * los movimientos por proyecto.
 */
export class BacklogStore {
  private readonly cache = new Map<string, { etag: string; item: BacklogDetail }>();
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Para pruebas: número de archivos leídos del disco. */
  reads = 0;

  private async load(e: Entrada): Promise<BacklogDetail | null> {
    const etag = etagDe(e);
    const enCache = this.cache.get(e.abs);
    if (enCache && enCache.etag === etag) return enCache.item;
    if (e.size > MAX_ITEM_BYTES) return null;
    let source: string;
    try {
      source = await readFile(e.abs, 'utf8');
    } catch {
      return null;
    }
    this.reads++;
    const item = parseItem(source, { id: e.file.slice(0, -3), file: e.file, status: e.state, etag });
    this.cache.set(e.abs, { etag, item });
    return item;
  }

  async list(projectPath: string): Promise<{ hasBacklog: boolean; items: BacklogDetail[] }> {
    const { hasBacklog, entries } = await scan(projectPath);
    const vistos = new Set(entries.map((e) => e.abs));
    const prefijo = join(projectPath, BACKLOG_DIR) + '/';
    for (const k of this.cache.keys()) if (k.startsWith(prefijo) && !vistos.has(k)) this.cache.delete(k);
    const items: BacklogDetail[] = [];
    for (const e of entries) {
      const item = await this.load(e);
      if (item) items.push(item);
    }
    return { hasBacklog, items };
  }

  /** Elemento por identificador (el primero por orden de estados si hubiera duplicados). */
  async get(projectPath: string, id: string): Promise<BacklogDetail | null> {
    if (!ITEM_ID_RE.test(id)) return null;
    const file = `${id}.md`;
    for (const state of STATES) {
      const abs = join(projectPath, BACKLOG_DIR, state, file);
      try {
        const s = await lstat(abs);
        if (!s.isFile()) continue;
        const item = await this.load({ state, file, abs, mtimeMs: s.mtimeMs, size: s.size });
        if (item) return item;
      } catch {
        // No está en este estado.
      }
    }
    return null;
  }

  /** Ejecuta `tarea` en la cola en serie del proyecto, la misma de los movimientos (p. ej. el commit del backlog). */
  exclusive<T>(projectPath: string, tarea: () => Promise<T>): Promise<T> {
    return this.serial(projectPath, tarea);
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
   * Mueve el elemento a `to`: valida la transición y el etag, edita `status` y
   * `updated` y mueve el archivo con `git mv` (y `git add` del destino) si está
   * en seguimiento o con rename si no. No hace commit. Lanza BacklogError con el estado HTTP.
   */
  move(projectPath: string, id: string, to: unknown, etag: unknown, today = localDate()): Promise<BacklogDetail> {
    return this.serial(projectPath, async () => {
      if (!isBacklogState(to)) throw new BacklogError(400, `Estado destino no válido: usa ${STATES.join(', ')}.`);
      if (typeof etag !== 'string' || etag === '') throw new BacklogError(400, 'Falta el etag del elemento.');
      const item = await this.get(projectPath, id);
      if (!item) throw new BacklogError(404, 'El elemento no existe.');
      // El etag va antes que la transición: con un detalle obsoleto (p. ej. tras
      // un movimiento externo) se responde 409 con la versión actual, no 400.
      if (item.etag !== etag) throw new BacklogError(409, 'El elemento ha cambiado en disco desde que se abrió.', item);
      if (item.status === to) throw new BacklogError(400, `El elemento ya está en «${to}».`);
      if (!TRANSITIONS[item.status].includes(to)) {
        throw new BacklogError(400, `No se puede pasar de «${item.status}» a «${to}»: permitidos ${TRANSITIONS[item.status].join(', ')}.`);
      }
      if (item.warnings.includes('legacy')) {
        throw new BacklogError(
          422,
          item.warnings.includes('invalid-yaml')
            ? 'La cabecera YAML del elemento no es válida: corrígela antes de moverlo desde el panel.'
            : 'El elemento usa el formato antiguo, sin cabecera YAML: migra antes al formato actual de rules/backlog.md.',
        );
      }
      const nuevo = editHeader(item.source, to, today);

      const origenRel = item.path;
      const destinoRel = `docs/backlog/${to}/${item.file}`;
      const origen = join(projectPath, origenRel);
      const carpeta = join(projectPath, BACKLOG_DIR, to);
      const destino = join(carpeta, item.file);
      if (await existe(destino)) throw new BacklogError(409, `Ya existe ${destinoRel}: resuelve el duplicado a mano.`);
      await mkdir(carpeta, { recursive: true });

      // Primero el movimiento (si falla, no cambia nada) y luego la edición atómica en el destino.
      const enSeguimiento = await isTracked(projectPath, origenRel);
      const mover = async (de: string, a: string) => {
        if (enSeguimiento) await git(projectPath, ['mv', '--', de, a]);
        else await rename(join(projectPath, de), join(projectPath, a));
      };
      try {
        await mover(origenRel, destinoRel);
      } catch (e) {
        throw new BacklogError(500, `No se pudo mover el archivo${e instanceof Error ? `: ${e.message.trim()}` : ''}.`);
      }
      try {
        await writeAtomic(destino, nuevo);
      } catch (e) {
        await mover(destinoRel, origenRel).catch(() => {});
        throw new BacklogError(500, `No se pudo actualizar la cabecera${e instanceof Error ? `: ${e.message}` : ''}.`);
      }
      // Sin esto el índice tendría el renombrado con el contenido antiguo (`RM`).
      // Solo se añade lo que ya estaba en seguimiento.
      if (enSeguimiento) {
        try {
          await git(projectPath, ['add', '--', destinoRel]);
        } catch {
          // El movimiento ya está hecho; el índice queda como `RM`, que sigue siendo correcto.
        }
      }
      this.cache.delete(origen);
      const movido = await this.get(projectPath, id);
      if (!movido) throw new BacklogError(500, 'El elemento se movió, pero no se puede leer.');
      return movido;
    });
  }
}

async function existe(ruta: string): Promise<boolean> {
  try {
    await lstat(ruta);
    return true;
  } catch {
    return false;
  }
}

// Temporal en la misma carpeta y rename: nunca queda un archivo a medias.
export async function writeAtomic(ruta: string, contenido: string): Promise<void> {
  const dir = join(ruta, '..');
  const tmp = join(dir, `.${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    const modo = (await stat(ruta)).mode & 0o777;
    await writeFile(tmp, contenido, { encoding: 'utf8', mode: modo, flag: 'wx' });
    await rename(tmp, ruta);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

// --------------------------------------------------------------------- Vigilancia

export type WatchedProject = { id: string; path: string };

export type BacklogWatcherOptions = {
  projects: () => Promise<WatchedProject[]>;
  onChange: (projectId: string) => void;
  /** Relectura de respaldo; por defecto 10 s. */
  fallbackMs?: number;
  debounceMs?: number;
  /** Firma de lo vigilado en un proyecto; por defecto, la del backlog. */
  signature?: (projectPath: string) => Promise<string>;
  /** Carpetas a vigilar con fs.watch; por defecto, docs/backlog y sus estados. */
  dirs?: (projectPath: string) => string[];
};

const backlogDirs = (ruta: string) => [join(ruta, BACKLOG_DIR), ...STATES.map((s) => join(ruta, BACKLOG_DIR, s))];

/**
 * Vigila docs/backlog y sus carpetas de estado de cada proyecto con fs.watch y
 * una relectura de respaldo. Solo avisa si cambia la firma del backlog. Con
 * `signature` y `dirs` vigila otra cosa (p. ej. el historial).
 */
export class BacklogWatcher {
  private readonly opts: BacklogWatcherOptions;
  private readonly firmas = new Map<string, string>();
  private readonly rutas = new Map<string, string>();
  private readonly vigilantes = new Map<string, FSWatcher>();
  private readonly pendientes = new Map<string, NodeJS.Timeout>();
  private intervalo: NodeJS.Timeout | null = null;
  private parado = true;

  constructor(opts: BacklogWatcherOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.parado = false;
    await this.sync(false);
    this.intervalo = setInterval(() => void this.sync(true), this.opts.fallbackMs ?? 10000);
    this.intervalo.unref();
  }

  stop(): void {
    this.parado = true;
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
    for (const t of this.pendientes.values()) clearTimeout(t);
    this.pendientes.clear();
    for (const w of this.vigilantes.values()) w.close();
    this.vigilantes.clear();
  }

  /** Actualiza la firma de un proyecto sin avisar (tras un cambio que ya se ha anunciado). */
  mark(projectId: string): Promise<void> {
    return this.check(projectId, false);
  }

  /** Programa la comprobación de un proyecto (con debounce). */
  notify(projectId: string): void {
    if (this.parado || this.pendientes.has(projectId)) return;
    const t = setTimeout(() => {
      this.pendientes.delete(projectId);
      void this.check(projectId, true);
    }, this.opts.debounceMs ?? 150);
    t.unref();
    this.pendientes.set(projectId, t);
  }

  private async check(projectId: string, avisar: boolean): Promise<void> {
    const ruta = this.rutas.get(projectId);
    if (ruta === undefined || this.parado) return;
    let firma: string;
    try {
      firma = await (this.opts.signature ?? backlogSignature)(ruta);
    } catch {
      return;
    }
    const anterior = this.firmas.get(projectId);
    this.firmas.set(projectId, firma);
    if (avisar && anterior !== undefined && anterior !== firma && !this.parado) this.opts.onChange(projectId);
    this.rearm(projectId, ruta);
  }

  // Mantiene un fs.watch por carpeta existente (docs/backlog y cada estado).
  private rearm(projectId: string, ruta: string): void {
    if (this.parado) return;
    for (const dir of (this.opts.dirs ?? backlogDirs)(ruta)) {
      const clave = `${projectId}\0${dir}`;
      const previo = this.vigilantes.get(clave);
      if (previo) {
        // Si la carpeta se borró, el vigilante ya no sirve; se recrea cuando vuelva a existir.
        if (existsSync(dir)) continue;
        previo.close();
        this.vigilantes.delete(clave);
      }
      try {
        const w = watch(dir, { persistent: false }, () => this.notify(projectId));
        w.on('error', () => {
          w.close();
          this.vigilantes.delete(clave);
        });
        this.vigilantes.set(clave, w);
      } catch {
        // La carpeta no existe todavía: la relectura de respaldo volverá a intentarlo.
      }
    }
  }

  private async sync(avisar: boolean): Promise<void> {
    let proyectos: WatchedProject[];
    try {
      proyectos = await this.opts.projects();
    } catch {
      return;
    }
    if (this.parado) return;
    const ids = new Set(proyectos.map((p) => p.id));
    for (const [clave, w] of this.vigilantes) {
      if (!ids.has(clave.split('\0')[0]!)) {
        w.close();
        this.vigilantes.delete(clave);
      }
    }
    for (const id of [...this.rutas.keys()]) {
      if (!ids.has(id)) {
        this.rutas.delete(id);
        this.firmas.delete(id);
      }
    }
    for (const p of proyectos) {
      this.rutas.set(p.id, p.path);
      await this.check(p.id, avisar);
    }
  }
}

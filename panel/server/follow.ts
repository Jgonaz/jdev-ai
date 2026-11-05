// Seguimiento en directo de los subagentes y las shells en segundo plano de una
// sesión del panel. Solo lee archivos de Claude, del usuario y dentro de sus
// carpetas, y los sirve ya interpretados y por trozos:
//
//   subagente  <dir del transcript>/<session_id>/subagents/agent-<id>.jsonl (+ .meta.json)
//   shell      la ruta «…/tasks/<id>.output» que Claude anunció en el transcript
//              de la sesión, solo bajo ${TMPDIR:-/tmp}/claude-<uid>/
//
// Los formatos son internos de Claude Code (2.1.316) y pueden cambiar: cada campo
// se lee de forma opcional y lo que no se entienda se ignora.

import { realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { openRegularFile } from './safefile.ts';
import { resolveTranscript } from './titles.ts';
import { FOLLOW_ID } from '../shared/follow.ts';
import type { AgentEvent, AgentFollow, ShellFollow } from '../shared/follow.ts';
import type { FollowTargets } from './usage.ts';

/** Bytes que se leen como máximo por respuesta. */
export const FOLLOW_CHUNK = 256 * 1024;
/** Una sola línea de un transcript mayor que esto (resultados enormes) se descarta. */
const MAX_LINE = 2 * 1024 * 1024;
/** Líneas de la salida de una shell que se sirven en la primera petición. */
export const SHELL_TAIL_LINES = 2000;
const META_MAX_BYTES = 64 * 1024;

const MAX_TASK = 8000;
/** Los mensajes llegan hasta aquí; el cliente recorta a 4 000 los que no son el resultado final. */
const MAX_MESSAGE = 20000;
const MAX_TARGET = 200;
const MAX_SUMMARY = 200;

export class FollowError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FollowError';
    this.status = status;
  }
}

const noHayDatos = (porque: string) => new FollowError(404, `No hay datos que mostrar: ${porque}`);

// ------------------------------------------------------------------ Eventos

export type { AgentEvent, AgentFollow, FollowState, ShellFollow } from '../shared/follow.ts';

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function cadena(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

function recorta(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/**
 * Primera línea con contenido. Se saltan los encabezados Markdown sueltos («### Result»
 * de las herramientas MCP) y las vallas de código, que no dicen nada del resultado.
 */
function primeraLinea(texto: string, max: number): string {
  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const util = lineas.find((l) => !/^#{1,6}\s/.test(l) && !/^```/.test(l)) ?? lineas[0] ?? '';
  return recorta(util, max);
}

function contarLineas(texto: string): number {
  return texto === '' ? 0 : texto.split('\n').length;
}

/** Ruta relativa al directorio de trabajo del subagente si cuelga de él. */
function relativa(ruta: string, cwd: string | null): string {
  if (cwd && ruta === cwd) return '.';
  if (cwd && ruta.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`)) return ruta.slice(cwd.length).replace(/^\//, '');
  return ruta;
}

type Herramienta = { verb: string; target: string; detail?: string };

/** Verbo, objetivo y detalle de una llamada a herramienta, con el estilo de la terminal. */
export function describeTool(nombre: string, entrada: Record<string, unknown> | null, cwd: string | null): Herramienta {
  const e = entrada ?? {};
  const ruta = cadena(e.file_path) ?? cadena(e.path) ?? cadena(e.notebook_path);
  switch (nombre) {
    case 'Read':
      return { verb: 'Leo', target: ruta ? relativa(ruta, cwd) : '' };
    case 'Grep': {
      const patron = cadena(e.pattern);
      const donde = cadena(e.path);
      const objetivo = `${patron ? `«${patron}»` : ''}${donde ? ` en ${relativa(donde, cwd)}` : ''}`.trim();
      return { verb: 'Busco', target: objetivo };
    }
    case 'Glob': {
      const patron = cadena(e.pattern);
      const donde = cadena(e.path);
      return { verb: 'Busco', target: `${patron ?? ''}${donde ? ` en ${relativa(donde, cwd)}` : ''}`.trim() };
    }
    case 'Edit': {
      const mas = contarLineas(typeof e.new_string === 'string' ? e.new_string : '');
      const menos = contarLineas(typeof e.old_string === 'string' ? e.old_string : '');
      return { verb: 'Edito', target: ruta ? relativa(ruta, cwd) : '', detail: delta(mas, menos) };
    }
    case 'MultiEdit': {
      const ediciones = Array.isArray(e.edits) ? e.edits : [];
      let mas = 0;
      let menos = 0;
      for (const ed of ediciones) {
        const o = objeto(ed);
        mas += contarLineas(typeof o?.new_string === 'string' ? o.new_string : '');
        menos += contarLineas(typeof o?.old_string === 'string' ? o.old_string : '');
      }
      return { verb: 'Edito', target: ruta ? relativa(ruta, cwd) : '', detail: delta(mas, menos) };
    }
    case 'Write':
      return { verb: 'Escribo', target: ruta ? relativa(ruta, cwd) : '', detail: delta(contarLineas(typeof e.content === 'string' ? e.content : ''), 0) };
    case 'Bash':
      return { verb: 'Ejecuto', target: cadena(e.command)?.split('\n')[0]?.trim() ?? '' };
    case 'Agent':
    case 'Task':
      return { verb: 'Delego', target: cadena(e.description) ?? cadena(e.subagent_type) ?? '' };
    case 'WebFetch':
      return { verb: 'Consulto', target: cadena(e.url) ?? '' };
    default: {
      // Herramientas MCP: «mcp__<servidor>__<herramienta>» se muestra como «Uso <servidor> · <herramienta>».
      const mcp = /^mcp__(.+?)__(.+)$/.exec(nombre);
      if (mcp) return { verb: 'Uso', target: `${mcp[1]} · ${mcp[2]}` };
      return { verb: nombre, target: '' };
    }
  }
}

function delta(mas: number, menos: number): string | undefined {
  const partes = [mas > 0 ? `+${mas}` : '', menos > 0 ? `−${menos}` : ''].filter((p) => p !== '');
  return partes.length > 0 ? `(${partes.join(' ')})` : undefined;
}

/** Texto de un `tool_result.content`: una cadena o una lista de bloques de texto. */
function textoDeResultado(contenido: unknown): string {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return '';
  return contenido
    .map((b) => {
      const o = objeto(b);
      return o && o.type === 'text' && typeof o.text === 'string' ? o.text : '';
    })
    .filter((t) => t !== '')
    .join('\n');
}

function fechaDe(valor: unknown): number | null {
  const f = typeof valor === 'string' ? Date.parse(valor) : NaN;
  return Number.isNaN(f) ? null : f;
}

/**
 * Interpreta líneas completas de un transcript de subagente. `primero` indica
 * que el texto empieza en el byte 0: el encargo es el primer mensaje de usuario
 * con texto. Ignora el razonamiento (`thinking`), los tipos internos y las
 * líneas que no son JSON.
 */
export function parseAgentLines(texto: string, opciones: { primero: boolean; cwd: string | null }): AgentEvent[] {
  const eventos: AgentEvent[] = [];
  let hayEncargo = !opciones.primero;
  let cwd = opciones.cwd;
  for (const linea of texto.split('\n')) {
    if (linea.trim() === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(linea);
    } catch {
      continue;
    }
    const o = objeto(obj);
    if (!o) continue;
    if (typeof o.cwd === 'string' && o.cwd.startsWith('/')) cwd = o.cwd;
    const mensaje = objeto(o.message);
    const contenido = mensaje?.content;
    const at = fechaDe(o.timestamp);
    if (o.type === 'user') {
      if (typeof contenido === 'string') {
        if (!hayEncargo && contenido.trim() !== '') {
          hayEncargo = true;
          eventos.push({ type: 'task', text: recorta(contenido.trim(), MAX_TASK) });
        }
      } else if (Array.isArray(contenido)) {
        for (const b of contenido) {
          const bloque = objeto(b);
          if (!bloque) continue;
          if (bloque.type === 'tool_result' && typeof bloque.tool_use_id === 'string') {
            const resultado = textoDeResultado(bloque.content);
            eventos.push({
              type: 'result',
              id: bloque.tool_use_id,
              error: bloque.is_error === true,
              summary: primeraLinea(resultado, MAX_SUMMARY),
              lines: resultado.split('\n').filter((l) => l.trim() !== '').length,
            });
          } else if (!hayEncargo && bloque.type === 'text' && typeof bloque.text === 'string' && bloque.text.trim() !== '') {
            hayEncargo = true;
            eventos.push({ type: 'task', text: recorta(bloque.text.trim(), MAX_TASK) });
          }
        }
      }
    } else if (o.type === 'assistant' && Array.isArray(contenido)) {
      for (const b of contenido) {
        const bloque = objeto(b);
        if (!bloque) continue;
        if (bloque.type === 'text' && typeof bloque.text === 'string' && bloque.text.trim() !== '') {
          eventos.push({ type: 'message', text: recorta(bloque.text.trim(), MAX_MESSAGE), at });
        } else if (bloque.type === 'tool_use' && typeof bloque.id === 'string' && typeof bloque.name === 'string') {
          const nombre = bloque.name.slice(0, 60);
          const entrada = objeto(bloque.input);
          if (nombre === 'SubagentHandback') {
            // El informe final de los agentes del harness va en esta herramienta, no en un texto.
            const informe = cadena(entrada?.message);
            if (informe) eventos.push({ type: 'message', text: recorta(informe.trim(), MAX_MESSAGE), at });
            continue;
          }
          const h = describeTool(nombre, entrada, cwd);
          eventos.push({
            type: 'tool',
            id: bloque.id,
            tool: nombre,
            verb: h.verb,
            target: recorta(h.target, MAX_TARGET),
            ...(h.detail ? { detail: h.detail } : {}),
            at,
          });
        }
      }
    }
  }
  return eventos;
}

// ------------------------------------------------------------------ Lectura

/** Abre un archivo regular del usuario (ver openRegularFile); null si no lo es o es de otro uid. */
async function abrirDelUsuario(real: string, uid: number | null): Promise<{ fh: FileHandle; size: number; mtimeMs: number } | null> {
  const abierto = await openRegularFile(real);
  if (!abierto) return null;
  if (uid !== null && abierto.stat.uid !== uid) {
    await abierto.fh.close().catch(() => {});
    return null;
  }
  return { fh: abierto.fh, size: abierto.stat.size, mtimeMs: abierto.stat.mtimeMs };
}

/** Ruta real de `candidata` si existe y queda dentro de `base` (ya resuelta); null en otro caso. */
async function dentroDe(candidata: string, base: string): Promise<string | null> {
  try {
    const real = await realpath(candidata);
    return real.startsWith(base + sep) ? real : null;
  } catch {
    return null;
  }
}

async function leer(fh: FileHandle, desde: number, longitud: number): Promise<Buffer> {
  const buf = Buffer.alloc(longitud);
  let total = 0;
  while (total < longitud) {
    const { bytesRead } = await fh.read(buf, total, longitud - total, desde + total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buf.subarray(0, total);
}

type Ventana = { texto: string; next: number; more: boolean };

/**
 * Líneas completas a partir de `desde`, hasta FOLLOW_CHUNK bytes. Una línea
 * incompleta al final del archivo (aún se está escribiendo) no se consume; una
 * línea mayor que MAX_LINE se salta entera.
 */
export async function leerLineas(fh: FileHandle, desde: number, size: number): Promise<Ventana> {
  if (desde >= size) return { texto: '', next: desde, more: false };
  const longitud = Math.min(FOLLOW_CHUNK, size - desde);
  const buf = await leer(fh, desde, longitud);
  const ultimo = buf.lastIndexOf(0x0a);
  if (ultimo >= 0) {
    return { texto: buf.subarray(0, ultimo + 1).toString('utf8'), next: desde + ultimo + 1, more: desde + longitud < size };
  }
  if (desde + longitud >= size) return { texto: '', next: desde, more: false };

  // Una sola línea mayor que el trozo: se busca su final sin retenerla más allá de MAX_LINE.
  let fin = -1;
  let pos = desde + longitud;
  while (pos < size) {
    const bloque = await leer(fh, pos, Math.min(64 * 1024, size - pos));
    if (bloque.length === 0) break;
    const i = bloque.indexOf(0x0a);
    if (i >= 0) {
      fin = pos + i;
      break;
    }
    pos += bloque.length;
  }
  if (fin < 0) return { texto: '', next: desde, more: false };
  const tamano = fin + 1 - desde;
  const texto = tamano <= MAX_LINE ? (await leer(fh, desde, tamano)).toString('utf8') : '';
  return { texto, next: fin + 1, more: fin + 1 < size };
}

/** Recorta un buffer para que no termine en mitad de un carácter UTF-8. */
function hastaLimiteUtf8(buf: Buffer): Buffer {
  for (let atras = 1; atras <= Math.min(3, buf.length); atras++) {
    const b = buf[buf.length - atras]!;
    if ((b & 0xc0) === 0x80) continue; // continuación: sigue buscando la cabecera
    const esperados = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return esperados > atras ? buf.subarray(0, buf.length - atras) : buf;
  }
  return buf;
}

function ultimasLineas(texto: string, max: number): string {
  const lineas = texto.split('\n');
  // Un texto que acaba en salto de línea deja una última cadena vacía que no es una línea.
  const util = lineas[lineas.length - 1] === '' ? lineas.length - 1 : lineas.length;
  return util <= max ? texto : lineas.slice(util - max, lineas.length).join('\n');
}

// ---------------------------------------------------------------- Respuestas

/** Lo que el servicio de sesiones sabe de una sesión del panel para localizar sus archivos. */
export type FollowContext = {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  targets: FollowTargets;
};

export type FollowerOptions = {
  /** Directorio de proyectos de Claude (con los transcripts). */
  projectsDir: string;
  /** Directorios temporales bajo los que Claude deja `claude-<uid>/`; por defecto /tmp y TMPDIR. */
  tmpRoots?: string[];
  /** Uid propietario de los archivos; por defecto el del proceso. Sin uid (Windows) no se sirve nada. */
  uid?: number | null;
};

const SESSION_FILE = /^[A-Za-z0-9-]+$/;
const OUTPUT_ANNOUNCED = /Output is being written to: (\/[^\s]+?\.output)/;
const NEGATIVE_TTL_MS = 5000;
const MAX_CACHE = 200;

type ShellLocation = { path: string; startedAt: number | null };

export class Follower {
  private readonly projectsDir: string;
  private readonly tmpRoots: string[];
  private readonly uid: number | null;
  private readonly found = new Map<string, ShellLocation>();
  private readonly missing = new Map<string, number>();

  constructor(opts: FollowerOptions) {
    this.projectsDir = opts.projectsDir;
    this.tmpRoots = opts.tmpRoots ?? [...new Set(['/tmp', process.env.TMPDIR].filter((d): d is string => !!d && d.startsWith('/')))];
    this.uid = opts.uid === undefined ? (process.getuid?.() ?? null) : opts.uid;
  }

  /** Subagente: eventos nuevos desde el byte `from` (0 si es la primera petición). */
  async agent(ctx: FollowContext, id: string, from: number): Promise<AgentFollow> {
    const destino = ctx.targets.subagents.get(id);
    if (!FOLLOW_ID.test(id) || !destino) throw noHayDatos('ese subagente no consta en la actividad de la sesión.');
    if (this.uid === null || !SESSION_FILE.test(ctx.sessionId)) throw noHayDatos('no se pueden leer archivos de Claude en este sistema.');

    const base = await this.projectsReal();
    const transcript = await this.transcript(ctx);
    const carpeta = join(dirname(transcript), ctx.sessionId, 'subagents');
    // La carpeta de subagentes de esta sesión, ya resuelta, y el archivo debe seguir dentro de ella.
    const carpetaReal = await dentroDe(carpeta, base);
    const real = carpetaReal ? await dentroDe(join(carpetaReal, `agent-${id}.jsonl`), carpetaReal) : null;
    const abierto = real ? await abrirDelUsuario(real, this.uid) : null;
    if (!abierto) throw noHayDatos('el transcript del subagente no existe o queda fuera de las carpetas de Claude.');

    try {
      const meta = await this.agentMeta(carpetaReal!, id);
      const reset = from > abierto.size;
      const desde = reset ? 0 : from;
      const v = await leerLineas(abierto.fh, desde, abierto.size);
      const terminado = meta?.finished === true || destino.stopped;
      return {
        kind: 'agent',
        state: terminado ? 'finished' : 'running',
        from: v.next,
        reset,
        more: v.more,
        meta: {
          description: meta?.description ?? null,
          agentType: meta?.agentType ?? destino.type,
          startedAt: destino.since,
          updatedAt: abierto.mtimeMs,
        },
        events: parseAgentLines(v.texto, { primero: desde === 0, cwd: ctx.cwd || null }),
      };
    } finally {
      await abierto.fh.close().catch(() => {});
    }
  }

  /** Shell: salida nueva desde el byte `from`; sin él, las últimas 2 000 líneas. */
  async shell(ctx: FollowContext, id: string, from: number | null): Promise<ShellFollow> {
    const destino = ctx.targets.shells.get(id);
    if (!FOLLOW_ID.test(id) || !destino) throw noHayDatos('esa shell no consta en la actividad de la sesión.');
    if (this.uid === null || !SESSION_FILE.test(ctx.sessionId)) throw noHayDatos('no se pueden leer archivos de Claude en este sistema.');

    const sitio = await this.locateShell(ctx, id);
    const real = await this.salidaPermitida(sitio.path);
    const abierto = real && basename(real) === `${id}.output` ? await abrirDelUsuario(real, this.uid) : null;
    if (!abierto) throw noHayDatos('la salida de la shell no existe o queda fuera de la carpeta temporal de Claude.');

    try {
      const reset = from !== null && from > abierto.size;
      const incremental = from !== null && !reset;
      let texto: string;
      let next: number;
      let more: boolean;
      if (incremental) {
        const longitud = Math.min(FOLLOW_CHUNK, abierto.size - from);
        const buf = hastaLimiteUtf8(await leer(abierto.fh, from, longitud));
        texto = buf.toString('utf8');
        next = from + buf.length;
        more = from + longitud < abierto.size;
      } else {
        const inicio = Math.max(0, abierto.size - FOLLOW_CHUNK);
        let buf = hastaLimiteUtf8(await leer(abierto.fh, inicio, abierto.size - inicio));
        next = inicio + buf.length;
        if (inicio > 0) {
          // El trozo empieza en mitad de algo: fuera la primera línea, que puede estar cortada.
          const nl = buf.indexOf(0x0a);
          buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0);
        }
        texto = ultimasLineas(buf.toString('utf8'), SHELL_TAIL_LINES);
        more = false;
      }
      return {
        kind: 'shell',
        state: destino.running ? 'running' : 'finished',
        from: next,
        reset,
        more,
        meta: { command: destino.label, startedAt: sitio.startedAt, updatedAt: abierto.mtimeMs },
        text: texto,
      };
    } finally {
      await abierto.fh.close().catch(() => {});
    }
  }

  private async projectsReal(): Promise<string> {
    try {
      return await realpath(this.projectsDir);
    } catch {
      throw noHayDatos('no existe el directorio de proyectos de Claude.');
    }
  }

  private async transcript(ctx: FollowContext): Promise<string> {
    if (ctx.transcriptPath === '') throw noHayDatos('la sesión aún no tiene transcript.');
    let real: string | null;
    try {
      real = await resolveTranscript(ctx.transcriptPath, this.projectsDir);
    } catch {
      throw noHayDatos('el transcript de la sesión queda fuera del directorio de proyectos de Claude.');
    }
    if (real === null) throw noHayDatos('el transcript de la sesión no existe.');
    return real;
  }

  private async agentMeta(carpeta: string, id: string): Promise<{ description: string | null; agentType: string | null; finished: boolean } | null> {
    const real = await dentroDe(join(carpeta, `agent-${id}.meta.json`), carpeta);
    const abierto = real ? await abrirDelUsuario(real, this.uid) : null;
    if (!abierto) return null;
    try {
      if (abierto.size > META_MAX_BYTES) return null;
      const o = objeto(JSON.parse((await leer(abierto.fh, 0, abierto.size)).toString('utf8')));
      if (!o) return null;
      return {
        description: typeof o.description === 'string' && o.description.trim() !== '' ? recorta(o.description.trim(), 300) : null,
        agentType: typeof o.agentType === 'string' && o.agentType.trim() !== '' ? recorta(o.agentType.trim(), 60) : null,
        finished: o.finished === true,
      };
    } catch {
      return null;
    } finally {
      await abierto.fh.close().catch(() => {});
    }
  }

  /** Ruta real de la salida si cuelga de `<tmp>/claude-<uid>/` de alguna raíz permitida; null en otro caso. */
  private async salidaPermitida(ruta: string): Promise<string | null> {
    for (const raiz of this.tmpRoots) {
      let base: string;
      try {
        base = await realpath(join(raiz, `claude-${this.uid}`));
      } catch {
        continue; // Esa raíz no tiene directorio de Claude.
      }
      const real = await dentroDe(ruta, base);
      if (real) return real;
    }
    return null;
  }

  /**
   * La ruta que Claude anunció para la salida de la tarea `id`: se busca en el
   * transcript de la sesión el `tool_result` cuyo `toolUseResult.backgroundTaskId`
   * es el id. Se cachea por sesión e id (los fallos, unos segundos).
   */
  /** Busca la salida de la shell `id` en los transcripts de los subagentes conocidos de la sesión. */
  private async buscarEnSubagentes(ctx: FollowContext, transcript: string, id: string): Promise<ShellLocation | null> {
    if (!SESSION_FILE.test(ctx.sessionId)) return null;
    const base = await this.projectsReal();
    const carpetaReal = await dentroDe(join(dirname(transcript), ctx.sessionId, 'subagents'), base);
    if (!carpetaReal) return null;
    const ids = [...ctx.targets.subagents.entries()]
      .sort((a, b) => (b[1].since ?? 0) - (a[1].since ?? 0))
      .map(([agente]) => agente)
      .filter((agente) => FOLLOW_ID.test(agente))
      .slice(0, MAX_SUBAGENT_SEARCH);
    for (const agente of ids) {
      const real = await dentroDe(join(carpetaReal, `agent-${agente}.jsonl`), carpetaReal);
      if (!real) continue;
      const hallada = await buscarSalida(real, id, this.uid);
      if (hallada) return hallada;
    }
    return null;
  }

  private async locateShell(ctx: FollowContext, id: string): Promise<ShellLocation> {
    const clave = `${ctx.sessionId}/${id}`;
    const previa = this.found.get(clave);
    if (previa) return previa;
    const fallo = this.missing.get(clave);
    if (fallo !== undefined && Date.now() - fallo < NEGATIVE_TTL_MS) throw noHayDatos('Claude no anunció dónde guarda la salida de esta shell.');

    const transcript = await this.transcript(ctx);
    let encontrada = await buscarSalida(transcript, id, this.uid);
    // Una shell lanzada por un subagente se anuncia en el transcript de ese subagente.
    if (!encontrada) encontrada = await this.buscarEnSubagentes(ctx, transcript, id);
    if (!encontrada) {
      if (this.missing.size >= MAX_CACHE) this.missing.clear();
      this.missing.set(clave, Date.now());
      throw noHayDatos('Claude no anunció dónde guarda la salida de esta shell.');
    }
    this.missing.delete(clave);
    if (this.found.size >= MAX_CACHE) this.found.clear();
    this.found.set(clave, encontrada);
    return encontrada;
  }
}

/** Ids de subagente seguibles cuyos transcripts pueden haber lanzado una shell (los más recientes primero). */
const MAX_SUBAGENT_SEARCH = 30;

/**
 * Recorre el transcript por trozos buscando la línea que lanzó la tarea `id` en
 * segundo plano. Solo se interpretan las líneas que mencionan el id y la clave.
 */
export async function buscarSalida(transcript: string, id: string, uid: number | null): Promise<ShellLocation | null> {
  const abierto = await abrirDelUsuario(transcript, uid);
  if (!abierto) return null;
  try {
    let resto: Buffer = Buffer.alloc(0);
    let pos = 0;
    const revisa = (linea: Buffer): ShellLocation | null => {
      if (linea.length === 0 || linea.length > 8 * MAX_LINE) return null;
      const texto = linea.toString('utf8');
      if (!texto.includes('backgroundTaskId') || !texto.includes(id)) return null;
      try {
        const o = objeto(JSON.parse(texto));
        if (objeto(o?.toolUseResult)?.backgroundTaskId !== id) return null;
        const contenido = objeto(o?.message)?.content;
        const bloques = Array.isArray(contenido) ? contenido : [];
        for (const b of bloques) {
          const bloque = objeto(b);
          if (bloque?.type !== 'tool_result') continue;
          const ruta = OUTPUT_ANNOUNCED.exec(textoDeResultado(bloque.content))?.[1];
          if (ruta) return { path: ruta, startedAt: fechaDe(o?.timestamp) };
        }
      } catch {
        // Línea cortada o ajena.
      }
      return null;
    };
    while (pos < abierto.size) {
      const trozo = await leer(abierto.fh, pos, Math.min(1024 * 1024, abierto.size - pos));
      if (trozo.length === 0) break;
      pos += trozo.length;
      let datos: Buffer = resto.length > 0 ? Buffer.concat([resto, trozo]) : trozo;
      let nl: number;
      while ((nl = datos.indexOf(0x0a)) !== -1) {
        const hallada = revisa(datos.subarray(0, nl));
        if (hallada) return hallada;
        datos = datos.subarray(nl + 1);
      }
      // Lo que queda es el principio de una línea; una enorme que no interesa no se retiene.
      resto = datos.length > 8 * MAX_LINE ? Buffer.alloc(0) : Buffer.from(datos);
    }
    return null;
  } finally {
    await abierto.fh.close().catch(() => {});
  }
}

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

import { lstat, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { openRegularFile } from './safefile.ts';
import { resolveTranscript } from './titles.ts';
import { FOLLOW_ID, QUESTION_LIMITS } from '../shared/follow.ts';
import { classifyTool } from '../shared/stations.ts';
import type { AgentEvent, AgentFollow, ConversationResponse, QuestionItem, ShellFollow } from '../shared/follow.ts';
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
/** Texto de un resultado de herramienta que viaja en la conversación, para poder buscar en él. */
const MAX_OUTPUT = 4000;
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
    case 'Skill':
      return { verb: 'Uso la skill', target: cadena(e.skill) ?? '' };
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

/** Etiquetas con las que Claude Code escribe en el transcript «mensajes de usuario» que no teclea la persona. */
const SINTETICO = /^<(?:system-reminder|local-command-|command-|bash-|task-notification|artifact-content-authored)|^\[Request interrupted/;
const RECORDATORIOS = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
// Claude Code guarda un pegado largo (>~1000 caracteres) envuelto: `\n\n<pasted_content id="2a51">\n…\n</pasted_content id="2a51">\n`.
// Solo se quita cuando abre y cierra con el mismo id; uno sin cerrar o con otro id se deja tal cual.
const PEGADO = /<pasted_content id="([^"\s]+)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">\n?/g;

/**
 * Texto que de verdad escribió la persona en un bloque de texto de un mensaje de
 * usuario; null si es sintético (recordatorios, comandos locales, notificaciones,
 * interrupciones). Un recordatorio pegado al final de un mensaje real se quita.
 */
function textoDePersona(bruto: string): string | null {
  const limpio = bruto.replace(RECORDATORIOS, '').trim();
  if (limpio === '' || SINTETICO.test(limpio)) return null;
  const sinEnvoltorio = limpio.replace(PEGADO, '$2').trim();
  return sinEnvoltorio === '' ? null : sinEnvoltorio;
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Texto sin secuencias de escape ANSI (colores, estilos, OSC). */
export function stripAnsi(texto: string): string {
  return texto.replace(ANSI, '');
}

const COMMAND_NAME = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
const LOCAL_OUTPUT = /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/g;
const MAX_COMMAND_ARGS = 4000;

/** Texto de un mensaje de usuario: la cadena, o los bloques de texto unidos; null si trae otra cosa (resultados, imágenes). */
function textoDeUsuario(contenido: unknown): string | null {
  if (typeof contenido === 'string') return contenido;
  if (!Array.isArray(contenido)) return null;
  const partes: string[] = [];
  for (const b of contenido) {
    const bloque = objeto(b);
    if (bloque?.type !== 'text' || typeof bloque.text !== 'string') return null;
    partes.push(bloque.text);
  }
  return partes.join('\n');
}

/**
 * Los mensajes `user` que Claude Code escribe al ejecutar un comando: `<command-name>` con sus
 * argumentos (el comando que tecleó la persona) y `<local-command-stdout>`/`-stderr` (su salida
 * local, sin ANSI y recortada). Una salida vacía o «(no content)» no se emite.
 */
function eventosDeComando(texto: string, at: number | null): AgentEvent[] | null {
  const nombre = COMMAND_NAME.exec(texto)?.[1];
  if (nombre !== undefined) {
    const limpio = nombre.replace(/^\//, '').trim();
    if (limpio === '') return [];
    return [{ type: 'command', name: recorta(limpio, 80), args: recorta((COMMAND_ARGS.exec(texto)?.[1] ?? '').trim(), MAX_COMMAND_ARGS), at }];
  }
  if (!texto.includes('<local-command-std')) return null;
  const salidas: string[] = [];
  let error = false;
  for (const m of texto.matchAll(LOCAL_OUTPUT)) {
    const t = stripAnsi(m[2] ?? '').trim();
    if (t === '' || t === '(no content)') continue;
    salidas.push(t);
    if (m[1] === 'stderr') error = true;
  }
  return salidas.length > 0 ? [{ type: 'command-output', text: recorta(salidas.join('\n'), MAX_OUTPUT), error, at }] : [];
}

/**
 * Las preguntas de un `AskUserQuestion`, con topes de longitud. null si la entrada no trae una lista de preguntas con
 * opciones, o si excede `QUESTION_LIMITS` en preguntas u opciones: entonces no se ofrece contestarla en el chat.
 */
export function leePreguntas(entrada: Record<string, unknown> | null): QuestionItem[] | null {
  const brutas = entrada?.questions;
  if (!Array.isArray(brutas) || brutas.length === 0 || brutas.length > QUESTION_LIMITS.questions) return null;
  const preguntas: QuestionItem[] = [];
  for (const b of brutas) {
    const q = objeto(b);
    const texto = cadena(q?.question);
    if (!q || texto === null || !Array.isArray(q.options) || q.options.length === 0 || q.options.length > QUESTION_LIMITS.options) return null;
    const opciones: QuestionItem['options'] = [];
    for (const ob of q.options) {
      const o = objeto(ob);
      const etiqueta = cadena(o?.label);
      if (!o || etiqueta === null) return null;
      opciones.push({ label: recorta(etiqueta, QUESTION_LIMITS.label), description: recorta(typeof o.description === 'string' ? o.description.trim() : '', QUESTION_LIMITS.description) });
    }
    preguntas.push({
      question: recorta(texto.trim(), QUESTION_LIMITS.question),
      header: recorta(typeof q.header === 'string' ? q.header.trim() : '', QUESTION_LIMITS.header),
      multiSelect: q.multiSelect === true,
      options: opciones,
    });
  }
  return preguntas;
}

/** `toolUseResult.answers` de la línea de un `tool_result` de `AskUserQuestion`; undefined si falta o no tiene la forma esperada. */
function leeRespuestas(resultado: unknown): Record<string, string> | undefined {
  const brutas = objeto(objeto(resultado)?.answers);
  if (!brutas) return undefined;
  const claves = Object.keys(brutas);
  if (claves.length === 0 || claves.length > QUESTION_LIMITS.questions) return undefined;
  const respuestas: Record<string, string> = {};
  for (const k of claves) {
    const v = brutas[k];
    if (typeof v !== 'string') return undefined;
    respuestas[recorta(k, QUESTION_LIMITS.question)] = recorta(v, QUESTION_LIMITS.answer);
  }
  return respuestas;
}

/**
 * Interpreta líneas completas de un transcript. Con `conversacion` es el de la
 * sesión principal: se emiten también los mensajes reales de la persona
 * (`user`) y no hay encargo (`task`). Sin ella es el de un subagente y `primero`
 * indica que el texto empieza en el byte 0: el encargo es el primer mensaje de
 * usuario con texto. Ignora el razonamiento (`thinking`), los tipos internos y
 * las líneas que no son JSON.
 */
export function parseAgentLines(texto: string, opciones: { primero: boolean; cwd: string | null; conversacion?: boolean }): AgentEvent[] {
  const eventos: AgentEvent[] = [];
  const conversacion = opciones.conversacion === true;
  const usos = new Map<string, Extract<AgentEvent, { type: 'usage' }>>();
  let hayEncargo = conversacion || !opciones.primero;
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
    // Lo que hace un subagente (isSidechain) no es parte de la conversación de la sesión.
    if (conversacion && o.isSidechain === true) continue;
    const mensaje = objeto(o.message);
    const contenido = mensaje?.content;
    const at = fechaDe(o.timestamp);
    if (o.type === 'system') {
      // Claude 2.1.319 escribe así algunos comandos locales (/rename, /resume, /fork, /login…) y su salida:
      // líneas `system/local_command` con el mismo contenido que las de tipo `user`.
      if (conversacion && o.subtype === 'local_command' && typeof o.content === 'string') eventos.push(...(eventosDeComando(o.content, at) ?? []));
      continue;
    }
    if (o.type === 'user') {
      // Mensaje de usuario que no escribió la persona: metadatos, resúmenes de compactación o eventos de otro origen.
      const origen = objeto(o.origin);
      const ajeno = o.isMeta === true || o.isCompactSummary === true || (origen !== null && origen.kind !== 'human');
      if (conversacion && o.isMeta !== true) {
        // Comandos y su salida local (los isMeta, con instrucciones internas, no se muestran).
        const t = textoDeUsuario(contenido);
        const deComando = t === null ? null : eventosDeComando(t, at);
        if (deComando !== null) {
          eventos.push(...deComando);
          continue;
        }
      }
      if (typeof contenido === 'string') {
        if (conversacion) {
          const t = ajeno ? null : textoDePersona(contenido);
          if (t !== null) eventos.push({ type: 'user', text: recorta(t, MAX_MESSAGE), at });
        } else if (!hayEncargo && contenido.trim() !== '') {
          hayEncargo = true;
          eventos.push({ type: 'task', text: recorta(contenido.trim(), MAX_TASK) });
        }
      } else if (Array.isArray(contenido)) {
        const partes: string[] = [];
        let imagenes = 0;
        for (const b of contenido) {
          const bloque = objeto(b);
          if (!bloque) continue;
          if (bloque.type === 'tool_result' && typeof bloque.tool_use_id === 'string') {
            const resultado = textoDeResultado(bloque.content);
            const respuestas = conversacion ? leeRespuestas(o.toolUseResult) : undefined;
            eventos.push({
              type: 'result',
              id: bloque.tool_use_id,
              error: bloque.is_error === true,
              summary: primeraLinea(resultado, MAX_SUMMARY),
              lines: resultado.split('\n').filter((l) => l.trim() !== '').length,
              at,
              ...(conversacion && resultado.trim() !== '' ? { output: recorta(resultado.trim(), MAX_OUTPUT) } : {}),
              ...(respuestas ? { answers: respuestas } : {}),
            });
          } else if (conversacion) {
            if (ajeno) continue;
            if (bloque.type === 'text' && typeof bloque.text === 'string') {
              const t = textoDePersona(bloque.text);
              if (t !== null) partes.push(t);
            } else if (bloque.type === 'image') {
              imagenes++;
            }
          } else if (!hayEncargo && bloque.type === 'text' && typeof bloque.text === 'string' && bloque.text.trim() !== '') {
            hayEncargo = true;
            eventos.push({ type: 'task', text: recorta(bloque.text.trim(), MAX_TASK) });
          }
        }
        // Una imagen sin texto sigue siendo un mensaje de la persona.
        if (conversacion && (partes.length > 0 || imagenes > 0)) {
          eventos.push({ type: 'user', text: recorta(partes.join('\n'), MAX_MESSAGE), at, ...(imagenes > 0 ? { images: imagenes } : {}) });
        }
      }
    } else if (o.type === 'assistant' && Array.isArray(contenido)) {
      // Tokens de salida del mensaje: los mensajes con varios bloques repiten `id` y `usage` en cada línea, así que dentro
      // de esta lectura solo se conserva el último evento de cada id (el cliente deduplica también entre lecturas).
      const idMensaje = mensaje?.id;
      const salida = objeto(mensaje?.usage)?.output_tokens;
      if (conversacion && typeof idMensaje === 'string' && typeof salida === 'number' && Number.isFinite(salida) && salida >= 0) {
        const previo = usos.get(idMensaje);
        if (previo) previo.output = salida;
        else {
          const evento: Extract<AgentEvent, { type: 'usage' }> = { type: 'usage', id: idMensaje, output: salida, at };
          usos.set(idMensaje, evento);
          eventos.push(evento);
        }
      }
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
          if (conversacion && nombre === 'AskUserQuestion') {
            // En la conversación, la pregunta es una tarjeta que se puede contestar, no una herramienta más.
            const preguntas = leePreguntas(entrada);
            if (preguntas) {
              eventos.push({ type: 'question', id: bloque.id, questions: preguntas, at });
              continue;
            }
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
            station: classifyTool(nombre, entrada ?? {}),
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

/** Cuánto del final del transcript se mira para saber qué espera Claude (la llamada pendiente es siempre de las últimas líneas). */
const PENDING_TAIL_BYTES = 2 * 1024 * 1024;

type QuestionEvent = Extract<AgentEvent, { type: 'question' }>;
type ToolEvent = Extract<AgentEvent, { type: 'tool' }>;

/**
 * Pregunta y herramientas lanzadas por Claude que aún no tienen resultado en el transcript, y los ids que sí lo tienen
 * (`resolved`: sirve para saber que algo que anunció un hook ya se contestó aunque su `tool_use` no se haya leído).
 */
export type PendingWork = { question: QuestionEvent | null; tools: ToolEvent[]; resolved: ReadonlySet<string> };

/** De una lista de eventos de la conversación, lo que no tiene `result`: la última pregunta y las herramientas, en orden. */
export function pendingWork(eventos: readonly AgentEvent[]): PendingWork {
  const resueltos = new Set<string>();
  for (const e of eventos) if (e.type === 'result') resueltos.add(e.id);
  const pendientes = eventos.filter((e): e is QuestionEvent | ToolEvent => (e.type === 'question' || e.type === 'tool') && !resueltos.has(e.id));
  const preguntas = pendientes.filter((e): e is QuestionEvent => e.type === 'question');
  return { question: preguntas[preguntas.length - 1] ?? null, tools: pendientes.filter((e): e is ToolEvent => e.type === 'tool'), resolved: resueltos };
}

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

  /**
   * Conversación principal de la sesión: eventos nuevos desde el byte `from` (0 en la primera
   * petición) de su transcript. Mientras `more` sea true quedan trozos por pedir.
   */
  async conversation(ctx: FollowContext, from: number): Promise<ConversationResponse> {
    if (this.uid === null || !SESSION_FILE.test(ctx.sessionId)) throw noHayDatos('no se pueden leer archivos de Claude en este sistema.');
    const real = await this.transcript(ctx, true);
    // Claude anuncia el transcript antes de crearlo: respuesta vacía válida hasta que aparezca.
    if (real === null) return { sessionId: ctx.sessionId, from: 0, size: 0, reset: from > 0, more: false, events: [] };
    const abierto = await abrirDelUsuario(real, this.uid);
    if (!abierto) throw noHayDatos('el transcript de la sesión no existe o no es un archivo de Claude.');
    try {
      const reset = from > abierto.size;
      const desde = reset ? 0 : from;
      const v = await leerLineas(abierto.fh, desde, abierto.size);
      return {
        sessionId: ctx.sessionId,
        from: v.next,
        size: abierto.size,
        reset,
        more: v.more,
        events: parseAgentLines(v.texto, { primero: desde === 0, cwd: ctx.cwd || null, conversacion: true }),
      };
    } finally {
      await abierto.fh.close().catch(() => {});
    }
  }

  /**
   * Lo que Claude tiene pendiente de la persona según el final del transcript (los últimos `PENDING_TAIL_BYTES`): la última
   * pregunta (`AskUserQuestion`) y las herramientas lanzadas, ambas sin resultado todavía. Sin transcript, o sin nada
   * pendiente, es `{ question: null, tools: [], resolved: ∅ }`.
   */
  async pending(ctx: FollowContext): Promise<PendingWork> {
    if (this.uid === null || !SESSION_FILE.test(ctx.sessionId)) throw noHayDatos('no se pueden leer archivos de Claude en este sistema.');
    const real = await this.transcript(ctx, true);
    if (real === null) return { question: null, tools: [], resolved: new Set() };
    const abierto = await abrirDelUsuario(real, this.uid);
    if (!abierto) throw noHayDatos('el transcript de la sesión no existe o no es un archivo de Claude.');
    try {
      const desde = Math.max(0, abierto.size - PENDING_TAIL_BYTES);
      let buf = await leer(abierto.fh, desde, abierto.size - desde);
      // Solo líneas completas: se descarta la primera si el trozo empieza a mitad, y una última sin terminar.
      if (desde > 0) {
        const nl = buf.indexOf(0x0a);
        buf = nl >= 0 ? buf.subarray(nl + 1) : Buffer.alloc(0);
      }
      const ultimo = buf.lastIndexOf(0x0a);
      buf = ultimo >= 0 ? buf.subarray(0, ultimo + 1) : Buffer.alloc(0);
      return pendingWork(parseAgentLines(buf.toString('utf8'), { primero: false, cwd: ctx.cwd || null, conversacion: true }));
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

  /**
   * Ruta real del transcript. Con `ausenteOk`, null si aún no existe pero su ruta es válida (ver
   * `pendienteValido`); en otro caso, o sin `ausenteOk`, un transcript que no existe es un error.
   */
  private async transcript(ctx: FollowContext, ausenteOk: true): Promise<string | null>;
  private async transcript(ctx: FollowContext): Promise<string>;
  private async transcript(ctx: FollowContext, ausenteOk = false): Promise<string | null> {
    if (ctx.transcriptPath === '') throw noHayDatos('la sesión aún no tiene transcript.');
    let real: string | null;
    try {
      real = await resolveTranscript(ctx.transcriptPath, this.projectsDir);
    } catch {
      throw noHayDatos('el transcript de la sesión queda fuera del directorio de proyectos de Claude.');
    }
    if (real === null) {
      if (ausenteOk && (await this.pendienteValido(ctx.transcriptPath))) return null;
      throw noHayDatos('el transcript de la sesión no existe.');
    }
    return real;
  }

  /**
   * Si `ruta` es la de un transcript que Claude aún no ha creado: acaba en `.jsonl`, no existe (ni como
   * enlace roto) y, por mucho que falte, el primer directorio existente que la contiene, ya resuelto,
   * es el de proyectos de Claude o cuelga de él. Así una ruta que sale de él (por `..` o enlaces) sigue
   * rechazada, y solo se sirve «todavía no hay nada», nunca un archivo.
   */
  private async pendienteValido(ruta: string): Promise<boolean> {
    if (!isAbsolute(ruta) || !ruta.endsWith('.jsonl')) return false;
    try {
      await lstat(ruta);
      return false; // Existe (o es un enlace roto): no es «todavía no».
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return false;
    }
    let base: string;
    try {
      base = await realpath(this.projectsDir);
    } catch {
      return false;
    }
    let carpeta = dirname(resolve(ruta));
    for (;;) {
      try {
        const real = await realpath(carpeta);
        return real === base || real.startsWith(base + sep);
      } catch {
        const arriba = dirname(carpeta);
        if (arriba === carpeta) return false;
        carpeta = arriba;
      }
    }
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

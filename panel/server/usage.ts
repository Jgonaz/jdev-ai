// Datos de uso y actividad de las sesiones de Claude del panel. Los dejan dos
// scripts del harness en ${XDG_STATE_HOME:-~/.local/state}/jdev-ai/:
//
//   statusline/<session_id>.json   el JSON que Claude pasa a su statusline,
//                                  tal cual (bin/session-statusline).
//   activity/<session_id>.jsonl    un evento de hook por línea, con «jdev_at»
//                                  (bin/session-activity).
//
// Ninguno de los dos formatos es nuestro: cada campo se lee de forma opcional y
// lo que falte o no tenga el tipo esperado se omite.

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { FOLLOW_ID } from '../shared/follow.ts';

/** Tamaño máximo que se lee de una statusline (el script no guarda más de 64 KiB). */
export const STATUSLINE_MAX_BYTES = 64 * 1024;
/** Tamaño máximo que se lee de un registro de actividad (el script lo vacía al pasar de 256 KiB). */
export const ACTIVITY_MAX_BYTES = 512 * 1024;

/** Nombre de archivo válido: un session_id (solo letras, números y guiones) y la extensión. */
export function isStateFileName(nombre: string, ext: string): boolean {
  return nombre.endsWith(ext) && /^[A-Za-z0-9-]+$/.test(nombre.slice(0, -ext.length));
}

/**
 * Lee un archivo del directorio de estado sin seguir enlaces simbólicos ni salir
 * del directorio: el nombre debe ser `<session_id><ext>`, se abre con O_NOFOLLOW
 * y debe ser un archivo regular de `maxBytes` como mucho. Devuelve null si algo
 * de eso falla (también si el archivo desaparece mientras se lee).
 */
export async function readStateFile(
  dir: string,
  nombre: string,
  ext: string,
  maxBytes: number,
): Promise<{ texto: string; mtimeMs: number; size: number } | null> {
  if (!isStateFileName(nombre, ext)) return null;
  let fh;
  try {
    // O_NONBLOCK: abrir una tubería con este nombre no debe bloquear el servidor.
    fh = await open(join(dir, nombre), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = await fh.stat();
    if (!st.isFile() || st.size > maxBytes) return null;
    const texto = await fh.readFile({ encoding: 'utf8' });
    return { texto, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- Statusline

export type ContextUsage = {
  /** Tokens de entrada de la última llamada (null si no se conocen). */
  used: number | null;
  /** Tamaño de la ventana de contexto en tokens. */
  size: number | null;
  /** Porcentaje usado, de 0 a 100 (null hasta el primer mensaje). */
  percent: number | null;
};

export type SessionUsage = {
  /** Nombre del modelo (display_name, o su id). */
  model: string | null;
  /** low, medium, high, xhigh o max, si la sesión lo informa. */
  effort: string | null;
  context: ContextUsage | null;
  /** Worktree en el que trabaja la sesión según Claude (puede ser uno que ella misma creó). */
  worktree: { name: string; branch: string | null } | null;
  /** Milisegundos desde la época de la última escritura de la statusline. */
  updatedAt: number;
};

/** Límite de uso de una ventana de la cuenta. */
export type RateLimit = {
  percent: number;
  /** Milisegundos desde la época a los que se reinicia (null si no se conoce). */
  resetsAt: number | null;
};

export type Statusline = {
  sessionId: string;
  usage: SessionUsage;
  limits: { fiveHour: RateLimit | null; sevenDay: RateLimit | null };
};

/** Límites de la cuenta según la statusline más reciente de una sesión del panel. */
export type Account = {
  fiveHour: RateLimit | null;
  sevenDay: RateLimit | null;
  updatedAt: number;
};

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function texto(valor: unknown, max = 100): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim().slice(0, max) : null;
}

function porcentaje(valor: unknown): number | null {
  const n = numero(valor);
  return n === null ? null : Math.min(100, Math.max(0, n));
}

function tokens(valor: unknown): number | null {
  const n = numero(valor);
  return n === null || n < 0 ? null : Math.round(n);
}

function contexto(valor: unknown): ContextUsage | null {
  const c = objeto(valor);
  if (!c) return null;
  const size = tokens(c.context_window_size);
  const actual = objeto(c.current_usage);
  let used: number | null = null;
  if (actual) {
    // Como cuenta Claude el porcentaje: entrada y caché, sin los tokens de salida.
    const partes = [actual.input_tokens, actual.cache_creation_input_tokens, actual.cache_read_input_tokens].map(tokens);
    if (partes.some((p) => p !== null)) used = partes.reduce<number>((suma, p) => suma + (p ?? 0), 0);
  }
  let percent = porcentaje(c.used_percentage);
  if (percent === null && used !== null && size) percent = Math.min(100, (used / size) * 100);
  if (used === null && percent !== null && size) used = Math.round((size * percent) / 100);
  if (size === null && used === null && percent === null) return null;
  return { used, size, percent };
}

function limite(valor: unknown): RateLimit | null {
  const l = objeto(valor);
  if (!l) return null;
  const percent = porcentaje(l.used_percentage);
  if (percent === null) return null;
  const reinicio = numero(l.resets_at);
  // Claude lo da en segundos desde la época; si ya viniera en milisegundos se respeta.
  const resetsAt = reinicio === null || reinicio <= 0 ? null : reinicio < 1e11 ? reinicio * 1000 : reinicio;
  return { percent, resetsAt };
}

/**
 * Interpreta el JSON de la statusline de Claude Code. `mtimeMs` es cuándo se
 * escribió el archivo. Devuelve null si no es un objeto JSON con `session_id`.
 */
export function parseStatusline(contenido: string, mtimeMs: number): Statusline | null {
  let obj: unknown;
  try {
    obj = JSON.parse(contenido);
  } catch {
    return null;
  }
  const o = objeto(obj);
  const sessionId = texto(o?.session_id, 200);
  if (!o || sessionId === null) return null;

  const modelo = objeto(o.model);
  const esfuerzo = texto(objeto(o.effort)?.level, 16);
  const arbol = objeto(o.worktree);
  const nombreArbol = texto(arbol?.name, 200);
  const enlazado = texto(objeto(o.workspace)?.git_worktree, 200);
  const worktree = nombreArbol
    ? { name: nombreArbol, branch: texto(arbol?.branch, 200) }
    : enlazado
      ? { name: enlazado, branch: null }
      : null;
  const limites = objeto(o.rate_limits);

  return {
    sessionId,
    usage: {
      model: texto(modelo?.display_name) ?? texto(modelo?.id),
      effort: esfuerzo,
      context: contexto(o.context_window),
      worktree,
      updatedAt: mtimeMs,
    },
    limits: { fiveHour: limite(limites?.five_hour), sevenDay: limite(limites?.seven_day) },
  };
}

/**
 * Límites de la cuenta: los de la statusline más reciente que los informe, entre
 * las sesiones dadas. Null si ninguna los trae.
 */
export function accountFrom(statuslines: Iterable<Statusline>): Account | null {
  let mejor: Statusline | null = null;
  for (const s of statuslines) {
    if (!s.limits.fiveHour && !s.limits.sevenDay) continue;
    if (!mejor || s.usage.updatedAt > mejor.usage.updatedAt) mejor = s;
  }
  return mejor ? { ...mejor.limits, updatedAt: mejor.usage.updatedAt } : null;
}

// ----------------------------------------------------------------- Actividad

/** Tipos de tarea en segundo plano que cuentan como «shell» (el nombre legible o el interno). */
const TIPOS_SHELL = new Set(['shell', 'monitor', 'local_bash']);
const ESTADOS_EN_MARCHA = new Set(['running', 'pending']);

const MAX_SUBAGENTES = 50;
const MAX_SHELLS = 50;
const MAX_ARTIFACTS = 20;

// Solo los dos formatos de enlace de Claude; nada que lo preceda ni lo siga puede formar parte de otro host o ruta.
const ARTIFACT_URL = /(?<![\w.@/-])https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+(?![\w-])/g;

/** Enlace de artifact de claude.ai en los dos formatos conocidos. */
export function isArtifactUrl(url: string): boolean {
  return /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+$/.test(url);
}

export type ActivityEvent =
  | { kind: 'subagent-start'; at: number | null; id: string; type: string }
  | { kind: 'subagent-stop'; at: number | null; id: string }
  | { kind: 'stop'; at: number | null; shells: ShellTask[] }
  | { kind: 'artifact'; at: number | null; urls: string[]; title: string | null };

export type ActiveSubagent = { id: string; type: string; since: number | null };
/** Tarea en segundo plano en marcha: su texto y, si Claude lo da con un formato válido, su id. */
export type ShellTask = { id: string | null; label: string };
export type SessionActivity = {
  subagents: ActiveSubagent[];
  /** Descripción (o comando) de las shells y monitores en marcha en el último Stop, con su id para seguirlas. */
  shells: { label: string; id?: string }[];
  artifacts: { url: string; title: string | null }[];
};

function tareaEnMarcha(valor: unknown): ShellTask | null {
  const t = objeto(valor);
  if (!t) return null;
  const tipo = typeof t.type === 'string' ? t.type.toLowerCase() : '';
  const estado = typeof t.status === 'string' ? t.status.toLowerCase() : '';
  if (!(TIPOS_SHELL.has(tipo) || tipo.startsWith('monitor_')) || !ESTADOS_EN_MARCHA.has(estado)) return null;
  const servidor = texto(t.server, 100);
  const herramienta = texto(t.tool, 100);
  const monitor = servidor && herramienta ? `${servidor}/${herramienta}` : null;
  const label = texto(t.command, 300) ?? texto(t.description, 300) ?? monitor ?? texto(t.id, 100) ?? tipo;
  return { id: typeof t.id === 'string' && FOLLOW_ID.test(t.id) ? t.id : null, label };
}

function urlsDe(valor: unknown): string[] {
  let cadena: string;
  try {
    cadena = typeof valor === 'string' ? valor : (JSON.stringify(valor) ?? '');
  } catch {
    return [];
  }
  return [...new Set(cadena.match(ARTIFACT_URL) ?? [])];
}

/** Interpreta un registro de actividad: ignora las líneas que no son JSON o no son un evento conocido. */
export function parseActivityLog(contenido: string): ActivityEvent[] {
  const eventos: ActivityEvent[] = [];
  for (const linea of contenido.split('\n')) {
    if (linea.trim() === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(linea);
    } catch {
      continue;
    }
    const o = objeto(obj);
    if (!o) continue;
    const fecha = typeof o.jdev_at === 'string' ? Date.parse(o.jdev_at) : NaN;
    const at = Number.isNaN(fecha) ? null : fecha;
    const evento = o.hook_event_name;
    const agente = texto(o.agent_id, 200);
    if (evento === 'SubagentStart' && agente) {
      eventos.push({ kind: 'subagent-start', at, id: agente, type: texto(o.agent_type, 60) ?? 'subagente' });
    } else if (evento === 'SubagentStop' && agente) {
      eventos.push({ kind: 'subagent-stop', at, id: agente });
    } else if (evento === 'Stop') {
      const tareas = Array.isArray(o.background_tasks) ? o.background_tasks : [];
      eventos.push({ kind: 'stop', at, shells: tareas.map(tareaEnMarcha).filter((t): t is ShellTask => t !== null) });
    } else if (evento === 'PostToolUse' && o.tool_name === 'Artifact') {
      const entrada = objeto(o.tool_input);
      let urls = urlsDe(o.tool_response);
      if (urls.length === 0) urls = urlsDe(entrada?.url);
      if (urls.length > 0) eventos.push({ kind: 'artifact', at, urls, title: texto(entrada?.title, 200) });
    }
  }
  return eventos;
}

/**
 * Estado de la actividad tras los eventos, en orden. Los anteriores a
 * `notBefore` (milisegundos; p. ej. un SessionStart posterior) se ignoran.
 * Devuelve null si no hay nada que mostrar.
 */
export function deriveActivity(eventos: readonly ActivityEvent[], notBefore = 0): SessionActivity | null {
  const subagentes = new Map<string, ActiveSubagent>();
  let shells: ShellTask[] = [];
  const artifacts = new Map<string, string | null>();
  for (const e of eventos) {
    if (e.at !== null && e.at < notBefore) continue;
    if (e.kind === 'subagent-start') {
      if (!subagentes.has(e.id)) subagentes.set(e.id, { id: e.id, type: e.type, since: e.at });
    } else if (e.kind === 'subagent-stop') {
      subagentes.delete(e.id);
    } else if (e.kind === 'stop') {
      shells = e.shells;
    } else {
      // El título es del primer enlace de la respuesta, que es el que se publicó.
      e.urls.forEach((url, i) => {
        const previo = artifacts.get(url);
        artifacts.set(url, (i === 0 ? e.title : null) ?? previo ?? null);
      });
    }
  }
  const resultado: SessionActivity = {
    subagents: [...subagentes.values()].slice(0, MAX_SUBAGENTES),
    shells: shells.slice(0, MAX_SHELLS).map((t) => (t.id === null ? { label: t.label } : { label: t.label, id: t.id })),
    artifacts: [...artifacts].slice(-MAX_ARTIFACTS).map(([url, title]) => ({ url, title })),
  };
  return resultado.subagents.length + resultado.shells.length + resultado.artifacts.length === 0 ? null : resultado;
}

/**
 * Qué subagentes y shells de una sesión se pueden seguir: los que aparecen en su
 * registro de actividad (con los mismos eventos ignorados que `deriveActivity`),
 * también los que ya terminaron. El panel solo abre archivos de ids que salgan de
 * aquí. Las shells solo se conocen por los Stop; `running` es lo que decía el último.
 */
export type FollowTargets = {
  subagents: Map<string, { type: string; since: number | null; stopped: boolean }>;
  shells: Map<string, { label: string; running: boolean }>;
};

export function followTargets(eventos: readonly ActivityEvent[], notBefore = 0): FollowTargets {
  const subagents: FollowTargets['subagents'] = new Map();
  const shells: FollowTargets['shells'] = new Map();
  let enMarcha = new Set<string>();
  for (const e of eventos) {
    if (e.at !== null && e.at < notBefore) continue;
    if (e.kind === 'subagent-start') {
      if (!subagents.has(e.id)) subagents.set(e.id, { type: e.type, since: e.at, stopped: false });
    } else if (e.kind === 'subagent-stop') {
      const s = subagents.get(e.id);
      if (s) s.stopped = true;
    } else if (e.kind === 'stop') {
      enMarcha = new Set();
      for (const t of e.shells) {
        if (t.id === null) continue;
        shells.set(t.id, { label: t.label, running: true });
        enMarcha.add(t.id);
      }
      for (const [id, s] of shells) s.running = enMarcha.has(id);
    }
  }
  return { subagents, shells };
}

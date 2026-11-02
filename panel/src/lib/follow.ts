// Lógica pura de las pestañas de seguimiento de subagentes y shells en segundo
// plano: la clave de la pestaña, la fusión de lo que llega por el sondeo, el
// texto de la salida de una shell y las etiquetas de estado.

import type { AgentEvent, FollowKind, FollowResponse, FollowState } from '../../shared/follow.ts';
import { formatClock } from './statusline.ts';

export type { AgentEvent, FollowKind, FollowResponse, FollowState };

/** Máximo de eventos (subagente) o de líneas (shell) que conserva el cliente. */
export const FOLLOW_MAX_ITEMS = 2000;

// ---------------------------------------------------------------------- Clave

const KEY = /^follow:(jdev-[a-z0-9_-]+-[0-9]+):(agent|shell):([a-z0-9]{1,64})$/;

/** Clave de una pestaña de seguimiento en el espacio de trabajo: `follow:<sesión>:<tipo>:<id>`. */
export function followKey(session: string, kind: FollowKind, id: string): string {
  return `follow:${session}:${kind}:${id}`;
}

export type FollowTarget = { session: string; kind: FollowKind; id: string };

export function parseFollowKey(clave: string): FollowTarget | null {
  const m = KEY.exec(clave);
  return m ? { session: m[1]!, kind: m[2] as FollowKind, id: m[3]! } : null;
}

export function isFollowKey(clave: string): boolean {
  return clave.startsWith('follow:');
}

/** La sesión de tmux a la que pertenece una pestaña: ella misma, o la que lanzó lo que se sigue. */
export function ownerSession(clave: string | null): string | null {
  if (clave === null) return null;
  return parseFollowKey(clave)?.session ?? (isFollowKey(clave) ? null : clave);
}

// ---------------------------------------------------------------------- Subagente

export type AgentStep =
  | {
      kind: 'tool';
      id: string;
      tool: string;
      verb: string;
      target: string;
      detail?: string;
      at: number | null;
      result?: { error: boolean; summary: string; lines: number };
    }
  | { kind: 'message'; text: string; at: number | null };

export type AgentTrack = {
  task: string | null;
  steps: AgentStep[];
  /** Herramientas usadas en total, también las que ya salieron de `steps` por el límite. */
  toolCount: number;
};

export const EMPTY_AGENT: AgentTrack = { task: null, steps: [], toolCount: 0 };

/** Suma los eventos nuevos; con `reset` empieza de cero. Los resultados se asocian a su herramienta por id. */
export function applyAgentEvents(previo: AgentTrack, eventos: readonly AgentEvent[], reset = false): AgentTrack {
  let { task, toolCount } = reset ? EMPTY_AGENT : previo;
  const steps = reset ? [] : previo.steps.slice();
  const indice = new Map<string, number>();
  const reindexa = () => {
    indice.clear();
    steps.forEach((s, i) => s.kind === 'tool' && indice.set(s.id, i));
  };
  reindexa();
  for (const e of eventos) {
    if (e.type === 'task') {
      task = e.text;
    } else if (e.type === 'tool') {
      toolCount++;
      steps.push({ kind: 'tool', id: e.id, tool: e.tool, verb: e.verb, target: e.target, detail: e.detail, at: e.at });
      indice.set(e.id, steps.length - 1);
    } else if (e.type === 'result') {
      const i = indice.get(e.id);
      const paso = i === undefined ? undefined : steps[i];
      if (paso?.kind === 'tool') steps[i!] = { ...paso, result: { error: e.error, summary: e.summary, lines: e.lines } };
    } else {
      steps.push({ kind: 'message', text: e.text, at: e.at });
    }
    if (steps.length > FOLLOW_MAX_ITEMS) {
      steps.splice(0, steps.length - FOLLOW_MAX_ITEMS);
      reindexa();
    }
  }
  return { task, steps, toolCount };
}

/**
 * Nota de un resultado correcto, como en el diseño («· 142 líneas»); null si no hay nada que decir.
 * Read cuenta líneas y Grep y Glob, coincidencias; Edit, Write y MultiEdit no dicen nada (ya llevan sus +/−); el resto
 * muestra la primera línea de la salida.
 */
export function resultNote(tool: string, r: { error: boolean; summary: string; lines: number }): { inline: string | null; below: string | null } {
  if (r.error) return { inline: 'falló', below: r.summary || null };
  switch (tool) {
    case 'Read':
      return { inline: r.lines > 0 ? `${r.lines} ${r.lines === 1 ? 'línea' : 'líneas'}` : null, below: null };
    case 'Grep':
    case 'Glob': {
      if (r.lines === 0 || /^no (files|matches)/i.test(r.summary)) return { inline: 'sin coincidencias', below: null };
      return { inline: `${r.lines} ${r.lines === 1 ? 'coincidencia' : 'coincidencias'}`, below: null };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return { inline: null, below: null };
    default:
      return { inline: null, below: r.summary || null };
  }
}

/** El mensaje que se destaca como resultado final: el último, solo si el subagente ya terminó. */
export function finalMessage(steps: readonly AgentStep[], estado: FollowState | null): number {
  if (estado !== 'finished') return -1;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.kind === 'message') return i;
  return -1;
}

// ---------------------------------------------------------------------- Shell

// Secuencias de escape que no se pintan, de más a menos específica:
//  - CSI (colores, cursor): ESC [ … final
//  - OSC (títulos, enlaces): ESC ] … BEL o ESC \
//  - cadenas DCS, SOS, PM y APC: ESC P/X/^/_ … ESC \
//  - designación de juego de caracteres y similares (ESC ( B de tput sgr0, ESC # 8, ESC % G): ESC, intermedios, final
//  - el resto de las de dos bytes (ESC 7, ESC 8, ESC =, ESC >, ESC M, ESC c, ESC D…)
const ANSI =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[PX^_][^\u001b]*(?:\u001b\\)?|\u001b[ -/]+[0-~]|\u001b[0-~]/g;
// Controles que no se pintan (se conservan el salto de línea y el tabulador).
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Texto plano de una línea de terminal: sin secuencias ANSI y con el último «\r» ganando (barras de progreso). */
export function plainLine(linea: string): string {
  const visible = linea.replace(/\r+$/, '');
  const tras = visible.includes('\r') ? visible.slice(visible.lastIndexOf('\r') + 1) : visible;
  return tras.replace(ANSI, '').replace(CONTROL, '');
}

/** Recorta un texto a sus últimas `max` líneas. */
export function lastLines(texto: string, max = FOLLOW_MAX_ITEMS): string {
  const lineas = texto.split('\n');
  const utiles = lineas[lineas.length - 1] === '' ? lineas.length - 1 : lineas.length;
  return utiles <= max ? texto : lineas.slice(utiles - max).join('\n');
}

/** Suma la salida nueva; con `reset` empieza de cero. Conserva como mucho 2 000 líneas. */
export function applyShellText(previo: string, nuevo: string, reset = false): string {
  return lastLines((reset ? '' : previo) + nuevo);
}

/** Líneas a pintar de la salida bruta de una shell. */
export function shellLines(bruto: string): string[] {
  if (bruto === '') return [];
  const lineas = bruto.split('\n');
  if (lineas[lineas.length - 1] === '') lineas.pop();
  return lineas.map(plainLine);
}

// ---------------------------------------------------------------------- Etiquetas

function duracion(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Texto de la píldora de estado de la cabecera. */
export function statusLabel(
  kind: FollowKind,
  estado: FollowState | null,
  meta: { startedAt: number | null; updatedAt: number | null } | null,
  ahora: number,
  sinDatos = false,
): string {
  if (estado === null) return sinDatos ? 'Sin datos' : 'Cargando…';
  if (estado === 'finished') return meta?.updatedAt ? `Terminado · ${formatClock(meta.updatedAt)}` : 'Terminado';
  if (kind === 'agent') return meta?.startedAt ? `Trabajando · ${duracion(ahora - meta.startedAt)}` : 'Trabajando';
  return meta?.startedAt ? `En marcha · desde las ${formatClock(meta.startedAt)}` : 'En marcha';
}

/** «Actualizado hace 2 s» desde la última respuesta correcta. */
export function agoLabel(ultima: number | null, ahora: number): string {
  if (ultima === null) return '';
  const s = Math.max(0, Math.round((ahora - ultima) / 1000));
  if (s < 60) return `Actualizado hace ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `Actualizado hace ${m} min` : `Actualizado hace ${Math.floor(m / 60)} h`;
}

/** Cada cuánto preguntar: enseguida si queda más por leer, cada 1 s mientras sigue en marcha y cada 10 s si ya terminó. */
export function pollDelay(estado: FollowState | null, more: boolean): number {
  if (more) return 0;
  return estado === 'running' ? 1000 : 10_000;
}

/** Espera tras `n` fallos seguidos (también el 404 de «no hay datos»): 10 s, 30 s y, desde el tercero, 60 s. */
export function errorDelay(n: number): number {
  return [10_000, 30_000, 60_000][Math.min(Math.max(n, 1), 3) - 1]!;
}

/** El servidor empieza sus mensajes de «sin datos» por esto; la vista ya lo dice en su título. */
export function noDataReason(mensaje: string): string {
  const resto = mensaje.replace(/^No hay datos que mostrar:?\s*/i, '').trim();
  return resto === '' ? '' : resto.charAt(0).toUpperCase() + resto.slice(1);
}

/** Los mensajes de un subagente que no son el resultado final se recortan a 4 000 caracteres. */
export const MESSAGE_CLIP = 4000;
export function clipMessage(texto: string): string {
  return texto.length > MESSAGE_CLIP ? `${texto.slice(0, MESSAGE_CLIP - 1)}…` : texto;
}

// ---------------------------------------------------------------------- Seguir al final

/** ¿Está el scroll prácticamente al final? */
export function atBottom(el: { scrollTop: number; clientHeight: number; scrollHeight: number }, tolerancia = 4): boolean {
  return el.scrollHeight - el.clientHeight - el.scrollTop <= tolerancia;
}

/**
 * «Seguir al final» tras un evento de scroll: llegar abajo lo reactiva y cualquier
 * otra posición lo suelta (arrastre de la barra, táctil, scrollTo, teclado, rueda),
 * salvo el desplazamiento que hace la propia vista al seguir el final.
 */
export function followAfterScroll(actual: boolean, alFinal: boolean, programatico: boolean): boolean {
  if (alFinal) return true;
  return programatico ? actual : false;
}

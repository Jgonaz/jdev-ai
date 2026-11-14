// Estado del mapa de actividad de una sesión, derivado de los eventos de su conversación. Función pura y sin DOM:
// el dibujo y los pulsos (que se calculan al comparar eventos nuevos con los ya vistos) viven en la interfaz.
//
// Adaptado de la lógica de `hooks/feed.ts` (`foldRows`) y `hooks/draw.ts` (`routeOf`) de lot-map
// (https://github.com/alexeyw/lot-map, MIT, © 2026 Aleksei Volodin; su aviso completo va en
// `shared/stations.ts`).

import type { AgentEvent } from '../../shared/follow.ts';
import { STATIONS, classifyTool } from '../../shared/stations.ts';
import type { Station } from '../../shared/stations.ts';

export type { Station };

/** Una parada de la ruta se ve íntegra hasta aquí desde su hora… */
export const ROUTE_VISIBLE_MS = 40_000;
/** …y se desvanece durante esto. */
export const ROUTE_FADE_MS = 20_000;
/** Paradas que conserva la ruta. */
export const ROUTE_STOPS = 5;
/** Filas de actividad que se muestran. */
export const BOARD_ROWS = 16;

/** Eventos ligeros que guarda cada sesión para el mapa; con más, se descartan los más antiguos. */
export const MAP_MAX_EVENTS = 20_000;

/**
 * El evento reducido a lo que usa `buildBoard`, o null si el mapa no lo necesita. Quita los textos de los mensajes, las
 * salidas y los resúmenes de los resultados, el detalle de las herramientas y los argumentos de los comandos: el mapa
 * solo cuenta y nombra, y una conversación larga no debe duplicarse en memoria.
 */
export function lightMapEvent(e: AgentEvent): AgentEvent | null {
  switch (e.type) {
    case 'tool':
      return { type: 'tool', id: e.id, tool: e.tool, verb: e.verb, target: e.target, at: e.at, ...(e.station !== undefined ? { station: e.station } : {}) };
    case 'question':
      // En la conversación, `AskUserQuestion` llega como `question` (no como `tool`): el mapa la sigue contando en la estación «Tú», con su resultado para el fin.
      return { type: 'tool', id: e.id, tool: 'AskUserQuestion', verb: 'AskUserQuestion', target: '', at: e.at, station: 'tu' };
    case 'result':
      return { type: 'result', id: e.id, error: e.error, summary: '', lines: 0, at: e.at ?? null };
    case 'message':
      return { type: 'message', text: '', at: e.at };
    case 'user':
      return { type: 'user', text: '', at: e.at };
    case 'command':
      return { type: 'command', name: e.name, args: '', at: e.at };
    default:
      return null;
  }
}

/** Una llamada que aún no ha devuelto resultado. */
export type RunningCall = {
  id: string;
  tool: string;
  target: string;
  /** Hora de la llamada; null si el transcript no la traía. */
  since: number | null;
  /** `now - since` en ms (nunca negativo); null si no se conoce `since`. */
  elapsedMs: number | null;
};

export type StationState = {
  id: Station;
  /** Usos totales de la sesión: herramientas de la estación; mensajes del agente en Modelo; mensajes y comandos de la persona en Tú. */
  uses: number;
  /** Llamadas en marcha, de la más antigua a la más reciente. */
  running: RunningCall[];
  /** Errores desde el último mensaje de la persona. */
  errors: number;
  /** Hora del último uso o de la última llamada terminada (para «recién usada»); null si nunca o sin hora. */
  lastAt: number | null;
};

/** Una parada de la ruta: la hora es la de la última visita consecutiva a esa estación. */
export type RouteStop = { station: Station; at: number | null };

export type RowStatus = 'running' | 'done' | 'failed';

/**
 * Una fila de actividad. Si agrupa varias llamadas terminadas y consecutivas de una misma estación (`veces` > 1),
 * muestra la más reciente y `durationMs` es la suma de las duraciones conocidas.
 */
export type BoardRow = {
  /** Id de la llamada (en una fila agrupada, el de la más reciente). */
  id: string;
  status: RowStatus;
  station: Station;
  tool: string;
  target: string;
  /** En marcha: lo que lleva; terminada: lo que tardó. null si faltan las horas. */
  durationMs: number | null;
  veces: number;
};

/** Lo que hace la sesión ahora. */
export type BoardNow =
  /** La llamada en marcha más reciente; `others` es cuántas más hay en marcha. */
  | { kind: 'running'; station: Station; tool: string; target: string; elapsedMs: number | null; others: number }
  /** El agente ha contestado: `turnMs` es lo que tardó el turno desde el último mensaje de la persona (null si se desconoce). */
  | { kind: 'ready'; turnMs: number | null }
  | { kind: 'waiting' };

export type Board = {
  stations: Record<Station, StationState>;
  /** Últimas paradas, de la más antigua a la más reciente. Sin filtrar por hora: el dibujo aplica `ROUTE_VISIBLE_MS` y `ROUTE_FADE_MS`. */
  route: RouteStop[];
  /** Las últimas filas, de la más reciente a la más antigua. */
  rows: BoardRow[];
  now: BoardNow;
};

type Tool = Extract<AgentEvent, { type: 'tool' }>;

type Call = {
  id: string;
  station: Station;
  tool: string;
  target: string;
  startedAt: number | null;
  endedAt: number | null;
  status: RowStatus;
};

/** La estación del evento; los transcripts antiguos no la traen y se clasifica por el nombre (o cae en Shell). */
export function stationOf(e: Tool): Station {
  return e.station !== undefined && (STATIONS as readonly string[]).includes(e.station) ? e.station : classifyTool(e.tool, {});
}

const latest = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
const span = (from: number | null, to: number | null): number | null => (from === null || to === null ? null : Math.max(0, to - from));

/** Las filas, de la más reciente a la más antigua. Las terminadas y consecutivas de una misma estación se agrupan en una. */
function foldRows(calls: readonly Call[], now: number, max: number): BoardRow[] {
  const rows: BoardRow[] = [];
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!;
    const duration = c.status === 'running' ? span(c.startedAt, now) : span(c.startedAt, c.endedAt);
    const last = rows[rows.length - 1];
    if (last !== undefined && c.status === 'done' && last.status === 'done' && last.station === c.station) {
      last.veces++;
      last.durationMs = duration === null ? last.durationMs : (last.durationMs ?? 0) + duration;
      continue;
    }
    if (rows.length === max) break;
    rows.push({ id: c.id, status: c.status, station: c.station, tool: c.tool, target: c.target, durationMs: duration, veces: 1 });
  }
  return rows;
}

/**
 * El estado del mapa a las `now` (ms desde la época), a partir de los eventos de la conversación en orden.
 * Un evento sin hora cuenta igual, pero no aporta duraciones ni horas de uso.
 */
export function buildBoard(events: readonly AgentEvent[], now: number): Board {
  const stations = Object.fromEntries(STATIONS.map((id) => [id, { id, uses: 0, running: [], errors: 0, lastAt: null }])) as unknown as Record<Station, StationState>;
  const calls: Call[] = [];
  const byId = new Map<string, Call>();
  const route: RouteStop[] = [];
  let lastUserAt: number | null = null;
  /** El último evento que dice si el agente está contestando: un mensaje suyo lo da por listo; lo demás, no. */
  let lastKind: 'message' | 'other' | null = null;
  let lastMessageAt: number | null = null;

  const touch = (station: Station, at: number | null): void => {
    stations[station].lastAt = latest(stations[station].lastAt, at);
  };
  const visit = (station: Station, at: number | null): void => {
    if (station === 'modelo') return;
    const last = route[route.length - 1];
    if (last !== undefined && last.station === station) last.at = at;
    else route.push({ station, at });
  };

  for (const e of events) {
    switch (e.type) {
      case 'user':
      case 'command':
        stations.tu.uses++;
        touch('tu', e.at);
        visit('tu', e.at);
        if (e.type === 'user') {
          lastUserAt = e.at;
          lastKind = 'other';
          for (const s of STATIONS) stations[s].errors = 0;
        }
        break;
      case 'message':
        stations.modelo.uses++;
        touch('modelo', e.at);
        lastKind = 'message';
        lastMessageAt = e.at;
        break;
      case 'tool': {
        if (byId.has(e.id)) break;
        const station = stationOf(e);
        const call: Call = { id: e.id, station, tool: e.tool, target: e.target, startedAt: e.at, endedAt: null, status: 'running' };
        calls.push(call);
        byId.set(e.id, call);
        stations[station].uses++;
        touch(station, e.at);
        visit(station, e.at);
        lastKind = 'other';
        break;
      }
      case 'result': {
        const call = byId.get(e.id);
        // Un resultado sin su llamada (historial recortado) no dice a qué estación pertenece: se ignora.
        if (call === undefined || call.status !== 'running') break;
        call.status = e.error ? 'failed' : 'done';
        call.endedAt = e.at ?? null;
        touch(call.station, call.endedAt);
        if (e.error) stations[call.station].errors++;
        lastKind = 'other';
        break;
      }
      default:
        break;
    }
  }

  for (const c of calls) {
    if (c.status !== 'running') continue;
    stations[c.station].running.push({ id: c.id, tool: c.tool, target: c.target, since: c.startedAt, elapsedMs: span(c.startedAt, now) });
  }

  const running = calls.filter((c) => c.status === 'running');
  const top = running[running.length - 1];
  const state: BoardNow =
    top !== undefined
      ? { kind: 'running', station: top.station, tool: top.tool, target: top.target, elapsedMs: span(top.startedAt, now), others: running.length - 1 }
      : lastKind === 'message'
        ? { kind: 'ready', turnMs: span(lastUserAt, lastMessageAt) }
        : { kind: 'waiting' };

  return { stations, route: route.slice(-ROUTE_STOPS), rows: foldRows(calls, now, BOARD_ROWS), now: state };
}

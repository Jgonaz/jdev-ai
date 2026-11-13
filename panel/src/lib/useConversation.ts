import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { ApiError, api } from '../api.ts';
import type { AgentEvent, ConversationResponse } from '../../shared/follow.ts';
import { MAP_MAX_EVENTS, lightMapEvent } from './activityMap.ts';
import { EMPTY_CHAT, applyChatEvents, conversationDelay } from './chat.ts';
import type { ChatModel } from './chat.ts';
import { errorDelay } from './follow.ts';

/** Lo último que se sabe de la conversación de una sesión. Vive fuera del componente: al volver a la vista chat no se relee todo. */
export type ConversationEntry = {
  /** Id de la sesión de Claude a la que pertenece lo leído; null hasta la primera respuesta. */
  sessionId: string | null;
  chat: ChatModel;
  /** Eventos ligeros (sin textos ni salidas) para el mapa de actividad; los últimos `MAP_MAX_EVENTS`. */
  mapEvents: readonly AgentEvent[];
  /** Eventos que han llegado al mapa desde el último reinicio, también los ya descartados: la diferencia entre dos lecturas son los eventos nuevos. */
  mapTotal: number;
  /** Byte desde el que pedir lo siguiente. */
  from: number;
  /** Tamaño de la transcripción en la última respuesta (para el progreso de la primera carga). */
  size: number;
  /** Ya se leyó hasta el final al menos una vez: antes, la vista enseña el progreso de carga. */
  synced: boolean;
  /** Instante de la última respuesta correcta. */
  lastOk: number | null;
  /** Último error; se borra con la siguiente respuesta correcta. */
  error: string | null;
  /** Fallos seguidos desde la última respuesta correcta: alarga la espera del reintento. */
  failures: number;
  /** Cambia con cada actualización. */
  version: number;
};

export const EMPTY_CONVERSATION: ConversationEntry = {
  sessionId: null,
  chat: EMPTY_CHAT,
  mapEvents: [],
  mapTotal: 0,
  from: 0,
  size: 0,
  synced: false,
  lastOk: null,
  error: null,
  failures: 0,
  version: 0,
};

/**
 * Aplica una respuesta del servidor a lo que había. Si cambia la sesión de Claude (se retomó o se
 * empezó otra en la misma terminal) o la transcripción encoge, se descarta todo y se vuelve a leer
 * desde el principio: lo pedido desde un byte de otro archivo no sirve.
 */
export function applyConversation(previa: ConversationEntry, r: ConversationResponse, ahora: number): ConversationEntry {
  const cambioSesion = previa.sessionId !== null && previa.sessionId !== r.sessionId;
  const base = { lastOk: ahora, error: null, failures: 0, version: previa.version + 1, sessionId: r.sessionId, size: r.size };
  // Otra sesión pedida desde un byte que no era el 0: esta respuesta no empieza al principio del archivo.
  if (cambioSesion && !r.reset && previa.from !== 0) {
    return { ...base, chat: EMPTY_CHAT, mapEvents: [], mapTotal: 0, from: 0, synced: false };
  }
  const empezar = r.reset || cambioSesion;
  const ligeros = r.events.flatMap((e) => lightMapEvent(e) ?? []);
  const mapEvents = empezar ? ligeros : ligeros.length === 0 ? previa.mapEvents : previa.mapEvents.concat(ligeros);
  return {
    ...base,
    chat: applyChatEvents(previa.chat, r.events, empezar),
    mapEvents: mapEvents.length > MAP_MAX_EVENTS ? mapEvents.slice(-MAP_MAX_EVENTS) : mapEvents,
    mapTotal: (empezar ? 0 : previa.mapTotal) + ligeros.length,
    from: r.from,
    synced: r.more ? (empezar ? false : previa.synced) : true,
  };
}

const MAX_ENTRIES = 8;
const entradas = new Map<string, ConversationEntry>();
const oyentes = new Set<() => void>();

function guarda(nombre: string, e: ConversationEntry): void {
  entradas.delete(nombre); // al reinsertarla pasa a ser la más reciente
  entradas.set(nombre, e);
  while (entradas.size > MAX_ENTRIES) entradas.delete(entradas.keys().next().value!);
  oyentes.forEach((o) => o());
}

function suscribe(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Olvida lo guardado de una sesión (al cerrar su pestaña). */
export function forgetConversation(nombre: string): void {
  entradas.delete(nombre);
}

/** Quien lee la conversación de una sesión (el chat, el mapa…): `trabajando` marca el ritmo del sondeo. */
export type ConversationReader = { trabajando: { current: boolean } };

type Sondeo = { lectores: Set<ConversationReader>; ahora: () => void; parar: () => void };
const sondeos = new Map<string, Sondeo>();

/** Un sondeo por sesión, que sirve a todos los que la leen: pregunta cada segundo si alguno ve trabajar al agente y cada 3 s si no. */
function arrancaSondeo(nombre: string, lectores: Set<ConversationReader>): Sondeo {
  let parado = false;
  let temporizador: number | undefined;
  let enVuelo = false;
  const control = new AbortController();
  const entrada = () => entradas.get(nombre) ?? EMPTY_CONVERSATION;
  const trabajando = () => [...lectores].some((l) => l.trabajando.current);

  const paso = async () => {
    if (parado || enVuelo) return;
    window.clearTimeout(temporizador);
    if (document.visibilityState !== 'visible') {
      temporizador = window.setTimeout(() => void paso(), 1000);
      return;
    }
    enVuelo = true;
    let espera: number;
    try {
      const previa = entrada();
      const r = await api.conversation(nombre, previa.from, control.signal);
      if (parado) return;
      const nueva = applyConversation(previa, r, Date.now());
      guarda(nombre, nueva);
      // Hasta estar al día se sigue pidiendo sin esperar (también tras cambiar de sesión de Claude).
      espera = conversationDelay(!nueva.synced, trabajando());
    } catch (e) {
      if (parado) return;
      const previa = entrada();
      const mensaje = e instanceof ApiError ? e.message : 'No se pudo leer la conversación.';
      const fallos = previa.failures + 1;
      guarda(nombre, { ...previa, error: mensaje, failures: fallos, version: previa.version + 1 });
      espera = errorDelay(fallos);
    } finally {
      enVuelo = false;
    }
    temporizador = window.setTimeout(() => void paso(), espera);
  };
  void paso();
  return {
    lectores,
    ahora: () => void paso(),
    parar: () => {
      parado = true;
      control.abort();
      window.clearTimeout(temporizador);
    },
  };
}

/**
 * Se suma a la lectura de la conversación de una sesión y devuelve cómo dejarla. El sondeo es uno por sesión,
 * lo comparten quienes la leen a la vez (el chat y el mapa) y se detiene cuando se va el último.
 */
export function subscribeConversation(nombre: string, lector: ConversationReader): { refrescar: () => void; dejar: () => void } {
  let sondeo = sondeos.get(nombre);
  if (!sondeo) {
    sondeo = arrancaSondeo(nombre, new Set());
    sondeos.set(nombre, sondeo);
  }
  const propio = sondeo;
  propio.lectores.add(lector);
  return {
    refrescar: () => propio.ahora(),
    dejar: () => {
      propio.lectores.delete(lector);
      if (propio.lectores.size > 0) return;
      propio.parar();
      if (sondeos.get(nombre) === propio) sondeos.delete(nombre);
    },
  };
}

/**
 * Lee la conversación de una sesión de Claude mientras `activo` y la página son visibles: la primera
 * vez, por trozos hasta el final; después, de forma incremental, cada segundo si el agente trabaja
 * y cada 3 s si no. Un fallo no borra lo que ya se ve. `refrescar` pregunta ya (tras enviar un
 * mensaje o pulsar «Reintentar»). Si varias vistas leen la misma sesión a la vez comparten el sondeo.
 */
export function useConversation(nombre: string, activo: boolean, trabajando: boolean): ConversationEntry & { refrescar: () => void } {
  const ritmo = useRef(trabajando);
  ritmo.current = trabajando;
  const ahora = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!activo) return;
    const { refrescar, dejar } = subscribeConversation(nombre, { trabajando: ritmo });
    ahora.current = refrescar;
    return () => {
      dejar();
      ahora.current = () => undefined;
    };
  }, [nombre, activo]);

  const e = useSyncExternalStore(suscribe, () => entradas.get(nombre)) ?? EMPTY_CONVERSATION;
  const refrescar = useCallback(() => ahora.current(), []);
  return { ...e, refrescar };
}

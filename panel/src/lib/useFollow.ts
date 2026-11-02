import { useEffect, useSyncExternalStore } from 'react';
import { ApiError, api } from '../api.ts';
import { EMPTY_AGENT, applyAgentEvents, applyShellText, errorDelay, parseFollowKey, pollDelay } from './follow.ts';
import type { AgentTrack, FollowKind, FollowResponse, FollowState } from './follow.ts';

/** Lo último que se sabe de un subagente o una shell. Vive fuera del componente para no perderlo al ocultar la pestaña. */
export type FollowEntry = {
  kind: FollowKind;
  state: FollowState | null;
  meta: { description: string | null; agentType: string; command: string; startedAt: number | null; updatedAt: number | null } | null;
  agent: AgentTrack;
  /** Salida bruta de la shell (sin quitar secuencias ANSI). */
  shell: string;
  /** Byte desde el que pedir lo siguiente; null hasta la primera respuesta. */
  from: number | null;
  /** Instante de la última respuesta correcta. */
  lastOk: number | null;
  /** Último error (también «no hay datos»); se borra con la siguiente respuesta correcta. */
  error: string | null;
  /** Fallos seguidos desde la última respuesta correcta: alarga la espera del reintento. */
  failures: number;
  /** Cambia con cada actualización: para pintar y para bajar al final. */
  version: number;
};

const vacia = (kind: FollowKind): FollowEntry => ({
  kind,
  state: null,
  meta: null,
  agent: EMPTY_AGENT,
  shell: '',
  from: null,
  lastOk: null,
  error: null,
  failures: 0,
  version: 0,
});

/** Aplica una respuesta del servidor a lo que había. */
export function applyResponse(previa: FollowEntry, r: FollowResponse, ahora: number): FollowEntry {
  const base = { ...previa, state: r.state, from: r.from, lastOk: ahora, error: null, failures: 0, version: previa.version + 1 };
  if (r.kind === 'agent') {
    return {
      ...base,
      meta: { description: r.meta.description, agentType: r.meta.agentType, command: '', startedAt: r.meta.startedAt, updatedAt: r.meta.updatedAt },
      agent: applyAgentEvents(previa.agent, r.events, r.reset),
    };
  }
  return {
    ...base,
    meta: { description: null, agentType: '', command: r.meta.command, startedAt: r.meta.startedAt, updatedAt: r.meta.updatedAt },
    shell: applyShellText(previa.shell, r.text, r.reset),
  };
}

const MAX_ENTRIES = 24;
const entradas = new Map<string, FollowEntry>();
const oyentes = new Set<() => void>();

function guarda(clave: string, e: FollowEntry): void {
  entradas.delete(clave); // al reinsertarla pasa a ser la más reciente
  entradas.set(clave, e);
  while (entradas.size > MAX_ENTRIES) entradas.delete(entradas.keys().next().value!);
  oyentes.forEach((o) => o());
}

function suscribe(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

/** Lo último conocido de una pestaña de seguimiento (para su título), sin sondear. */
export function useFollowEntry(clave: string): FollowEntry | undefined {
  return useSyncExternalStore(suscribe, () => entradas.get(clave));
}

/** Olvida lo guardado de una pestaña (al cerrarla). */
export function forgetFollow(clave: string): void {
  entradas.delete(clave);
}

/**
 * Sondea el seguimiento de una pestaña mientras el componente está montado y la
 * página visible: enseguida si queda más por leer, cada segundo mientras sigue en
 * marcha y cada 10 s cuando ya terminó. Un fallo no borra lo que ya se ve.
 */
export function useFollow(clave: string): FollowEntry {
  const objetivo = parseFollowKey(clave);

  useEffect(() => {
    if (!objetivo) return;
    let parado = false;
    let temporizador: number | undefined;
    const control = new AbortController();
    const entrada = () => entradas.get(clave) ?? vacia(objetivo.kind);

    const paso = async () => {
      if (parado) return;
      if (document.visibilityState !== 'visible') {
        temporizador = window.setTimeout(() => void paso(), 1000);
        return;
      }
      let espera: number;
      try {
        const previa = entrada();
        const r = await api.follow(objetivo.session, objetivo.kind, objetivo.id, objetivo.kind === 'agent' ? (previa.from ?? 0) : previa.from, control.signal);
        if (parado) return;
        const nueva = applyResponse(previa, r, Date.now());
        guarda(clave, nueva);
        espera = pollDelay(r.state, r.more);
      } catch (e) {
        if (parado) return;
        const previa = entrada();
        const mensaje = e instanceof ApiError ? e.message : 'No se pudo leer el seguimiento.';
        const fallos = previa.failures + 1;
        guarda(clave, { ...previa, error: mensaje, failures: fallos, version: previa.version + 1 });
        espera = errorDelay(fallos);
      }
      temporizador = window.setTimeout(() => void paso(), espera);
    };
    void paso();
    return () => {
      parado = true;
      control.abort();
      window.clearTimeout(temporizador);
    };
  }, [clave]); // `objetivo` sale de la clave

  // Lo guardado cambia con el sondeo de este componente y se recupera al volver a montarlo.
  const e = useSyncExternalStore(suscribe, () => entradas.get(clave));
  return e ?? vacia(objetivo?.kind ?? 'agent');
}

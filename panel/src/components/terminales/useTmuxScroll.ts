import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import type { ScrollRequest } from '../../api.ts';
import { POLL_MS, shouldPoll } from '../../lib/scrollbar.ts';
import type { ScrollState } from '../../lib/scrollbar.ts';

/** Espera tras una rueda o una tecla antes de leer: el cliente tmux tarda un instante en entrar en copy-mode. */
const SETTLE_MS = 120;
/** Lecturas extra tras una rueda o tecla que aún no se ven en tmux, y su separación. */
const RETRIES = 2;
const RETRY_MS = 250;
/** Como mucho una lectura cada tanto por la salida de la terminal (el historial crece sin que nadie toque nada). */
const OUTPUT_MS = 1500;

/**
 * Posición de la terminal en el historial de tmux. No sondea en reposo: lee al
 * montar, tras una rueda/tecla/salida (con espera) y cada POLL_MS solo mientras
 * el panel está en copy-mode o el ratón está sobre la barra.
 */
export function useTmuxScroll(name: string, visible: boolean) {
  const [state, setState] = useState<ScrollState | null>(null);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const montado = useRef(true);
  const enCurso = useRef(false);
  const temporizador = useRef<number | null>(null);
  const temporizadorSalida = useRef<number | null>(null);
  const aVista = useRef(visible);
  aVista.current = visible;

  const aplicar = useCallback((s: ScrollState) => {
    if (montado.current) setState(s);
  }, []);

  const refresh = useCallback(async (): Promise<ScrollState | null> => {
    if (enCurso.current) return null;
    enCurso.current = true;
    try {
      const s = await api.scrollState(name);
      aplicar(s);
      return s;
    } catch {
      // Sesión terminada o servidor caído: se conserva lo último y el siguiente evento reintenta.
      return null;
    } finally {
      enCurso.current = false;
    }
  }, [name, aplicar]);

  /**
   * Lee tras una rueda o tecla; varias seguidas comparten una sola lectura. Si tmux aún no
   * había entrado en copy-mode (la orden viaja por el WebSocket), se reintenta un par de
   * veces: sin ello la barra no empezaría a sondear y se quedaría con la posición vieja.
   */
  const bump = useCallback(() => {
    if (temporizador.current !== null) return;
    const leer = (quedan: number) => {
      temporizador.current = window.setTimeout(() => {
        temporizador.current = null;
        void refresh().then((s) => {
          if (s !== null && !s.inMode && quedan > 0 && montado.current) leer(quedan - 1);
        });
      }, quedan === RETRIES ? SETTLE_MS : RETRY_MS);
    };
    leer(RETRIES);
  }, [refresh]);

  /** La terminal ha escrito algo: el historial puede haber crecido. Aparte de bump para no retrasarlo. */
  const noteOutput = useCallback(() => {
    if (temporizadorSalida.current !== null || !aVista.current) return;
    temporizadorSalida.current = window.setTimeout(() => {
      temporizadorSalida.current = null;
      if (aVista.current) void refresh();
    }, OUTPUT_MS);
  }, [refresh]);

  const send = useCallback(
    async (orden: ScrollRequest) => {
      try {
        const s = await api.scrollSession(name, orden);
        aplicar(s);
        return s;
      } catch {
        return null;
      }
    },
    [name, aplicar],
  );

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      for (const t of [temporizador, temporizadorSalida]) {
        if (t.current !== null) window.clearTimeout(t.current);
        t.current = null;
      }
    };
  }, []);

  // Otra sesión: se parte de cero.
  useEffect(() => {
    setState(null);
  }, [name]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const inMode = state?.inMode ?? false;
  useEffect(() => {
    if (!shouldPoll({ inMode, hovering, dragging, visible })) return;
    const id = window.setInterval(() => {
      if (!dragging) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [inMode, hovering, dragging, visible, refresh]);

  return { state, bump, noteOutput, send, setHovering, setDragging };
}

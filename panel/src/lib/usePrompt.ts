import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import type { PromptInfo } from '../../shared/chat.ts';
import type { PromptState } from './prompts.ts';

/** Cada cuánto se pregunta qué hay abierto en la terminal mientras la sesión espera. */
export const PROMPT_POLL_MS = 1500;
/** Fallos seguidos a partir de los cuales se da por fallida la consulta aunque ya hubiera una respuesta. */
const FALLOS_SEGUIDOS = 3;

const INICIAL: PromptState = { prompt: null, loaded: false, failed: false };

/**
 * Qué hay abierto en la terminal de una sesión (`GET /prompt`): se consulta al entrar en `activo` y cada `PROMPT_POLL_MS`
 * mientras dure, y se para al salir o al desmontar. Un fallo aislado no cambia lo que se ve; sin respuesta previa, o con
 * varios fallos seguidos, `failed` lo dice (el chat vuelve entonces al aviso de «espera en la terminal»).
 * `refrescar` consulta ya y resuelve cuando lo leído está aplicado (tras contestar).
 */
export function usePrompt(nombre: string, activo: boolean): PromptState & { refrescar: () => Promise<void> } {
  const [estado, setEstado] = useState<PromptState>(INICIAL);
  const consulta = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    setEstado(INICIAL);
    consulta.current = () => Promise.resolve();
    if (!activo) return;
    let parado = false;
    let temporizador: number | undefined;
    let fallos = 0;
    let lanzadas = 0;
    let aplicada = 0;
    const control = new AbortController();

    const preguntar = async (): Promise<void> => {
      const mia = ++lanzadas;
      try {
        const prompt = await api.prompt(nombre, control.signal);
        if (parado || mia < aplicada) return;
        aplicada = mia;
        fallos = 0;
        setEstado((e) => (e.loaded && !e.failed && sameJson(e.prompt, prompt) ? e : { prompt, loaded: true, failed: false }));
      } catch (e) {
        if (parado || (e instanceof DOMException && e.name === 'AbortError')) return;
        fallos++;
        setEstado((p) => (!p.loaded || fallos >= FALLOS_SEGUIDOS ? (p.failed ? p : { ...p, failed: true }) : p));
      }
    };
    const ciclo = async (): Promise<void> => {
      if (parado) return;
      if (document.visibilityState === 'visible') await preguntar();
      if (!parado) temporizador = window.setTimeout(() => void ciclo(), PROMPT_POLL_MS);
    };
    consulta.current = async () => {
      if (!parado) await preguntar();
    };
    void ciclo();
    return () => {
      parado = true;
      control.abort();
      window.clearTimeout(temporizador);
    };
  }, [nombre, activo]);

  const refrescar = useCallback(() => consulta.current(), []);
  return { ...estado, refrescar };
}

const sameJson = (a: PromptInfo | null, b: PromptInfo | null): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

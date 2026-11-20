import { useEffect, useRef } from 'react';
import { isDesktop } from './desktop.ts';

export type ShortcutHandlers = {
  prev: () => void;
  next: () => void;
  newSession: () => void;
  cycleLayout: () => void;
  /** Saca el foco de la terminal y lo lleva a la pestaña activa. */
  focusTabs: () => void;
  /** Cierra (oculta) la pestaña activa; una sesión hecha pregunta antes. Solo en la app de escritorio. */
  closeTab: () => void;
  /** Crea una sesión sin diálogo con el último proyecto y agente. Solo en la app de escritorio. */
  quickSession: () => void;
  /** Como `quickSession`, pero con el agente por defecto de Ajustes. Solo en la app de escritorio. */
  quickDefaultSession: () => void;
  /** Reabre la sesión que más recientemente se mandó a segundo plano. */
  lastBackground: () => void;
  /** Reabre la última pestaña cerrada (o propone retomarla si se terminó). Solo en la app de escritorio. */
  reopenClosed: () => void;
};

type KeyLike = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'key'>;

/**
 * Atajos globales. Se escuchan en captura para que la terminal con el foco no los
 * reciba como entrada.
 *
 * - Con Ctrl+Alt (navegador y app de escritorio): se evitan a propósito las
 *   combinaciones que reserva el navegador (Ctrl+T, Ctrl+W, Ctrl+Tab…) y las que
 *   escriben caracteres con AltGr en teclados españoles (Ctrl+Alt+1, 2, 4… dan
 *   |, @, ~), así que no hay atajos con dígitos. Ctrl+Alt+T no escribe nada con
 *   AltGr en ese teclado.
 * - Solo en la app de escritorio (Tauri), donde no hay pestañas del navegador y
 *   sí se pueden capturar: Ctrl+Tab / Ctrl+Mayús+Tab, Ctrl+W, Ctrl+N, Ctrl+Mayús+N, Ctrl+T y Ctrl+Mayús+T.
 *   Se quedan con ellas el panel aunque la terminal tenga el foco (como VS Code):
 *   la shell y Claude Code dejan de recibirlas. En el navegador no se activan:
 *   Chrome no deja capturarlas.
 */
export function matchShortcut(e: KeyLike, desktop = false): keyof ShortcutHandlers | null {
  if (e.metaKey) return null;
  if (e.ctrlKey && e.altKey) {
    if (e.shiftKey) return null;
    switch (e.key) {
      case 'ArrowLeft':
        return 'prev';
      case 'ArrowRight':
        return 'next';
      case 'n':
      case 'N':
        return 'newSession';
      case 'l':
      case 'L':
        return 'cycleLayout';
      case 't':
      case 'T':
        return 'lastBackground';
      case 'Escape':
        return 'focusTabs';
      default:
        return null;
    }
  }
  if (!desktop || !e.ctrlKey || e.altKey) return null;
  if (e.key === 'Tab') return e.shiftKey ? 'prev' : 'next';
  if (e.shiftKey) {
    if (e.key === 'n' || e.key === 'N') return 'quickDefaultSession';
    if (e.key === 't' || e.key === 'T') return 'reopenClosed';
    return null;
  }
  switch (e.key) {
    case 'w':
    case 'W':
      return 'closeTab';
    case 'n':
    case 'N':
      return 'newSession';
    case 't':
    case 'T':
      return 'quickSession';
    default:
      return null;
  }
}

export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean, desktop = isDesktop()): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const alPulsar = (e: KeyboardEvent) => {
      const accion = matchShortcut(e, desktop);
      if (!accion) return;
      e.preventDefault();
      e.stopPropagation();
      // Mantener pulsada la tecla solo repite el cambio de terminal: no crea ni cierra una sesión por cada repetición.
      if (e.repeat && accion !== 'prev' && accion !== 'next') return;
      ref.current[accion]();
    };
    window.addEventListener('keydown', alPulsar, true);
    return () => window.removeEventListener('keydown', alPulsar, true);
  }, [enabled, desktop]);
}

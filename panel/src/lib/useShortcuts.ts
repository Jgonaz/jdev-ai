import { useEffect, useRef } from 'react';

export type ShortcutHandlers = {
  prev: () => void;
  next: () => void;
  newSession: () => void;
  cycleLayout: () => void;
  /** Saca el foco de la terminal y lo lleva a la pestaña activa. */
  focusTabs: () => void;
};

/**
 * Atajos globales con Ctrl+Alt. Se evitan a propósito las combinaciones que
 * reserva el navegador (Ctrl+T, Ctrl+W, Ctrl+Tab…) y las que escriben
 * caracteres con AltGr en teclados españoles (Ctrl+Alt+1, 2, 4… dan |, @, ~),
 * así que no hay atajos con dígitos. Se escuchan en captura para que la
 * terminal con el foco no los reciba como entrada.
 */
export function matchShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'key'>): keyof ShortcutHandlers | null {
  if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return null;
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
    case 'Escape':
      return 'focusTabs';
    default:
      return null;
  }
}

export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const alPulsar = (e: KeyboardEvent) => {
      const accion = matchShortcut(e);
      if (!accion) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current[accion]();
    };
    window.addEventListener('keydown', alPulsar, true);
    return () => window.removeEventListener('keydown', alPulsar, true);
  }, [enabled]);
}

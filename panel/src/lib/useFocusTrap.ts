import { useEffect } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type FocusTrapOptions = {
  /** La trampa solo actúa mientras es true (por defecto, siempre). */
  active?: boolean;
  /** Escape llama a `onClose` (por defecto, sí). */
  closeOnEscape?: boolean;
  /** Al desmontar devuelve el foco al elemento que lo tenía al abrir (por defecto, sí). */
  restoreFocus?: boolean;
  /** Si es false, solo mueve el foco al abrir cuando está fuera del contenedor (por defecto, siempre). */
  moveFocus?: boolean;
};

/**
 * Atrapa el foco dentro de `ref` mientras está montado, cierra con Escape y
 * devuelve el foco al elemento que lo tenía al abrir. `opciones` permite
 * usarlo en un panel no modal que solo atrapa el foco a ciertos anchos.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void, inicial?: string, opciones: FocusTrapOptions = {}): void {
  const { active = true, closeOnEscape = true, restoreFocus = true, moveFocus = true } = opciones;
  useEffect(() => {
    const contenedor = ref.current;
    if (!contenedor || !active) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const enfocables = () => [...contenedor.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);

    if (moveFocus || !contenedor.contains(document.activeElement)) {
      const destino = (inicial ? contenedor.querySelector<HTMLElement>(inicial) : null) ?? enfocables()[0] ?? contenedor;
      destino.focus();
    }

    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables();
      if (lista.length === 0) {
        e.preventDefault();
        return;
      }
      const primero = lista[0]!;
      const ultimo = lista[lista.length - 1]!;
      if (e.shiftKey && (document.activeElement === primero || !contenedor.contains(document.activeElement))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (document.activeElement === ultimo || !contenedor.contains(document.activeElement))) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alPulsar, true);
    return () => {
      document.removeEventListener('keydown', alPulsar, true);
      if (restoreFocus) previo?.focus?.();
    };
    // onClose se lee en el momento del evento; no debe reiniciar la trampa.
  }, [ref, inicial, active, closeOnEscape, restoreFocus, moveFocus]);
}

import { useEffect } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Atrapa el foco dentro de `ref` mientras está montado, cierra con Escape y
 * devuelve el foco al elemento que lo tenía al abrir.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void, inicial?: string): void {
  useEffect(() => {
    const contenedor = ref.current;
    if (!contenedor) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const enfocables = () => [...contenedor.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);

    const destino = (inicial ? contenedor.querySelector<HTMLElement>(inicial) : null) ?? enfocables()[0] ?? contenedor;
    destino.focus();

    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
      previo?.focus?.();
    };
    // onClose se lee en el momento del evento; no debe reiniciar la trampa.
  }, [ref, inicial]);
}

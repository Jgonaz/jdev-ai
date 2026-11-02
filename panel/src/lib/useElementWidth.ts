import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Ancho (px) de un elemento, siguiendo sus cambios de tamaño. 0 hasta la primera medida. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setAncho(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((entradas) => {
      const w = entradas[0]?.contentRect.width;
      if (w !== undefined) setAncho(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return ancho;
}

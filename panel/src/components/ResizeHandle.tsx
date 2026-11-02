import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { dragWidth, effectiveMax, keyboardWidth } from '../lib/panelWidth.ts';
import type { PanelLimits, PanelSide } from '../lib/panelWidth.ts';
import type { PanelWidth } from '../lib/usePanelWidth.ts';

/**
 * Tirador para cambiar el ancho de un panel lateral. Va como hermano del panel,
 * justo a su lado (antes de un panel derecho, después de uno izquierdo), dentro
 * del contenedor flex que reparte el ancho.
 *
 * Es un separador enfocable (WAI-ARIA «window splitter»): flechas ±16 px, Mayús
 * ±64 px, Inicio y Fin a los límites. Doble clic restablece el ancho por defecto.
 * Al arrastrar usa pointer capture y una capa transparente que cubre la página,
 * para que ni xterm ni otros elementos reciban el puntero ni se seleccione texto.
 */
export function ResizeHandle(props: {
  side: PanelSide;
  limits: PanelLimits;
  panel: PanelWidth;
  label: string;
  /** Ancho que ocupan otros paneles en línea del mismo contenedor, para que el centro conserve su mínimo. */
  reserved?: number;
}) {
  const { side, limits, panel, label, reserved = 0 } = props;
  const raiz = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ x: number; inicio: number; max: number; movido: boolean } | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [contenedor, setContenedor] = useState(0);

  // El máximo efectivo depende del ancho del contenedor, que cambia con la ventana.
  useEffect(() => {
    const padre = raiz.current?.parentElement;
    if (!padre) return;
    const medir = () => setContenedor(padre.clientWidth);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(medir);
    obs.observe(padre);
    return () => obs.disconnect();
  }, []);

  const maxAhora = useCallback(() => {
    const padre = raiz.current?.parentElement;
    return effectiveMax(limits.max, limits.min, padre?.clientWidth ?? 0, reserved);
  }, [limits.max, limits.min, reserved]);

  /** Ancho real del panel: puede ser menor que el guardado si la ventana es estrecha. */
  const anchoReal = useCallback((): number => {
    const el = side === 'left' ? raiz.current?.previousElementSibling : raiz.current?.nextElementSibling;
    const w = el instanceof HTMLElement ? el.getBoundingClientRect().width : 0;
    return w > 0 ? w : panel.width;
  }, [side, panel.width]);

  const alBajar = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastre.current = { x: e.clientX, inicio: anchoReal(), max: maxAhora(), movido: false };
    document.body.classList.add('is-resizing');
    setArrastrando(true);
  };
  const alMover = (e: PointerEvent<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a) return;
    if (Math.abs(e.clientX - a.x) < 1 && !a.movido) return;
    a.movido = true;
    panel.preview(dragWidth(a.inicio, e.clientX - a.x, side, limits.min, a.max));
  };
  const terminar = (e: PointerEvent<HTMLDivElement>, confirmar: boolean) => {
    const a = arrastre.current;
    if (!a) return;
    arrastre.current = null;
    document.body.classList.remove('is-resizing');
    setArrastrando(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // Un clic sin mover no fija el ancho; al cancelar se vuelve al original.
    if (!a.movido) return;
    if (confirmar) panel.commit(dragWidth(a.inicio, e.clientX - a.x, side, limits.min, a.max));
    else panel.preview(a.inicio);
  };
  const alPulsar = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const w = keyboardWidth(e.key, e.shiftKey, anchoReal(), side, limits.min, maxAhora());
    if (w === null) return;
    e.preventDefault();
    panel.commit(w);
  };

  // Si el tirador desaparece a mitad de un arrastre no debe quedar el cursor bloqueado.
  useEffect(() => () => document.body.classList.remove('is-resizing'), []);

  const max = effectiveMax(limits.max, limits.min, contenedor, reserved);
  const valor = Math.min(Math.max(Math.round(panel.width), limits.min), max);
  return (
    <div className="rhandle" ref={raiz}>
      <div
        className={`rhandle__grip${arrastrando ? ' rhandle__grip--active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={valor}
        aria-valuemin={limits.min}
        aria-valuemax={max}
        aria-valuetext={`${valor} píxeles`}
        tabIndex={0}
        title="Arrastra para cambiar el ancho; doble clic para restablecerlo"
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={(e) => terminar(e, true)}
        onPointerCancel={(e) => terminar(e, false)}
        onLostPointerCapture={(e) => terminar(e, true)}
        onDoubleClick={panel.reset}
        onKeyDown={alPulsar}
      />
      {arrastrando && <div className="rhandle__shield" aria-hidden="true" />}
    </div>
  );
}

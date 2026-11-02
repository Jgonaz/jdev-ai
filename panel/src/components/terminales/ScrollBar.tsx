import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { ScrollRequest } from '../../api.ts';
import { appScroll, appTrackClickAction, barVisible, positionFromThumbTop, thumbGeometry, topLine, trackClickAction } from '../../lib/scrollbar.ts';
import type { ScrollState } from '../../lib/scrollbar.ts';
import { IconToBottom, IconToTop } from '../Icons.tsx';

/** Líneas que avanza la rueda sobre la barra y las flechas del teclado. */
const WHEEL_LINES = 5;
/** En pantalla alternativa cada muesca es una página: como mucho una cada tanto. */
const APP_WHEEL_MS = 150;

type Props = {
  state: ScrollState | null;
  /** Id del elemento de la terminal que controla (aria-controls). */
  controls: string;
  onOrder: (orden: ScrollRequest) => Promise<ScrollState | null>;
  onHover: (sobre: boolean) => void;
  onDragging: (arrastrando: boolean) => void;
};

/** Orden que lleva la vista a `position` (líneas sobre el final); 0 sale de copy-mode. */
const toPosition = (position: number): ScrollRequest => (position <= 0 ? { action: 'bottom' } : { action: 'line', line: position });

/**
 * Barra de scroll de una terminal: el historial lo tiene tmux, así que xterm no
 * tiene nada que desplazar. Muestra la posición, se arrastra, un clic en la
 * pista pagina y dos botones saltan al principio y al final. Oculta sin historial.
 * Si la aplicación usa la pantalla alternativa (Claude Code a pantalla completa),
 * el historial es suyo: sin pulgar, la pista y los botones le mandan sus teclas.
 */
export function ScrollBar({ state, controls, onOrder, onHover, onDragging }: Props) {
  const pista = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState(0);
  const [arrastre, setArrastre] = useState<number | null>(null);
  const drag = useRef<{ y: number; top: number; size: number; history: number } | null>(null);
  // Arrastrar genera muchas posiciones: solo viaja la última cuando la anterior ha vuelto.
  const pendiente = useRef<number | null>(null);
  const enviando = useRef(false);
  const actual = useRef(state);
  actual.current = state;

  useEffect(() => {
    const el = pista.current;
    if (!el) return;
    const medir = () => setAlto(el.clientHeight);
    medir();
    const o = new ResizeObserver(medir);
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const visible = barVisible(state);
  const app = appScroll(state);
  const ultimaRueda = useRef(0);
  const geo = visible && !app ? thumbGeometry(state, alto) : { top: 0, size: 0 };
  const top = arrastre ?? geo.top;

  const vaciar = async () => {
    if (enviando.current) return;
    enviando.current = true;
    try {
      while (pendiente.current !== null) {
        const p = pendiente.current;
        pendiente.current = null;
        await onOrder(toPosition(p));
      }
    } finally {
      enviando.current = false;
    }
  };

  const alPulsar = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!visible || e.button !== 0 || !pista.current) return;
    const rect = pista.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (app) {
      void onOrder({ action: appTrackClickAction(y, rect.height) });
      pista.current.focus();
      return;
    }
    if ((e.target as HTMLElement).closest('.tscroll__thumb')) {
      drag.current = { y: e.clientY, top: geo.top, size: geo.size, history: state.history };
      pista.current.setPointerCapture(e.pointerId);
      setArrastre(geo.top);
      onDragging(true);
      e.preventDefault();
      return;
    }
    const accion = trackClickAction(y, geo);
    if (accion) void onOrder({ action: accion });
    pista.current.focus();
  };

  const alMover = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const libre = Math.max(0, alto - d.size);
    const nuevo = Math.min(libre, Math.max(0, d.top + e.clientY - d.y));
    setArrastre(nuevo);
    pendiente.current = positionFromThumbTop(nuevo, d.size, alto, d.history);
    void vaciar();
  };

  const alSoltar = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (pista.current?.hasPointerCapture(e.pointerId)) pista.current.releasePointerCapture(e.pointerId);
    setArrastre(null);
    onDragging(false);
    void vaciar();
  };

  const alTeclear = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const s = actual.current;
    if (!s) return;
    // En pantalla alternativa no hay líneas que contar: las flechas no hacen nada.
    const lineas = (n: number) => {
      if (!appScroll(s)) void onOrder(toPosition(Math.min(s.history, s.position + n)));
    };
    switch (e.key) {
      case 'ArrowUp':
        lineas(1);
        break;
      case 'ArrowDown':
        if (s.inMode) lineas(-1);
        break;
      case 'PageUp':
        void onOrder({ action: 'page-up' });
        break;
      case 'PageDown':
        void onOrder({ action: 'page-down' });
        break;
      case 'Home':
        void onOrder({ action: 'top' });
        break;
      case 'End':
        void onOrder({ action: 'bottom' });
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  // La rueda sobre la barra también recorre el historial.
  const alRodar = (e: ReactWheelEvent<HTMLDivElement>) => {
    const s = actual.current;
    if (!s || e.deltaY === 0) return;
    if (appScroll(s)) {
      const ahora = Date.now();
      if (ahora - ultimaRueda.current < APP_WHEEL_MS) return;
      ultimaRueda.current = ahora;
      void onOrder({ action: e.deltaY < 0 ? 'page-up' : 'page-down' });
      return;
    }
    const paso = e.deltaY < 0 ? WHEEL_LINES : -WHEEL_LINES;
    if (paso < 0 && !s.inMode) return;
    void onOrder(toPosition(Math.min(s.history, s.position + paso)));
  };

  return (
    <div
      className="tscroll"
      hidden={!visible}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onWheel={alRodar}
    >
      <button type="button" className="tscroll__btn" aria-label="Ir arriba (principio del historial)" title="Ir arriba" onClick={() => void onOrder({ action: 'top' })}>
        <IconToTop size={12} />
      </button>
      <div
        ref={pista}
        className={`tscroll__track${arrastre !== null ? ' tscroll__track--drag' : ''}`}
        role="scrollbar"
        aria-label="Historial de la terminal"
        aria-orientation="vertical"
        aria-controls={controls}
        aria-valuemin={0}
        aria-valuemax={app ? 0 : (state?.history ?? 0)}
        aria-valuenow={app || !state ? 0 : topLine(state)}
        aria-valuetext={app ? 'Historial de la aplicación: clic arriba o abajo para pasar página' : undefined}
        tabIndex={0}
        onPointerDown={alPulsar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onKeyDown={alTeclear}
      >
        {app ? null : <div className="tscroll__thumb" style={{ height: geo.size, transform: `translateY(${top}px)` }} />}
      </div>
      <button type="button" className="tscroll__btn" aria-label="Ir al final (salir del historial)" title="Ir al final" onClick={() => void onOrder({ action: 'bottom' })}>
        <IconToBottom size={12} />
      </button>
    </div>
  );
}

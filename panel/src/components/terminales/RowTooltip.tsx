import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { clampMenu } from '../../lib/menuPosition.ts';
import { TIP_DELAY_MS } from '../../lib/sidebarTip.ts';
import type { TipView } from '../../lib/sidebarTip.ts';
import { useNow } from '../../lib/useNow.ts';
import { IconBranch, IconCheck, IconClock, IconSpark } from '../Icons.tsx';
import { ContextBar } from './PaneHeader.tsx';

/** Separación entre la fila y el tooltip. */
const GAP = 8;

// La barra lateral lo bloquea mientras hay un menú contextual abierto.
const BlockedContext = createContext(false);
export const RowTipBlock = BlockedContext.Provider;

/**
 * Propiedades que se esparcen en la fila (un botón) para que muestre su
 * tooltip: con el ratón encima tras TIP_DELAY_MS y con el foco del teclado al
 * momento. Se cierra al salir, al perder el foco, al pulsar o abrir el menú, al
 * desplazar la página y con Esc. No se abre con un menú contextual abierto ni
 * durante un arrastre del tirador de ancho.
 */
export function useRowTip() {
  const id = useId();
  const bloqueado = useContext(BlockedContext);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const temporizador = useRef<number | null>(null);

  const limpiar = () => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    temporizador.current = null;
  };
  const cerrar = () => {
    limpiar();
    setAnchor(null);
  };
  useEffect(() => limpiar, []);
  useEffect(() => {
    if (bloqueado) cerrar();
  }, [bloqueado]);

  const abierto = anchor !== null;
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    // El tooltip está anclado a la fila: si se desplaza el contenedor de la fila, deja de estar donde debe
    // (el desplazamiento de otras zonas, como la salida de una terminal, no le afecta).
    const desplazado = (e: Event) => {
      if (e.target instanceof Node && e.target.contains(anchor)) cerrar();
    };
    window.addEventListener('keydown', tecla, true);
    window.addEventListener('scroll', desplazado, true);
    window.addEventListener('resize', cerrar);
    window.addEventListener('blur', cerrar);
    return () => {
      window.removeEventListener('keydown', tecla, true);
      window.removeEventListener('scroll', desplazado, true);
      window.removeEventListener('resize', cerrar);
      window.removeEventListener('blur', cerrar);
    };
  }, [abierto, anchor]);

  const puedeAbrir = () => !bloqueado && !document.body.classList.contains('is-resizing');

  return {
    id,
    anchor,
    props: {
      'aria-describedby': abierto ? id : undefined,
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        // En táctil no hay "encima": el tooltip no se abre.
        if (e.pointerType !== 'mouse') return;
        const el = e.currentTarget;
        limpiar();
        temporizador.current = window.setTimeout(() => {
          temporizador.current = null;
          if (puedeAbrir()) setAnchor(el);
        }, TIP_DELAY_MS);
      },
      onPointerLeave: cerrar,
      onPointerDown: cerrar,
      onFocus: (e: FocusEvent<HTMLElement>) => {
        // Solo con el teclado: un clic también da el foco y el tooltip taparía lo que se acaba de pulsar.
        if (puedeAbrir() && e.currentTarget.matches(':focus-visible')) setAnchor(e.currentTarget);
      },
      onBlur: cerrar,
    },
  };
}

/**
 * Tooltip de una fila de la barra lateral, a su derecha y ajustado a la ventana
 * como el menú contextual. No recibe el puntero ni el foco; la fila lo
 * referencia con aria-describedby. `build` recibe la hora actual (se refresca
 * cada segundo mientras está abierto) para que el tiempo y los datos sigan vivos.
 */
export function RowTooltip({ anchor, id, build }: { anchor: HTMLElement; id: string; build: (ahora: number) => TipView }) {
  const ahora = useNow(1000);
  const raiz = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const vista = build(ahora);

  // Se mide antes de pintar para que nunca se vea en un sitio provisional; también si cambia su contenido.
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const fila = anchor.getBoundingClientRect();
    const caja = el.getBoundingClientRect();
    const next = clampMenu(fila.right + GAP, fila.top, caja.width, caja.height, { width: window.innerWidth, height: window.innerHeight });
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  });

  const live = vista.live;
  return createPortal(
    <div
      ref={raiz}
      id={id}
      role="tooltip"
      className={`rowtip${live?.stale ? ' rowtip--stale' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <div className="rowtip__title">{vista.title}</div>
      <div className="rowtip__facts">
        <span className="pfact">
          <span className="pfact__square" style={{ color: vista.project.color }} aria-hidden="true">
            ■
          </span>
          <span className="pfact__strong">{vista.project.name}</span>
        </span>
        <span className="pfact">
          <IconBranch size={12} />
          {vista.place}
        </span>
        <span className="pfact">{vista.agent}</span>
      </div>
      {vista.activity && <div className="rowtip__line">{vista.activity}</div>}
      {vista.done && (
        <div className="rowtip__done">
          <span className="rowtip__done-line">
            <IconCheck size={12} strokeWidth={2.4} />
            {vista.done.line}
          </span>
          {vista.done.note && <span className="rowtip__done-note">{vista.done.note}</span>}
        </div>
      )}
      {live && (
        <div className="rowtip__live">
          {live.model && (
            <span className="pfact">
              <IconSpark size={12} />
              <span className="pfact__strong">{live.model}</span>
            </span>
          )}
          {live.context && <ContextBar vista={live.context} narrow={false} ago={live.ago} />}
          <span className="pfact">
            <IconClock size={12} />
            {live.elapsed}
          </span>
          {live.work && <span className="rowtip__work">{live.work}</span>}
        </div>
      )}
    </div>,
    document.body,
  );
}

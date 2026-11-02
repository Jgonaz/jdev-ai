import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clampMenu } from '../lib/menuPosition.ts';

/** Una opción de un menú de acciones (la comparten «Más acciones» y el menú contextual). */
export type MenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** Tras elegirla, el foco vuelve al elemento que abrió el menú (p. ej. «Copiar»). */
  restoreFocus?: boolean;
  onSelect: () => void;
};

/** Opciones de un menú, como `menuitem`. El contenedor (role="menu") es del llamador. */
export function MenuItems({ actions, onPick }: { actions: MenuAction[]; onPick: (a: MenuAction) => void }) {
  return (
    <>
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          className={`menu__item${a.danger ? ' menu__item--danger' : ''}`}
          onClick={() => onPick(a)}
        >
          {a.icon}
          {a.label}
        </button>
      ))}
    </>
  );
}

/** Flechas, Inicio y Fin entre las opciones de un menú. Devuelve true si la tecla se atendió. */
export function moveMenuFocus(e: KeyboardEvent, contenedor: HTMLElement | null): boolean {
  const items = [...(contenedor?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
  if (items.length === 0) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  let j: number;
  if (e.key === 'ArrowDown') j = (i + 1) % items.length;
  else if (e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = items.length - 1;
  else return false;
  e.preventDefault();
  items[j]?.focus();
  return true;
}

type Props = {
  label: string;
  actions: MenuAction[];
  /** Punto (coordenadas de la ventana) donde se abre; se ajusta para que quepa. */
  x: number;
  y: number;
  /** Cierra el menú; `devolverFoco` pide que el foco vuelva a quien lo abrió. */
  onClose: (devolverFoco: boolean) => void;
  onPick: (a: MenuAction) => void;
};

/**
 * Menú contextual flotante en la posición del puntero. Entra con el foco en la
 * primera opción; flechas, Inicio y Fin se mueven por ellas, Escape y Tab lo
 * cierran devolviendo el foco, y un clic fuera, el desplazamiento, el cambio de
 * tamaño o perder el foco de la ventana lo cierran sin moverlo.
 */
export function ContextMenu({ label, actions, x, y, onClose, onPick }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  // Se mide antes de pintar para que nunca se vea en un sitio provisional.
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const caja = el.getBoundingClientRect();
    setPos(clampMenu(x, y, caja.width, caja.height, { width: window.innerWidth, height: window.innerHeight }));
  }, [x, y, actions.length]);

  useEffect(() => {
    if (pos) raiz.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    // Solo al aparecer en su sitio, no en cada reposicionamiento.
  }, [pos === null]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) cerrar.current(false);
    };
    const suelto = () => cerrar.current(false);
    document.addEventListener('mousedown', fuera, true);
    window.addEventListener('blur', suelto);
    window.addEventListener('resize', suelto);
    window.addEventListener('scroll', suelto, true);
    return () => {
      document.removeEventListener('mousedown', fuera, true);
      window.removeEventListener('blur', suelto);
      window.removeEventListener('resize', suelto);
      window.removeEventListener('scroll', suelto, true);
    };
  }, []);

  const alPulsar = (e: KeyboardEvent) => {
    if (moveMenuFocus(e, raiz.current)) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    }
  };

  return createPortal(
    <div
      ref={raiz}
      id={id}
      className="menu__list ctxmenu"
      role="menu"
      aria-label={label}
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={alPulsar}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItems actions={actions} onPick={onPick} />
    </div>,
    document.body,
  );
}

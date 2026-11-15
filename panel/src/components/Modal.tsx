import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../lib/useFocusTrap.ts';
import { IconClose } from './Icons.tsx';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Ancho en píxeles del diálogo. */
  width?: number;
  role?: 'dialog' | 'alertdialog';
  /** Selector CSS del elemento que recibe el foco al abrir. */
  initialFocus?: string;
  /** Clase extra del diálogo (variantes de tamaño). */
  className?: string;
  /** Botones de la cabecera, a la izquierda de la «×». */
  actions?: ReactNode;
};

/**
 * Con ← y → se pasa de un botón del pie al siguiente (en un diálogo de confirmación, que solo
 * tiene botones ahí): la elección entre «Cancelar» y las acciones no obliga a tabular.
 */
function moverEnPie(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const botones = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const i = botones.findIndex((b) => b === document.activeElement);
  if (i < 0 || botones.length < 2) return;
  e.preventDefault();
  botones[(i + (e.key === 'ArrowRight' ? 1 : botones.length - 1)) % botones.length]!.focus();
}

/** Diálogo modal accesible: role, aria-modal, foco atrapado y cierre con Escape. */
export function Modal({ title, onClose, children, footer, width = 640, role = 'dialog', initialFocus, className, actions }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const cerrar = useRef(onClose);
  cerrar.current = onClose;
  useFocusTrap(ref, () => cerrar.current(), initialFocus);

  // El fondo no debe desplazarse mientras el diálogo está abierto.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={className ? `modal ${className}` : 'modal'} role={role} aria-modal="true" aria-labelledby={idTitulo} style={{ width }} tabIndex={-1}>
        <div className="modal__head">
          <h1 id={idTitulo} className="modal__title">
            {title}
          </h1>
          {actions && <div className="modal__actions">{actions}</div>}
          {/* En una confirmación, Cancelar y Escape ya cierran: la «×» queda fuera del orden de Tab para que recorra solo las opciones. */}
          <button type="button" className="icon-btn modal__close" aria-label="Cerrar" tabIndex={role === 'alertdialog' ? -1 : undefined} onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && (
          <div className="modal__foot" onKeyDown={role === 'alertdialog' ? moverEnPie : undefined}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

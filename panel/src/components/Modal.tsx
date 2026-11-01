import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
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
};

/** Diálogo modal accesible: role, aria-modal, foco atrapado y cierre con Escape. */
export function Modal({ title, onClose, children, footer, width = 640, role = 'dialog', initialFocus }: Props) {
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
      <div ref={ref} className="modal" role={role} aria-modal="true" aria-labelledby={idTitulo} style={{ width }} tabIndex={-1}>
        <div className="modal__head">
          <h1 id={idTitulo} className="modal__title">
            {title}
          </h1>
          <button type="button" className="icon-btn modal__close" aria-label="Cerrar" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

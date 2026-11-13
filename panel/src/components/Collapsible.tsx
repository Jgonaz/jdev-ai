import { useId } from 'react';
import type { ReactNode } from 'react';
import { IconChevron } from './Icons.tsx';

type Props = {
  /** Título del desplegable (se pinta en mayúsculas por CSS). */
  title: string;
  /** Resumen a la derecha del título (un número, «proyecto · rama»…). */
  summary?: string;
  /** Nombre accesible del botón si ha de ser distinto de «título + resumen». */
  label?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  /** Se monta solo con el desplegable abierto. */
  children: ReactNode;
};

/**
 * Sección plegable del panel derecho: un botón con `aria-expanded` y su contenido debajo, en el flujo (no flota).
 * No usa `Disclosure`, que es un menú emergente (se cierra con un clic fuera, Escape o al perder el foco) y aquí el
 * contenido es parte de la página y el estado lo guarda quien lo usa.
 */
export function Collapsible({ title, summary, label, open, onToggle, children }: Props) {
  const idCuerpo = useId();
  return (
    <section className="collapsible">
      <h3 className="collapsible__h">
        <button type="button" className="collapsible__btn" aria-expanded={open} aria-controls={open ? idCuerpo : undefined} aria-label={label} onClick={() => onToggle(!open)}>
          <IconChevron size={14} className={`collapsible__chevron${open ? ' collapsible__chevron--open' : ''}`} />
          <span className="collapsible__title">{title}</span>
          {summary !== undefined && <span className="collapsible__summary">{summary}</span>}
        </button>
      </h3>
      {open && (
        <div id={idCuerpo} className="collapsible__body">
          {children}
        </div>
      )}
    </section>
  );
}

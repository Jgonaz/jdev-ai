import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { moveMenuFocus } from './ContextMenu.tsx';

type Props = {
  /** Contenido del botón (el texto accesible va en `label`). */
  button: ReactNode;
  buttonClassName: string;
  /** Texto accesible del botón. */
  label: string;
  title?: string;
  /** «menu»: lista de opciones con flechas; «dialog»: información con enlaces o texto. */
  kind: 'menu' | 'dialog';
  /** Nombre accesible del desplegable. */
  popLabel: string;
  popClassName: string;
  wrapClassName?: string;
  /** Contenido del desplegable; recibe la función que lo cierra devolviendo el foco al botón. */
  children: (cerrar: () => void) => ReactNode;
};

/**
 * Botón con un desplegable. Se cierra con Escape (devolviendo el foco al botón),
 * con un clic fuera y al sacar el foco de él. Con `kind="menu"` el foco entra en
 * la opción marcada (o la primera) y las flechas, Inicio y Fin se mueven por las
 * opciones; con `kind="dialog"` el foco se queda en el botón y el contenido
 * sigue a continuación en el orden de tabulación.
 */
export function Disclosure({ button, buttonClassName, label, title, kind, popLabel, popClassName, wrapClassName, children }: Props) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idPop = useId();

  const cerrar = (devolverFoco: boolean) => {
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  };

  useEffect(() => {
    if (!abierto) return;
    if (kind === 'menu') {
      const items = raiz.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
      const marcado = raiz.current?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"]');
      (marcado ?? items?.[0])?.focus();
    }
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto, kind]);

  const alPulsar = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && abierto) {
      e.preventDefault();
      e.stopPropagation();
      cerrar(true);
    } else if (kind === 'menu') {
      if (abierto && moveMenuFocus(e, raiz.current)) return;
      if (!abierto && e.target === boton.current && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setAbierto(true);
      }
    }
  };
  const alPerderFoco = (e: FocusEvent) => {
    // Tab fuera del desplegable lo cierra sin mover el foco; un clic dentro no cuenta.
    if (abierto && e.relatedTarget instanceof Node && !raiz.current?.contains(e.relatedTarget)) setAbierto(false);
  };

  return (
    <span className={wrapClassName} ref={raiz} onKeyDown={alPulsar} onBlur={alPerderFoco}>
      <button
        ref={boton}
        type="button"
        className={buttonClassName}
        aria-label={label}
        title={title}
        aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'}
        aria-expanded={abierto}
        aria-controls={abierto ? idPop : undefined}
        onClick={() => setAbierto((a) => !a)}
      >
        {button}
      </button>
      {abierto && (
        <div id={idPop} className={popClassName} role={kind === 'menu' ? 'menu' : 'dialog'} aria-label={popLabel}>
          {children(() => cerrar(true))}
        </div>
      )}
    </span>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import type { SessionInfo } from '../../types.ts';
import { MenuItems, moveMenuFocus } from '../ContextMenu.tsx';
import { IconDots } from '../Icons.tsx';
import { useSessionActions } from './useSessionActions.tsx';

/** Menú «Más acciones» de una terminal (las mismas acciones que el menú contextual). */
export function MoreMenu({ session }: { session: SessionInfo }) {
  const [abierto, setAbierto] = useState(false);
  const { actions, dialogs, copied, error, clearError } = useSessionActions(session);
  const raiz = useRef<HTMLDivElement>(null);
  const idMenu = useId();

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false);
        raiz.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      }
    };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    raiz.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  return (
    <div className="menu" ref={raiz}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Más acciones"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={() => setAbierto((a) => !a)}
      >
        <IconDots />
      </button>
      {abierto && (
        <div id={idMenu} className="menu__list" role="menu" aria-label="Más acciones" onKeyDown={(e) => moveMenuFocus(e, raiz.current)}>
          <MenuItems
            actions={actions}
            onPick={(a) => {
              clearError();
              setAbierto(false);
              a.onSelect();
            }}
          />
        </div>
      )}
      <span className="sr-only" role="status">
        {copied ? 'Comando copiado al portapapeles' : ''}
      </span>
      {error && (
        <span className="menu__error" role="alert">
          {error}
        </span>
      )}
      {dialogs}
    </div>
  );
}

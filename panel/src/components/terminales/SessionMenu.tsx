import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { SessionInfo } from '../../types.ts';
import { ContextMenu } from '../ContextMenu.tsx';
import type { MenuAction } from '../ContextMenu.tsx';
import { useSessionActions } from './useSessionActions.tsx';

type Target = { id: number; session: SessionInfo; x: number; y: number; origin: HTMLElement | null };

// Cuánto se ignora un «contextmenu» tras abrir el menú con el teclado: algunos
// navegadores lanzan además ese evento con la tecla ContextMenu. Un clic real
// del ratón (mousedown previo) anula la guarda.
const KEY_GUARD_MS = 500;

/**
 * Menú contextual de las sesiones (clic derecho, tecla ContextMenu o Mayús+F10)
 * para la barra lateral y las pestañas. El llamador pasa `onContextMenu` y
 * `onKeyDown` a cada fila o pestaña y coloca `menu` una sola vez. Solo se
 * intercepta el menú nativo en esos elementos, nunca en la terminal.
 */
export function useSessionMenu(opciones: { withOpen?: boolean; onTabClosed?: () => void } = {}) {
  const [target, setTarget] = useState<Target | null>(null);
  const contador = useRef(0);
  const ultimaTecla = useRef(0);
  const withOpen = opciones.withOpen ?? false;
  const onTabClosed = useRef(opciones.onTabClosed);
  onTabClosed.current = opciones.onTabClosed;
  const alCerrarPestana = useCallback(() => onTabClosed.current?.(), []);

  useEffect(() => {
    const raton = () => {
      ultimaTecla.current = 0;
    };
    window.addEventListener('mousedown', raton, true);
    return () => window.removeEventListener('mousedown', raton, true);
  }, []);

  const abrir = useCallback((session: SessionInfo, x: number, y: number, origin: HTMLElement | null) => {
    contador.current += 1;
    setTarget({ id: contador.current, session, x, y, origin });
  }, []);

  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>, session: SessionInfo, origin?: HTMLElement | null) => {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - ultimaTecla.current < KEY_GUARD_MS) return;
      abrir(session, e.clientX, e.clientY, origin ?? e.currentTarget);
    },
    [abrir],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, session: SessionInfo, origin?: HTMLElement | null) => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      ultimaTecla.current = Date.now();
      const el = origin ?? e.currentTarget;
      const caja = el.getBoundingClientRect();
      // Bajo el elemento y algo hacia dentro, como un menú desplegado desde él.
      abrir(session, caja.left + Math.min(24, caja.width / 2), caja.bottom - 4, el);
    },
    [abrir],
  );

  const alTerminar = useCallback((id: number) => setTarget((t) => (t?.id === id ? null : t)), []);
  const menu: ReactNode = target ? <SessionMenuHost key={target.id} target={target} withOpen={withOpen} onTabClosed={alCerrarPestana} onDone={alTerminar} /> : null;
  return { menu, open: target !== null, onContextMenu, onKeyDown };
}

const ERROR_MS = 4000;

type HostProps = { target: Target; withOpen: boolean; onTabClosed: () => void; onDone: (id: number) => void };

function SessionMenuHost({ target, withOpen, onTabClosed, onDone }: HostProps) {
  const { session, x, y, origin, id } = target;
  const { actions, dialogs, dialogOpen, copied, error, clearError } = useSessionActions(session, { withOpen, onTabClosed });
  const [menuAbierto, setMenuAbierto] = useState(true);
  const devolverFoco = useRef(false);
  const habiaDialogo = useRef(false);

  // Al cerrarse un diálogo, el foco vuelve a la fila o pestaña (si sigue ahí).
  useEffect(() => {
    if (habiaDialogo.current && !dialogOpen) devolverFoco.current = true;
    habiaDialogo.current = dialogOpen;
  }, [dialogOpen]);

  // Un fallo sin diálogo (copiar) se avisa unos segundos y se retira.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(clearError, ERROR_MS);
    return () => window.clearTimeout(t);
  }, [error, clearError]);

  // El anfitrión sigue montado mientras haya menú, diálogo o aviso; después se retira.
  useEffect(() => {
    if (menuAbierto || dialogOpen || error || copied) return;
    if (devolverFoco.current && origin?.isConnected) origin.focus();
    onDone(id);
  }, [menuAbierto, dialogOpen, error, copied, origin, id, onDone]);

  const cerrar = (devolver: boolean) => {
    if (devolver) devolverFoco.current = true;
    setMenuAbierto(false);
  };
  const elegir = (a: MenuAction) => {
    if (a.restoreFocus) devolverFoco.current = true;
    setMenuAbierto(false);
    a.onSelect();
  };

  return (
    <>
      {menuAbierto && <ContextMenu label={`Acciones de ${session.title}`} actions={actions} x={x} y={y} onClose={cerrar} onPick={elegir} />}
      {dialogs}
      <span className="sr-only" role="status">
        {copied ? 'Comando copiado al portapapeles' : ''}
      </span>
      {error && (
        <div className="ctxmenu__error" role="alert" style={{ left: x, top: y }}>
          {error}
        </div>
      )}
    </>
  );
}

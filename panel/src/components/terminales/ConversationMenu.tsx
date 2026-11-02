import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { RecentSession } from '../../types.ts';
import { ContextMenu } from '../ContextMenu.tsx';
import type { MenuAction } from '../ContextMenu.tsx';
import { IconArchive, IconClock } from '../Icons.tsx';

type Target = { id: number; recent: RecentSession; x: number; y: number; origin: HTMLElement | null };

// Igual que en el menú de las sesiones: algunos navegadores lanzan además «contextmenu»
// con la tecla ContextMenu; un clic real del ratón anula la guarda.
const KEY_GUARD_MS = 500;
const ERROR_MS = 4000;

/**
 * Menú contextual de las conversaciones de «Anteriores» y de «Archivadas»
 * (clic derecho, tecla ContextMenu o Mayús+F10): Retomar y Archivar o
 * Desarchivar. Como el de las sesiones, el llamador pasa `onContextMenu` y
 * `onKeyDown` a cada fila y coloca `menu` una sola vez; `open` indica si hay un
 * menú abierto.
 */
export function useConversationMenu() {
  const [target, setTarget] = useState<Target | null>(null);
  const contador = useRef(0);
  const ultimaTecla = useRef(0);

  useEffect(() => {
    const raton = () => {
      ultimaTecla.current = 0;
    };
    window.addEventListener('mousedown', raton, true);
    return () => window.removeEventListener('mousedown', raton, true);
  }, []);

  const abrir = useCallback((recent: RecentSession, x: number, y: number, origin: HTMLElement | null) => {
    contador.current += 1;
    setTarget({ id: contador.current, recent, x, y, origin });
  }, []);

  const onContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>, recent: RecentSession) => {
      e.preventDefault();
      e.stopPropagation();
      if (Date.now() - ultimaTecla.current < KEY_GUARD_MS) return;
      abrir(recent, e.clientX, e.clientY, e.currentTarget);
    },
    [abrir],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, recent: RecentSession) => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      ultimaTecla.current = Date.now();
      const caja = e.currentTarget.getBoundingClientRect();
      abrir(recent, caja.left + Math.min(24, caja.width / 2), caja.bottom - 4, e.currentTarget);
    },
    [abrir],
  );

  const alTerminar = useCallback((id: number) => setTarget((t) => (t?.id === id ? null : t)), []);
  const menu: ReactNode = target ? <Host key={target.id} target={target} onDone={alTerminar} /> : null;
  return { menu, open: target !== null, onContextMenu, onKeyDown };
}

function Host({ target, onDone }: { target: Target; onDone: (id: number) => void }) {
  const { recent, x, y, origin, id } = target;
  const { openResume } = useWorkspace();
  const { setArchived } = useSessions();
  const [menuAbierto, setMenuAbierto] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const devolverFoco = useRef(false);

  // Un fallo se avisa unos segundos y se retira.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), ERROR_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (menuAbierto || error) return;
    if (devolverFoco.current && origin?.isConnected) origin.focus();
    onDone(id);
  }, [menuAbierto, error, origin, id, onDone]);

  const actions: MenuAction[] = [
    { id: 'retomar', label: 'Retomar en el panel…', icon: <IconClock size={14} />, onSelect: () => openResume(recent) },
    {
      id: 'archivar',
      label: recent.archived ? 'Desarchivar' : 'Archivar',
      icon: <IconArchive size={14} />,
      onSelect: () => {
        setArchived('conversation', recent.id, !recent.archived).catch((e: unknown) =>
          setError(e instanceof Error ? e.message : 'No se pudo archivar la conversación.'),
        );
      },
    },
  ];

  return (
    <>
      {menuAbierto && (
        <ContextMenu
          label={`Acciones de ${recent.title}`}
          actions={actions}
          x={x}
          y={y}
          onClose={(devolver) => {
            if (devolver) devolverFoco.current = true;
            setMenuAbierto(false);
          }}
          onPick={(a) => {
            if (a.restoreFocus) devolverFoco.current = true;
            setMenuAbierto(false);
            a.onSelect();
          }}
        />
      )}
      {error && (
        <div className="ctxmenu__error" role="alert" style={{ left: x, top: y }}>
          {error}
        </div>
      )}
    </>
  );
}

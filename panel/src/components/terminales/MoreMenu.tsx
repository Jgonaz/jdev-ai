import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { attachCommand } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import { IconCopy, IconClose, IconDots, IconStop } from '../Icons.tsx';
import { Modal } from '../Modal.tsx';

/** Menú «Más acciones» de una terminal. */
export function MoreMenu({ session }: { session: SessionInfo }) {
  const { closeTab } = useWorkspace();
  const { tmuxSocket } = useSessions();
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [terminando, setTerminando] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const copiar = async () => {
    try {
      if (!tmuxSocket) throw new Error('socket de tmux desconocido');
      await navigator.clipboard.writeText(attachCommand(session.name, tmuxSocket));
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      setError('No se pudo copiar al portapapeles.');
    }
    setAbierto(false);
  };

  const terminar = async () => {
    setTerminando(true);
    setError(null);
    try {
      await api.killSession(session.name);
      closeTab(session.name);
      setConfirmando(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTerminando(false);
    }
  };

  // Navegación con flechas dentro del menú.
  const alPulsar = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

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
        <div id={idMenu} className="menu__list" role="menu" aria-label="Más acciones" onKeyDown={alPulsar}>
          <button type="button" role="menuitem" className="menu__item" onClick={() => void copiar()}>
            <IconCopy size={14} />
            Copiar comando para adjuntar
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              setAbierto(false);
              closeTab(session.name);
            }}
          >
            <IconClose size={14} />
            Cerrar terminal en el panel
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item menu__item--danger"
            onClick={() => {
              setAbierto(false);
              setConfirmando(true);
            }}
          >
            <IconStop size={14} />
            Terminar sesión…
          </button>
        </div>
      )}
      <span className="sr-only" role="status">
        {copiado ? 'Comando copiado al portapapeles' : ''}
      </span>
      {error && !confirmando && (
        <span className="menu__error" role="alert">
          {error}
        </span>
      )}
      {confirmando && (
        <Modal
          title="Terminar sesión"
          role="alertdialog"
          width={460}
          initialFocus="[data-cancel]"
          onClose={() => !terminando && setConfirmando(false)}
          footer={
            <>
              <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={() => setConfirmando(false)} disabled={terminando}>
                Cancelar
              </button>
              <button type="button" className="btn btn--danger btn--lg" onClick={() => void terminar()} disabled={terminando}>
                {terminando ? 'Terminando…' : 'Terminar sesión'}
              </button>
            </>
          }
        >
          <p className="confirm-text">
            Se cerrará la sesión de tmux «{session.title}» y el agente que se ejecuta en ella. No se puede deshacer.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

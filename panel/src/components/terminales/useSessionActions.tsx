import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../api.ts';
import { attachCommand } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import type { MenuAction } from '../ContextMenu.tsx';
import { IconArchive, IconClose, IconCopy, IconExternal, IconPencil, IconStop } from '../Icons.tsx';
import { Modal } from '../Modal.tsx';
import { RenameDialog } from './RenameDialog.tsx';

type Dialogo = 'renombrar' | 'terminar' | null;

export type SessionActions = {
  actions: MenuAction[];
  /** Diálogos de renombrar y terminar: el llamador los renderiza junto a su menú. */
  dialogs: ReactNode;
  /** Hay un diálogo abierto. */
  dialogOpen: boolean;
  copied: boolean;
  /** Fallo de una acción sin diálogo (p. ej. copiar al portapapeles). */
  error: string | null;
  clearError: () => void;
};

/**
 * Acciones de una sesión del panel que comparten «Más acciones» y el menú
 * contextual de la barra lateral y de las pestañas: Abrir (solo con `withOpen`
 * y si no está abierta en una pestaña), Renombrar, Copiar comando para
 * adjuntar, Archivar o Desarchivar, Cerrar pestaña (solo si está abierta) y
 * Terminar sesión.
 */
export function useSessionActions(session: SessionInfo, opciones: { withOpen?: boolean; onTabClosed?: () => void } = {}): SessionActions {
  const { closeTab, openSession, workspace } = useWorkspace();
  const { tmuxSocket, setArchived } = useSessions();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminando, setTerminando] = useState(false);
  const [errorTerminar, setErrorTerminar] = useState<string | null>(null);
  const abierta = workspace.tabs.includes(session.name);

  const copiar = async () => {
    try {
      if (!tmuxSocket) throw new Error('socket de tmux desconocido');
      await navigator.clipboard.writeText(attachCommand(session.name, tmuxSocket));
      setError(null);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('No se pudo copiar al portapapeles.');
    }
  };

  // Archivar solo aparta la fila: la sesión y su pestaña siguen como estaban.
  const archivar = async () => {
    try {
      await setArchived('session', session.name, !session.archived);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar la sesión.');
    }
  };

  const terminar = async () => {
    setTerminando(true);
    setErrorTerminar(null);
    try {
      await api.killSession(session.name);
      closeTab(session.name);
      setDialogo(null);
    } catch (e) {
      setErrorTerminar(e instanceof Error ? e.message : String(e));
    } finally {
      setTerminando(false);
    }
  };

  const actions: MenuAction[] = [];
  if (opciones.withOpen && !abierta) {
    actions.push({
      id: 'abrir',
      label: 'Abrir',
      icon: <IconExternal size={14} />,
      onSelect: () => openSession(session.name),
    });
  }
  actions.push(
    { id: 'renombrar', label: 'Renombrar…', icon: <IconPencil size={14} />, onSelect: () => setDialogo('renombrar') },
    { id: 'copiar', label: 'Copiar comando para adjuntar', icon: <IconCopy size={14} />, restoreFocus: true, onSelect: () => void copiar() },
  );
  actions.push({
    id: 'archivar',
    label: session.archived ? 'Desarchivar' : 'Archivar',
    icon: <IconArchive size={14} />,
    onSelect: () => void archivar(),
  });
  if (abierta) {
    actions.push({
      id: 'cerrar',
      label: 'Cerrar pestaña',
      icon: <IconClose size={14} />,
      onSelect: () => {
        closeTab(session.name);
        opciones.onTabClosed?.();
      },
    });
  }
  actions.push({
    id: 'terminar',
    label: 'Terminar sesión…',
    icon: <IconStop size={14} />,
    danger: true,
    onSelect: () => {
      setErrorTerminar(null);
      setDialogo('terminar');
    },
  });

  const dialogs = (
    <>
      {dialogo === 'renombrar' && <RenameDialog session={session} onClose={() => setDialogo(null)} />}
      {dialogo === 'terminar' && (
        <Modal
          title="Terminar sesión"
          role="alertdialog"
          width={460}
          initialFocus="[data-cancel]"
          onClose={() => !terminando && setDialogo(null)}
          footer={
            <>
              <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={() => setDialogo(null)} disabled={terminando}>
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
          {errorTerminar && (
            <p className="form-error" role="alert">
              {errorTerminar}
            </p>
          )}
        </Modal>
      )}
    </>
  );

  return { actions, dialogs, dialogOpen: dialogo !== null, copied, error, clearError: () => setError(null) };
}

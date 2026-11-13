import { useState } from 'react';
import type { ReactNode } from 'react';
import { MARK_DONE_LABEL, REOPEN_LABEL } from '../../lib/done.ts';
import { attachCommand, isShell } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import type { MenuAction } from '../ContextMenu.tsx';
import { IconArchive, IconCheck, IconClose, IconCopy, IconExternal, IconPencil, IconRestore, IconStop, IconTrash } from '../Icons.tsx';
import { DeleteArchivedDialog } from './DeleteArchivedDialog.tsx';
import { RenameDialog } from './RenameDialog.tsx';
import { TerminateDialog } from './TerminateDialog.tsx';

type Dialogo = 'renombrar' | 'terminar' | 'eliminar' | null;

export type SessionActions = {
  actions: MenuAction[];
  /** Diálogos de renombrar y terminar: el llamador los renderiza junto a su menú. */
  dialogs: ReactNode;
  /** Hay un diálogo abierto. */
  dialogOpen: boolean;
  /** Hay una acción sin diálogo en curso (marcar como hecha, archivar...): el menú no debe desmontarse hasta que acabe. */
  busy: boolean;
  copied: boolean;
  /** Fallo de una acción sin diálogo (p. ej. copiar al portapapeles). */
  error: string | null;
  clearError: () => void;
};

/**
 * Acciones de una sesión del panel que comparten «Más acciones» y el menú
 * contextual de la barra lateral y de las pestañas: Abrir (solo con `withOpen`
 * y si no está abierta en una pestaña), Renombrar, Copiar comando para
 * adjuntar, Marcar como hecha o Reabrir (no en las terminales sin agente),
 * Archivar o Desarchivar, Cerrar pestaña (solo si está abierta), Terminar
 * sesión y, si está archivada, Eliminar definitivamente.
 */
export function useSessionActions(session: SessionInfo, opciones: { withOpen?: boolean; onTabClosed?: () => void } = {}): SessionActions {
  const { closeTab, openSession, workspace } = useWorkspace();
  const { tmuxSocket, setArchived, setDone } = useSessions();
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // Una acción de red sin diálogo: mientras dura, `busy` mantiene vivo el menú para que un fallo se avise.
  const conAviso = async (accion: () => Promise<void>, fallo: string) => {
    setBusy(true);
    try {
      await accion();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : fallo);
    } finally {
      setBusy(false);
    }
  };

  // Archivar solo aparta la fila: la sesión y su pestaña siguen como estaban.
  const archivar = () => conAviso(() => setArchived('session', session.name, !session.archived), 'No se pudo archivar la sesión.');

  // Marcarla como hecha no termina ni archiva la sesión: solo cambia su estado.
  const alternarHecha = () =>
    conAviso(() => setDone(session.conversationKey, session.done ? 'open' : 'done'), 'No se pudo cambiar el estado de la conversación.');

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
  if (!isShell(session)) {
    actions.push({
      id: 'hecha',
      label: session.done ? REOPEN_LABEL : MARK_DONE_LABEL,
      icon: session.done ? <IconRestore size={14} /> : <IconCheck size={14} />,
      onSelect: () => void alternarHecha(),
    });
  }
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
    onSelect: () => setDialogo('terminar'),
  });
  if (session.archived) {
    actions.push({
      id: 'eliminar',
      label: 'Eliminar definitivamente…',
      icon: <IconTrash size={14} />,
      danger: true,
      onSelect: () => setDialogo('eliminar'),
    });
  }

  const dialogs = (
    <>
      {dialogo === 'renombrar' && <RenameDialog session={session} onClose={() => setDialogo(null)} />}
      {dialogo === 'terminar' && <TerminateDialog session={session} onClose={() => setDialogo(null)} />}
      {dialogo === 'eliminar' && (
        <DeleteArchivedDialog target={{ kind: 'session', id: session.name, title: session.title, shell: isShell(session) }} onClose={() => setDialogo(null)} />
      )}
    </>
  );

  return { actions, dialogs, dialogOpen: dialogo !== null, busy, copied, error, clearError: () => setError(null) };
}

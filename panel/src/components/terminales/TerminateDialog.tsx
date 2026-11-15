import { useState } from 'react';
import { api } from '../../api.ts';
import { isShell } from '../../lib/sessions.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import { Modal } from '../Modal.tsx';

type Props = {
  session: SessionInfo;
  onClose: () => void;
  /**
   * Al cerrar la pestaña de una sesión hecha: el diálogo ofrece también dejarla
   * en segundo plano, que solo cierra la pestaña (la sesión sigue viva en tmux).
   */
  onKeepInBackground?: () => void;
};

/** Confirmación para terminar una sesión: cierra su sesión de tmux y, con ella, el agente. */
export function TerminateDialog({ session, onClose, onKeepInBackground }: Props) {
  const { closeTab } = useWorkspace();
  const [terminando, setTerminando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminar = async () => {
    setTerminando(true);
    setError(null);
    try {
      await api.killSession(session.name);
      closeTab(session.name);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTerminando(false);
    }
  };

  return (
    <Modal
      title={onKeepInBackground ? 'Cerrar sesión hecha' : 'Terminar sesión'}
      role="alertdialog"
      width={onKeepInBackground ? 520 : 460}
      initialFocus={onKeepInBackground ? '[data-keep]' : '[data-cancel]'}
      onClose={() => !terminando && onClose()}
      footer={
        <>
          <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={onClose} disabled={terminando}>
            Cancelar
          </button>
          {onKeepInBackground && (
            <button type="button" data-keep className="btn btn--outline btn--lg" onClick={onKeepInBackground} disabled={terminando}>
              Dejar en segundo plano
            </button>
          )}
          <button type="button" className="btn btn--danger btn--lg" onClick={() => void terminar()} disabled={terminando}>
            {terminando ? 'Terminando…' : 'Terminar sesión'}
          </button>
        </>
      }
    >
      {onKeepInBackground && (
        <p className="confirm-text">
          «{session.title}» está marcada como hecha. Puedes terminar la sesión o dejarla en segundo plano para volver a ella desde la barra lateral.
        </p>
      )}
      <p className="confirm-text">
        {onKeepInBackground ? 'Si la terminas, se cerrará' : 'Se cerrará'} la sesión de tmux «{session.title}» y {isShell(session) ? 'la shell y los procesos que se ejecutan en ella' : 'el agente que se ejecuta en ella'}. No se puede deshacer.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

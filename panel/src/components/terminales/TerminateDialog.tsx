import { useState } from 'react';
import { api } from '../../api.ts';
import { isShell } from '../../lib/sessions.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import { Modal } from '../Modal.tsx';

/** Confirmación para terminar una sesión: cierra su sesión de tmux y, con ella, el agente. */
export function TerminateDialog({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
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
      title="Terminar sesión"
      role="alertdialog"
      width={460}
      initialFocus="[data-cancel]"
      onClose={() => !terminando && onClose()}
      footer={
        <>
          <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={onClose} disabled={terminando}>
            Cancelar
          </button>
          <button type="button" className="btn btn--danger btn--lg" onClick={() => void terminar()} disabled={terminando}>
            {terminando ? 'Terminando…' : 'Terminar sesión'}
          </button>
        </>
      }
    >
      <p className="confirm-text">
        Se cerrará la sesión de tmux «{session.title}» y {isShell(session) ? 'la shell y los procesos que se ejecutan en ella' : 'el agente que se ejecuta en ella'}. No se puede deshacer.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

import { useState } from 'react';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { Modal } from '../Modal.tsx';

type Objetivo = { kind: 'session'; id: string; title: string; shell: boolean } | { kind: 'conversation'; id: string; title: string };

/**
 * Confirmación para eliminar definitivamente algo archivado. Una conversación
 * pierde su transcript de Claude; una sesión se termina y pierde también el
 * suyo. No se puede deshacer, ni desde el panel ni con `claude --resume`.
 */
export function DeleteArchivedDialog({ target, onClose }: { target: Objetivo; onClose: () => void }) {
  const { deleteArchived } = useSessions();
  const { closeTab } = useWorkspace();
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eliminar = async () => {
    setBorrando(true);
    setError(null);
    try {
      await deleteArchived(target.kind, target.id);
      if (target.kind === 'session') closeTab(target.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBorrando(false);
    }
  };

  const texto =
    target.kind === 'conversation'
      ? `Se borrará del disco la conversación «${target.title}», con su transcript y el de sus subagentes. Ya no se podrá retomar ni desde el panel ni con claude --resume.`
      : target.shell
        ? `Se cerrará la terminal «${target.title}» y los procesos que se ejecutan en ella, y saldrá de Archivadas.`
        : `Se cerrará la sesión «${target.title}» y se borrará del disco su conversación. Ya no se podrá retomar ni desde el panel ni con claude --resume.`;

  return (
    <Modal
      title="Eliminar definitivamente"
      role="alertdialog"
      width={480}
      initialFocus="[data-cancel]"
      onClose={() => !borrando && onClose()}
      footer={
        <>
          <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={onClose} disabled={borrando}>
            Cancelar
          </button>
          <button type="button" className="btn btn--danger btn--lg" onClick={() => void eliminar()} disabled={borrando}>
            {borrando ? 'Eliminando…' : 'Eliminar definitivamente'}
          </button>
        </>
      }
    >
      <p className="confirm-text">{texto} No se puede deshacer.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

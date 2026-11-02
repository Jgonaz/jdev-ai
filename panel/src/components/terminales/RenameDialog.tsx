import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { SESSION_TITLE_MAX, checkSessionTitle } from '../../../shared/session-title.ts';
import { api } from '../../api.ts';
import type { SessionInfo } from '../../types.ts';
import { Modal } from '../Modal.tsx';

/**
 * Diálogo para renombrar una sesión. Enter guarda y Escape cancela. Parte del
 * título sin la marca «[Closed] » (la gestiona el panel: el servidor la conserva).
 */
export function RenameDialog({ session, onClose }: { session: SessionInfo; onClose: () => void }) {
  const [titulo, setTitulo] = useState(session.title);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idCampo = useId();
  const idError = useId();
  const idForm = useId();
  const comprobacion = checkSessionTitle(titulo);
  const longitud = Array.from(titulo.trim()).length;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    if (!comprobacion.ok) {
      setError(comprobacion.error);
      return;
    }
    if (comprobacion.title === session.title) {
      onClose();
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.renameSession(session.name, comprobacion.title);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGuardando(false);
    }
  };

  return (
    <Modal
      title="Renombrar sesión"
      width={460}
      initialFocus="input"
      onClose={() => !guardando && onClose()}
      footer={
        <>
          <button type="button" className="btn btn--ghost btn--lg footer-push" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" form={idForm} className="btn btn--accent btn--lg" disabled={guardando || !comprobacion.ok}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <form id={idForm} className="field" onSubmit={(e) => void guardar(e)}>
        <label htmlFor={idCampo} className="field__label">
          Título de la sesión
        </label>
        <input
          id={idCampo}
          className="input"
          type="text"
          value={titulo}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null || !comprobacion.ok}
          aria-describedby={idError}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setTitulo(e.target.value);
            setError(null);
          }}
        />
        <span id={idError} className={error || !comprobacion.ok ? 'field__error' : 'field__note'} role={error ? 'alert' : undefined}>
          {error ?? (comprobacion.ok ? `${longitud}/${SESSION_TITLE_MAX} caracteres` : comprobacion.error)}
        </span>
      </form>
    </Modal>
  );
}

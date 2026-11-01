import { useEffect, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { agoLabel, openElsewhereNotice, recentPlace, resumeRequest } from '../lib/recent.ts';
import { useNow } from '../lib/useNow.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { RecentSession } from '../types.ts';
import { IconRestore } from './Icons.tsx';
import { Modal } from './Modal.tsx';

type Preview =
  | { estado: 'pendiente' }
  | { estado: 'ok'; comando: string }
  | { estado: 'error'; mensaje: string };

/**
 * Confirmación de «Retomar en el panel». Avisa de que la sesión debe cerrarse en
 * su ventana original (dos procesos sobre la misma conversación se pisarían) y
 * destaca las que tienen actividad muy reciente.
 */
export function ResumeDialog({ recent, onCreated }: { recent: RecentSession; onCreated: () => void }) {
  const { upsert, reloadRecent, projects } = useSessions();
  const { closeResume, openSession } = useWorkspace();
  const ahora = useNow(15_000);
  const [preview, setPreview] = useState<Preview>({ estado: 'pendiente' });
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const peticion = resumeRequest(recent);
  const aviso = openElsewhereNotice(recent, ahora);
  const proyecto = projects.find((p) => p.id === recent.project);

  useEffect(() => {
    setPreview({ estado: 'pendiente' });
    const control = new AbortController();
    api
      .previewSession(resumeRequest(recent), control.signal)
      .then((r) => setPreview({ estado: 'ok', comando: r.command }))
      .catch((e: unknown) => {
        if (control.signal.aborted) return;
        setPreview({ estado: 'error', mensaje: e instanceof ApiError ? e.message : 'No se pudo calcular el comando.' });
      });
    return () => control.abort();
  }, [recent]);

  const retomar = async () => {
    if (enviando || preview.estado !== 'ok') return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const r = await api.createSession(peticion);
      upsert(r.session);
      openSession(r.session.name);
      closeResume();
      onCreated();
      reloadRecent();
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : String(e));
      setEnviando(false);
    }
  };

  return (
    <Modal
      title="Retomar en el panel"
      role="alertdialog"
      width={560}
      initialFocus="[data-cancel]"
      onClose={() => !enviando && closeResume()}
      footer={
        <>
          <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={closeResume} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" className="btn btn--accent btn--lg" disabled={enviando || preview.estado !== 'ok'} onClick={() => void retomar()}>
            <IconRestore size={14} />
            {enviando ? 'Retomando…' : 'Retomar en el panel'}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="resume-session">
          <span className="resume-session__title">{recent.title}</span>
          <span className="resume-session__meta">
            {proyecto?.name ?? recent.project} · {recentPlace(recent)} · {agoLabel(recent.lastActivity, ahora)}
          </span>
        </div>
        {aviso && (
          <p className="resume-warning" role="alert">
            <strong>{aviso}</strong>
          </p>
        )}
        <p className="confirm-text">
          Cierra la sesión en su ventana original antes de retomarla. Si queda abierta, habrá dos procesos sobre la misma conversación y
          pueden pisarse el historial.
        </p>
        <div className="field">
          <span className="field__note">Se ejecutará en una sesión de tmux</span>
          <div className={`command command--${preview.estado}`} aria-live="polite">
            {preview.estado === 'ok' && <code>{preview.comando}</code>}
            {preview.estado === 'pendiente' && <span className="command__msg">Calculando el comando…</span>}
            {preview.estado === 'error' && (
              <span className="command__msg command__msg--error" role="alert">
                {preview.mensaje}
              </span>
            )}
          </div>
          {errorEnvio && (
            <p className="form-error" role="alert">
              {errorEnvio}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

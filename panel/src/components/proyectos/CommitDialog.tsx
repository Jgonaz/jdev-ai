import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, commitBacklog } from '../../api.ts';
import { commitOutcome, fileChangeLabel, loadPushPreference, phaseLabel, pushTargetNote, savePushPreference } from '../../lib/backlogCommit.ts';
import type { CommitOutcome } from '../../lib/backlogCommit.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import type { CommitPhase, CommitPreview } from '../../types.ts';
import { Modal } from '../Modal.tsx';

type Vista = { estado: 'cargando' } | { estado: 'ok'; data: CommitPreview } | { estado: 'error'; mensaje: string };

/**
 * «Confirmar cambios» del backlog: archivos, rama, mensaje editable y push
 * opcional. El commit solo incluye docs/backlog/ y respeta los hooks del
 * proyecto; si fallan, se muestra su salida.
 */
export function CommitDialog(props: { project: string; onClose: () => void; onFinished: () => void }) {
  const { project, onClose, onFinished } = props;
  const { onBacklogCommitPhase } = useSessions();
  const [vista, setVista] = useState<Vista>({ estado: 'cargando' });
  const [mensaje, setMensaje] = useState('');
  const [push, setPush] = useState(() => loadPushPreference());
  const [enviando, setEnviando] = useState(false);
  const [fase, setFase] = useState<CommitPhase | null>(null);
  const [resultado, setResultado] = useState<CommitOutcome | null>(null);
  const propuesto = useRef('');
  const areaMensaje = useRef<HTMLTextAreaElement>(null);
  const enfocado = useRef(false);
  const idMensaje = useId();
  const idNota = useId();

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      api
        .commitPreview(project, signal)
        .then((data) => {
          // Si la persona no ha editado el mensaje, se sustituye por la nueva propuesta.
          setMensaje((m) => (m === '' || m === propuesto.current ? data.message : m));
          propuesto.current = data.message;
          setVista({ estado: 'ok', data });
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return;
          setVista({ estado: 'error', mensaje: e instanceof Error ? e.message : String(e) });
        });
    },
    [project],
  );

  useEffect(() => {
    const ctl = new AbortController();
    cargar(ctl.signal);
    return () => ctl.abort();
  }, [cargar]);

  // El mensaje llega tras abrir: se enfoca la primera vez que aparece.
  useEffect(() => {
    if (vista.estado === 'ok' && !enfocado.current && areaMensaje.current) {
      enfocado.current = true;
      areaMensaje.current.focus();
    }
  }, [vista]);

  useEffect(() => {
    if (!enviando) return;
    return onBacklogCommitPhase((p, f) => {
      if (p === project) setFase(f);
    });
  }, [enviando, project, onBacklogCommitPhase]);

  const datos = vista.estado === 'ok' ? vista.data : null;
  const hayRemoto = !!datos?.remote;
  const subir = push && hayRemoto;
  const hecho = resultado?.done === true;
  const puedeConfirmar = !!datos && !datos.detached && datos.files.length > 0 && mensaje.trim() !== '' && !enviando && !hecho;

  const cambiarPush = (v: boolean) => {
    setPush(v);
    savePushPreference(v);
  };

  const confirmar = async () => {
    if (!datos || !puedeConfirmar) return;
    setEnviando(true);
    setFase(null);
    setResultado(null);
    const r = await commitBacklog(project, { message: mensaje, push: subir, fingerprint: datos.fingerprint });
    setEnviando(false);
    setFase(null);
    setResultado(commitOutcome(r));
    // 409: la lista cambió (o ya no hay cambios): se recarga la vista previa.
    if (r.kind === 'failed' && r.status === 409) cargar();
    onFinished();
  };

  const cerrar = () => {
    if (!enviando) onClose();
  };

  const nota = datos && (subir || !hayRemoto) ? pushTargetNote(datos) : null;

  return (
    <Modal
      title="Confirmar cambios del backlog"
      width={680}
      onClose={cerrar}
      footer={
        <>
          <label className="check check--footer">
            <input type="checkbox" checked={subir} disabled={!hayRemoto || enviando || hecho} onChange={(e) => cambiarPush(e.target.checked)} />
            Subir también al remoto
          </label>
          <button type="button" className="btn btn--ghost btn--lg footer-push" onClick={cerrar} disabled={enviando}>
            {hecho ? 'Cerrar' : 'Cancelar'}
          </button>
          {!hecho && (
            <button
              type="button"
              className="btn btn--accent btn--lg"
              disabled={!puedeConfirmar}
              aria-describedby={datos?.detached ? idNota : undefined}
              onClick={() => void confirmar()}
            >
              {enviando ? phaseLabel(fase) : 'Confirmar'}
            </button>
          )}
        </>
      }
    >
      <div className="form commit">
        {vista.estado === 'cargando' && <p className="confirm-text">Leyendo los cambios del backlog…</p>}
        {vista.estado === 'error' && (
          <p className="form-error" role="alert">
            {vista.mensaje}
          </p>
        )}
        {datos && (
          <>
            <p className="commit__branch">
              {datos.detached ? (
                <span id={idNota} className="commit__warn" role="alert">
                  HEAD está separado (detached): cambia a una rama en el proyecto para poder hacer el commit.
                </span>
              ) : (
                <>
                  Rama <code>{datos.branch}</code>
                  {datos.upstream && (
                    <>
                      {' '}
                      → <code>{datos.upstream}</code>
                    </>
                  )}
                  {nota && <span className="commit__note"> · {nota}</span>}
                </>
              )}
            </p>
            {datos.files.length === 0 ? (
              <p className="confirm-text">No hay cambios del backlog sin commit.</p>
            ) : (
              <div className="field">
                <span className="field__label">
                  {datos.files.length === 1 ? '1 archivo' : `${datos.files.length} archivos`} de <code>docs/backlog/</code>
                </span>
                <ul className="commit__files">
                  {datos.files.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code> <span className="commit__change">{fileChangeLabel(f)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="field">
              <label htmlFor={idMensaje}>
                Mensaje del commit{' '}
                <span className="field__note">Solo entra docs/backlog/; el resto de cambios del proyecto no se toca.</span>
              </label>
              <textarea
                id={idMensaje}
                ref={areaMensaje}
                className="input input--area commit__message"
                rows={8}
                spellCheck={false}
                value={mensaje}
                disabled={enviando || hecho}
                maxLength={10_000}
                onChange={(e) => setMensaje(e.target.value)}
              />
            </div>
          </>
        )}
        <div aria-live="polite">
          {enviando && <p className="confirm-text">Puede tardar unos minutos si el proyecto tiene hooks de pre-commit o pre-push.</p>}
          {resultado && (
            <div className={`commit__result commit__result--${resultado.tone}`} role={resultado.tone === 'ok' ? 'status' : 'alert'}>
              <p>{resultado.text}</p>
              {resultado.output.trim() !== '' && (
                <details open={resultado.tone !== 'ok'}>
                  <summary>Salida de Git</summary>
                  <pre className="command commit__output">{resultado.output}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError, api, setHistoryPending } from '../../api.ts';
import { doneDateLabel, listReload, longDate, resumePrompt, stateClass, stateText } from '../../lib/history.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { HistoryDetail, HistoryEntry, PendingPoint } from '../../types.ts';
import { IconAlert } from '../Icons.tsx';
import { Markdown } from '../Markdown.tsx';

type Notice = { kind: 'warn' | 'error'; text: string };

/** Lector de una entrada: «Pendiente de ti» destacado, secciones y «Retomar desde aquí». */
export function HistoryReader(props: {
  project: string;
  file: string;
  /** La entrada en la lista más reciente, si está: con otro etag se recarga. */
  listEntry: HistoryEntry | undefined;
  /** La lista ya cargada no la incluye: se ha borrado o renombrado. */
  gone: boolean;
  /** Se ha marcado un pendiente: la lista debe refrescarse. */
  onChanged: () => void;
}) {
  const { project, file, listEntry, gone, onChanged } = props;
  const { openDialog } = useWorkspace();
  const [detalle, setDetalle] = useState<HistoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Notice | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const seq = useRef(0);
  const idTitulo = useId();
  const idPendiente = useId();

  const cargar = useCallback(() => {
    const n = ++seq.current;
    api
      .historyEntry(project, file)
      .then((d) => {
        if (n !== seq.current) return;
        setDetalle(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (n !== seq.current) return;
        setDetalle(null);
        setError(e instanceof ApiError && e.status === 404 ? 'Esta entrada ya no existe.' : e instanceof Error ? e.message : String(e));
      });
  }, [project, file]);

  useEffect(() => cargar(), [cargar]);

  // La lista trae otra versión (el agente ha actualizado la entrada): se
  // recarga una vez por cada etag de lista nuevo, nunca por cambiar el detalle.
  const etagLista = listEntry?.etag;
  const etagDetalle = detalle?.etag;
  const etagTratado = useRef<string | undefined>(undefined);
  useEffect(() => {
    const r = listReload({ listEtag: etagLista, handled: etagTratado.current, detailEtag: etagDetalle, busy: ocupado !== null });
    etagTratado.current = r.handled;
    if (r.reload) cargar();
  }, [etagLista, etagDetalle, ocupado, cargar]);

  const marcar = async (p: PendingPoint) => {
    if (!detalle || gone || ocupado !== null) return;
    setOcupado(p.index);
    setAviso(null);
    const r = await setHistoryPending(project, file, p.index, !p.done, detalle.etag);
    setOcupado(null);
    if (r.ok) {
      setDetalle(r.entry);
      onChanged();
      return;
    }
    if (r.status === 409) {
      if (r.entry) setDetalle(r.entry);
      else cargar();
      setAviso({ kind: 'warn', text: 'Ha cambiado mientras la tenías abierta; te muestro la versión actual.' });
      onChanged();
      return;
    }
    setAviso({ kind: 'error', text: r.status === 0 ? `${r.error} No se ha marcado nada.` : r.error });
  };

  const retomar = () => {
    if (detalle) openDialog({ project: detalle.project, prompt: resumePrompt(detalle.file) });
  };

  // Sin la entrada en la lista no se enseña la versión vieja ni se deja marcar.
  const mensaje = gone ? 'Esta entrada ya no existe.' : error;
  if (!detalle || gone) {
    return (
      <article className="hreader hreader--empty" aria-busy={mensaje ? undefined : true}>
        {mensaje ? (
          <p className="hlist__error" role="alert">
            {mensaje}
          </p>
        ) : (
          <p>Cargando entrada…</p>
        )}
      </article>
    );
  }

  const secciones = detalle.sections.filter((s) => s.body.trim() !== '');
  const conPendiente = detalle.pending.length > 0 || detalle.pendingNotes !== '';

  return (
    <article className="hreader" aria-labelledby={idTitulo}>
      <div className="hreader__inner">
        <div className="hreader__path">
          <span>{detalle.project}</span>
          <span aria-hidden="true">·</span>
          <span>{detalle.path}</span>
        </div>
        <header className="hreader__head">
          <h1 className="hreader__title" id={idTitulo}>
            {detalle.title}
          </h1>
          <div className="hreader__meta">
            <span className={`hchip hchip--${stateClass(detalle.state)}`} title={detalle.rawState ?? undefined}>
              {stateText(detalle.state)}
            </span>
            <span className="hreader__date">
              {longDate(detalle.date)}
              {detalle.approxDate && <span className="hreader__approx"> · fecha aproximada</span>}
            </span>
          </div>
        </header>

        <div className="hreader__live" aria-live="polite">
          {aviso && (
            <p className={`ddet__notice ddet__notice--${aviso.kind}`} role={aviso.kind === 'error' ? 'alert' : undefined}>
              <IconAlert size={14} />
              {aviso.text}
            </p>
          )}
        </div>

        {conPendiente && (
          <section className="hpending" aria-labelledby={idPendiente}>
            <h2 className="hpending__title" id={idPendiente}>
              <span className="hpending__dot" aria-hidden="true" />
              Pendiente de ti
            </h2>
            {detalle.pending.length > 0 && (
              <ul className="hpending__list">
                {detalle.pending.map((p) => (
                  <li key={p.index} className={p.done ? 'hpoint hpoint--done' : 'hpoint'}>
                    <div className="hpoint__text">
                      <Markdown source={p.text} />
                      {p.done && (
                        <span className="hpoint__when">{p.doneDate ? `Hecho el ${doneDateLabel(p.doneDate)}` : 'Hecho'}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn--sm hpoint__btn"
                      onClick={() => void marcar(p)}
                      disabled={ocupado !== null}
                      aria-busy={ocupado === p.index ? true : undefined}
                    >
                      {p.done ? 'Desmarcar' : 'Marcar como hecho'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {detalle.pendingNotes !== '' && <Markdown source={detalle.pendingNotes} className="hpending__notes" />}
          </section>
        )}

        {secciones.map((s, i) => (
          <section key={i} className="hsection">
            {s.title !== '' && <h2 className="hsection__title">{s.title}</h2>}
            <Markdown source={s.body} className="hsection__body" />
          </section>
        ))}

        <div className="hreader__actions">
          <button type="button" className="btn btn--accent btn--lg" onClick={retomar}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true" focusable="false">
              <path d="M4 17l6-5-6-5M12 19h8" />
            </svg>
            Retomar desde aquí
          </button>
        </div>
      </div>
    </article>
  );
}

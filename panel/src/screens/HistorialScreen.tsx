import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, markOldPending } from '../api.ts';
import { IconAlert } from '../components/Icons.tsx';
import { Modal } from '../components/Modal.tsx';
import { Monogram } from '../components/Monogram.tsx';
import { ResizeHandle } from '../components/ResizeHandle.tsx';
import { HistoryReader } from '../components/historial/Reader.tsx';
import {
  HISTORY_COLLAPSED,
  NO_HISTORY_FILTERS,
  STATE_OPTIONS,
  entryKey,
  entryTime,
  filterEntries,
  groupByDay,
  groupByProject,
  hasFilters,
  loadHistoryFilters,
  loadHistoryView,
  dayLabel,
  markOldNotice,
  oldPendingCount,
  oldPendingSummary,
  plainText,
  projectOptions,
  saveHistoryFilters,
  saveHistoryView,
  stateClass,
  stateText,
  visibleInGroup,
} from '../lib/history.ts';
import type { HistoryFilters, HistoryView, OldPendingSummary } from '../lib/history.ts';
import type { PanelLimits } from '../lib/panelWidth.ts';
import { historyHref } from '../lib/route.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { usePanelWidth } from '../lib/usePanelWidth.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import type { HistoryEntry, HistoryState, ProjectInfo } from '../types.ts';

const POLL_MS = 60_000;

/** Fila de la lista. En la vista por proyecto muestra el día en lugar del proyecto. */
function HistoryRow({ e, selected, view }: { e: HistoryEntry; selected: boolean; view: HistoryView }) {
  return (
    <a className="hrow" href={historyHref(e.project, e.file)} aria-current={selected ? 'true' : undefined}>
      <span className="hrow__meta">
        <span title={e.approxDate ? 'Hora aproximada' : undefined}>{entryTime(e.date) || '—'}</span>
        <span>{view === 'project' ? dayLabel(e.date) : e.project}</span>
        <span className={`hstate hstate--${stateClass(e.state)}`}>{stateText(e.state)}</span>
      </span>
      <span className="hrow__title">{plainText(e.title)}</span>
      {e.firstPending && <span className="hrow__pending">Pendiente de ti: {plainText(e.firstPending)}</span>}
    </a>
  );
}

/** Grupo de la vista por proyecto, plegado a las tres más recientes como Sesiones recientes. */
function ProjectGroupView({ project, info, entries, selected }: { project: string; info: ProjectInfo | undefined; entries: HistoryEntry[]; selected: string | null }) {
  const [expandido, setExpandido] = useState(false);
  const { shown, hidden } = visibleInGroup(entries, expandido, selected);
  const nombre = info?.name ?? project;
  return (
    <section className="hgroup hgroup--project" aria-label={`${nombre}: ${entries.length} ${entries.length === 1 ? 'entrada' : 'entradas'}`}>
      <div className="group__head hgroup__head">
        <Monogram project={info ?? { mono: nombre.slice(0, 2).toUpperCase(), color: 'var(--fg-muted)' }} />
        <h2 className="group__name hgroup__name">{nombre}</h2>
        <span className="group__count">{entries.length}</span>
      </div>
      <ul className="hgroup__list">
        {shown.map((e) => (
          <li key={entryKey(e)}>
            <HistoryRow e={e} selected={entryKey(e) === selected} view="project" />
          </li>
        ))}
      </ul>
      {(hidden > 0 || (expandido && entries.length > HISTORY_COLLAPSED)) && (
        <button type="button" className="rmore hgroup__more" aria-expanded={expandido} onClick={() => setExpandido(!expandido)}>
          {expandido ? 'Ver menos' : `Ver más (${hidden})`}
        </button>
      )}
    </section>
  );
}

/** Confirmación de la limpieza de pendientes antiguos. */
function MarkOldDialog(props: { project: string; summary: OldPendingSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { project, summary, busy } = props;
  const donde =
    project !== ''
      ? `del proyecto ${project}`
      : summary.hiddenEntries > 0
        ? 'de todos los proyectos, también los ocultos en Ajustes'
        : 'de todos los proyectos';
  return (
    <Modal
      title="Marcar los pendientes antiguos"
      role="alertdialog"
      width={520}
      initialFocus="[data-cancel]"
      onClose={() => !busy && props.onCancel()}
      footer={
        <>
          <button type="button" data-cancel className="btn btn--ghost btn--lg footer-push" onClick={props.onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn--accent btn--lg" onClick={props.onConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Marcando…' : 'Marcar como hechos'}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="confirm-text">
          Se marcarán como hechos <strong>{oldPendingCount(summary)}</strong> anteriores a la última {donde}. Los pendientes de la última
          entrada de cada proyecto no se tocan.
        </p>
        <p className="confirm-text">No se puede deshacer en bloque: después solo podrás desmarcarlos uno a uno desde cada entrada.</p>
      </div>
    </Modal>
  );
}

/** Pantalla Historial (Registro.dc.html): lista de entradas de todos los proyectos y lector. */
const LIST_LIMITS: PanelLimits = { min: 280, max: 720, default: 440 };
/** Igual que el `@media` de historial.css: por debajo la lista va encima del lector, sin tirador. */
const SIDE_BY_SIDE_QUERY = '(min-width: 900px)';

export function HistorialScreen(props: {
  project: string | null;
  file: string | null;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const { projects, onHistoryChange } = useSessions();
  const enColumnas = useMediaQuery(SIDE_BY_SIDE_QUERY);
  const anchoLista = usePanelWidth('historial-lista', LIST_LIMITS);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<HistoryFilters>(() => loadHistoryFilters());
  const [vista, setVista] = useState<HistoryView>(() => loadHistoryView());
  const seq = useRef(0);
  const idProyecto = useId();
  const idEstado = useId();
  const idSolo = useId();
  const idAntiguos = useId();
  const [limpiar, setLimpiar] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const [avisoLimpieza, setAvisoLimpieza] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  const cargar = useCallback(() => {
    const n = ++seq.current;
    api
      .history()
      .then((e) => {
        if (n !== seq.current) return;
        setEntries(e);
        setError(null);
      })
      .catch((e: unknown) => {
        if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  // Al abrir, con cada aviso del servidor, al volver a la ventana y cada 60 s.
  useEffect(() => {
    cargar();
    const baja = onHistoryChange(() => cargar());
    const refrescar = () => {
      if (document.visibilityState === 'visible') cargar();
    };
    const t = window.setInterval(refrescar, POLL_MS);
    window.addEventListener('focus', refrescar);
    document.addEventListener('visibilitychange', refrescar);
    return () => {
      baja();
      window.clearInterval(t);
      window.removeEventListener('focus', refrescar);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [cargar, onHistoryChange]);

  useEffect(() => saveHistoryFilters(filtros), [filtros]);
  useEffect(() => saveHistoryView(vista), [vista]);

  // Solo los proyectos visibles en Ajustes (mientras no se conozcan, todos).
  const visibles = useMemo(() => (projects.length > 0 ? new Set(projects.filter((p) => p.visible).map((p) => p.id)) : undefined), [projects]);
  const propias = useMemo(() => (entries ? filterEntries(entries, NO_HISTORY_FILTERS, visibles) : []), [entries, visibles]);
  const opciones = useMemo(() => projectOptions(propias, projects.find((p) => p.harness)?.id), [propias, projects]);
  // Un proyecto recordado que ya no tiene entradas (o está oculto) no filtra.
  const efectivos = useMemo<HistoryFilters>(
    () => (filtros.project === '' || opciones.includes(filtros.project) ? filtros : { ...filtros, project: '' }),
    [filtros, opciones],
  );
  const filtradas = useMemo(() => filterEntries(propias, efectivos), [propias, efectivos]);
  const grupos = useMemo(() => groupByDay(filtradas), [filtradas]);
  const porProyecto = useMemo(() => groupByProject(filtradas), [filtradas]);
  const infoDe = (id: string) => projects.find((p) => p.id === id);

  const seleccion = props.project && props.file ? entryKey({ project: props.project, file: props.file }) : null;
  // Se busca en la lista completa (también proyectos ocultos): si ya está
  // cargada y no aparece, la entrada se ha borrado o renombrado.
  const enLista = seleccion && entries ? entries.find((e) => entryKey(e) === seleccion) : undefined;
  const desaparecida = Boolean(seleccion && entries && !enLista);

  // Sin entrada en la URL se abre la primera de la lista.
  const { onReplaceHash } = props;
  const primera = filtradas[0];
  useEffect(() => {
    if (!seleccion && primera) onReplaceHash(historyHref(primera.project, primera.file));
  }, [seleccion, primera, onReplaceHash]);

  const cambiar = (parche: Partial<HistoryFilters>) => setFiltros((f) => ({ ...f, ...parche }));

  // La limpieza respeta el filtro de proyecto; sin él, abarca todos (como el servidor).
  const antiguos = useMemo(() => oldPendingSummary(entries ?? [], efectivos.project, visibles), [entries, efectivos.project, visibles]);
  const confirmarLimpieza = async () => {
    setLimpiando(true);
    try {
      const r = await markOldPending(efectivos.project || null);
      setAvisoLimpieza(markOldNotice(r));
    } catch (e) {
      setAvisoLimpieza({ kind: 'error', text: `No se pudieron marcar: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setLimpiando(false);
      setLimpiar(false);
      cargar();
    }
  };

  return (
    <div className="screen screen--historial">
      <section className="hlist" aria-label="Lista de entradas del historial" style={anchoLista.style('--hlist-w', enColumnas)}>
        <div className="hlist__filters" role="search" aria-label="Filtrar el historial">
          <div className="hlist__selects">
            <label className="hlist__field" htmlFor={idProyecto}>
              Proyecto
              <select id={idProyecto} className="input hlist__select" value={efectivos.project} onChange={(e) => cambiar({ project: e.target.value })}>
                <option value="">Todos</option>
                {opciones.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="hlist__field" htmlFor={idEstado}>
              Estado
              <select
                id={idEstado}
                className="input hlist__select"
                value={efectivos.state}
                onChange={(e) => cambiar({ state: e.target.value as HistoryState | '' })}
              >
                <option value="">Todos</option>
                {STATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="desconocido">sin estado válido</option>
              </select>
            </label>
          </div>
          <div className="hlist__view" role="group" aria-label="Agrupar la lista">
            <button type="button" className="hlist__view-btn" aria-pressed={vista === 'date'} onClick={() => setVista('date')}>
              Por fecha
            </button>
            <button type="button" className="hlist__view-btn" aria-pressed={vista === 'project'} onClick={() => setVista('project')}>
              Por proyecto
            </button>
          </div>
          <label className="hlist__check" htmlFor={idSolo}>
            <input id={idSolo} type="checkbox" checked={efectivos.pending} onChange={(e) => cambiar({ pending: e.target.checked })} />
            Solo con «Pendiente de ti»
          </label>
          {efectivos.pending && (
            <label className="hlist__check hlist__check--sub" htmlFor={idAntiguos}>
              <input id={idAntiguos} type="checkbox" checked={efectivos.includeOld} onChange={(e) => cambiar({ includeOld: e.target.checked })} />
              Incluir pendientes antiguos
            </label>
          )}
          {antiguos.entries > 0 && (
            <button type="button" className="btn btn--ghost btn--sm hlist__cleanup" onClick={() => setLimpiar(true)} aria-haspopup="dialog">
              Marcar como hechos los pendientes antiguos
            </button>
          )}
          <div className="hlist__live" aria-live="polite">
            {avisoLimpieza && (
              <p className={`ddet__notice ddet__notice--${avisoLimpieza.kind}`} role={avisoLimpieza.kind === 'error' ? 'alert' : undefined}>
                <IconAlert size={14} />
                {avisoLimpieza.text}
              </p>
            )}
          </div>
          <span className="sr-only" aria-live="polite">
            {entries ? `${filtradas.length} ${filtradas.length === 1 ? 'entrada' : 'entradas'}` : ''}
          </span>
        </div>

        <div className="hlist__body">
          {error && (
            <p className="hlist__error" role="alert">
              No se pudo cargar el historial: {error}
            </p>
          )}
          {!entries ? (
            !error && <p className="hlist__empty">Cargando historial…</p>
          ) : propias.length === 0 ? (
            <div className="hlist__empty">
              <p className="hlist__empty-title">Todavía no hay entradas</p>
              <p>Cuando un agente registre una iteración según rules/history.md, aparecerá aquí.</p>
            </div>
          ) : filtradas.length === 0 ? (
            <div className="hlist__empty">
              <p className="hlist__empty-title">Ninguna entrada coincide con los filtros</p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFiltros(NO_HISTORY_FILTERS)}>
                Quitar filtros
              </button>
            </div>
          ) : vista === 'project' ? (
            porProyecto.map((g) => <ProjectGroupView key={g.project} project={g.project} info={infoDe(g.project)} entries={g.entries} selected={seleccion} />)
          ) : (
            grupos.map((g) => (
              <section key={g.day} className="hgroup" aria-labelledby={`${idSolo}-${g.day}`}>
                <h2 className="hgroup__day" id={`${idSolo}-${g.day}`}>
                  {g.label}
                </h2>
                <ul className="hgroup__list">
                  {g.entries.map((e) => (
                    <li key={entryKey(e)}>
                      <HistoryRow e={e} selected={entryKey(e) === seleccion} view="date" />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {entries && hasFilters(efectivos) && filtradas.length > 0 && (
            <p className="hlist__count">
              {filtradas.length} de {propias.length}
            </p>
          )}
        </div>
      </section>
      {enColumnas && <ResizeHandle side="left" limits={LIST_LIMITS} panel={anchoLista} label="Ancho de la lista del historial" />}

      {limpiar && (
        <MarkOldDialog project={efectivos.project} summary={antiguos} busy={limpiando} onCancel={() => setLimpiar(false)} onConfirm={() => void confirmarLimpieza()} />
      )}

      {props.project && props.file ? (
        <HistoryReader key={seleccion} project={props.project} file={props.file} listEntry={enLista} gone={desaparecida} onChanged={cargar} />
      ) : (
        <div className="hreader hreader--empty">
          <p>{entries && propias.length > 0 ? 'Elige una entrada de la lista.' : ''}</p>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api } from '../api.ts';
import { ResizeHandle } from '../components/ResizeHandle.tsx';
import { Board } from '../components/proyectos/Board.tsx';
import { CommitDialog } from '../components/proyectos/CommitDialog.tsx';
import { Detail } from '../components/proyectos/Detail.tsx';
import { ProjectHeader, ProjectSidebar, ProjectsEmpty, useSidebarWidth } from '../components/proyectos/ProjectSidebar.tsx';
import { WorktreeStrip } from '../components/proyectos/WorktreeStrip.tsx';
import {
  NO_FILTERS,
  STATES,
  filterItems,
  filterOptions,
  groupByState,
  openCount,
  pendingLabel,
  workPrompt,
} from '../lib/backlog.ts';
import type { Filters } from '../lib/backlog.ts';
import type { PanelLimits } from '../lib/panelWidth.ts';
import { projectHref } from '../lib/route.ts';
import { usePanelWidth } from '../lib/usePanelWidth.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { useProjectScreen } from '../lib/useProjectScreen.ts';
import { useChangesOverview } from '../lib/useChangesOverview.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { BacklogDetail, BacklogList, BacklogState } from '../types.ts';

const POLL_MS = 30_000;
/** Igual que la media query del CSS en la que el detalle se superpone al tablero. */
const OVERLAY_QUERY = '(max-width: 1099.98px)';

const DETAIL_LIMITS: PanelLimits = { min: 320, max: 760, default: 440 };

type Lista = { data: BacklogList | null; error: string | null; stamp: number };

/** Pantalla Backlog: los elementos de `docs/backlog/` del proyecto por estados, con su detalle. */
export function BacklogScreen(props: {
  project: string | null;
  item: string | null;
  onGoToTerminal: () => void;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const { sessions, onBacklogChange } = useSessions();
  const { openDialog, openSession, activate, dialogOpen } = useWorkspace();
  const { projects, visibles, ids, actual, loaded } = useProjectScreen(
    'backlog',
    { project: props.project, item: props.item },
    props.onReplaceHash,
  );
  const actualId = actual?.id ?? null;
  const elementoPedido = actual && props.project === actual.id ? props.item : null;
  // Elemento inexistente: su error se sigue mostrando aunque la URL ya no lo lleve.
  const [perdido, setPerdido] = useState<{ project: string; item: string } | null>(null);
  const perdidoAqui = !elementoPedido && perdido && perdido.project === actualId ? perdido.item : null;
  const elemento = elementoPedido ?? perdidoAqui;
  const superpuesto = useMediaQuery(OVERLAY_QUERY);

  const [listas, setListas] = useState<Record<string, Lista>>({});
  const sidebar = useSidebarWidth();
  const anchoDetalle = usePanelWidth('proyectos-detalle', DETAIL_LIMITS);
  const [filtros, setFiltros] = useState<Filters>(NO_FILTERS);
  // Proyecto cuyo diálogo «Confirmar cambios» está abierto.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const lugares = useChangesOverview(actualId);
  const seqs = useRef<Record<string, number>>({});
  const idBase = useId();
  const idBuscar = useId();
  const raiz = useRef<HTMLDivElement>(null);

  // Al cambiar de proyecto se quitan los filtros.
  useEffect(() => {
    setFiltros(NO_FILTERS);
  }, [actualId]);

  // Con otro elemento en la URL, el perdido deja de mostrarse.
  useEffect(() => {
    if (props.item) setPerdido(null);
  }, [props.item]);

  const { onReplaceHash } = props;
  const alFaltar = useCallback(() => {
    if (!actualId || !props.item || props.project !== actualId) return;
    setPerdido({ project: actualId, item: props.item });
    onReplaceHash(projectHref('backlog', actualId));
  }, [actualId, props.item, props.project, onReplaceHash]);

  const cargarLista = useCallback((id: string) => {
    const n = (seqs.current[id] = (seqs.current[id] ?? 0) + 1);
    api
      .backlog(id)
      .then((data) => {
        if (seqs.current[id] === n) setListas((l) => ({ ...l, [id]: { data, error: null, stamp: Date.now() } }));
      })
      .catch((e: unknown) => {
        if (seqs.current[id] !== n) return;
        const error = e instanceof Error ? e.message : String(e);
        setListas((l) => ({ ...l, [id]: { data: l[id]?.data ?? null, error, stamp: l[id]?.stamp ?? 0 } }));
      });
  }, []);

  // Recuentos de la barra lateral: una carga por proyecto visible.
  const clave = ids.join('\n');
  useEffect(() => {
    for (const id of clave.split('\n')) if (id) cargarLista(id);
  }, [clave, cargarLista]);

  // Avisos del servidor, al volver a la ventana y cada 30 s (para ver `pending` tras un commit).
  // Los worktrees (la franja) se refrescan por su cuenta en useChangesOverview.
  useEffect(() => {
    const baja = onBacklogChange((p) => {
      if (ids.includes(p)) cargarLista(p);
    });
    const refrescar = () => {
      if (document.visibilityState !== 'visible' || !actualId) return;
      cargarLista(actualId);
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
  }, [onBacklogChange, ids, actualId, cargarLista]);

  const lista = actualId ? listas[actualId] : undefined;
  const items = useMemo(() => lista?.data?.items ?? [], [lista]);
  const filtrados = useMemo(() => filterItems(items, filtros), [items, filtros]);
  const grupos = useMemo(() => groupByState(filtrados), [filtrados]);
  const totales = useMemo(() => {
    const t = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<BacklogState, number>;
    for (const i of items) t[i.status]++;
    return t;
  }, [items]);
  const opciones = useMemo(() => filterOptions(items), [items]);
  const hayFiltros = filtros.text.trim() !== '' || filtros.type !== '' || filtros.priority !== '';

  const irASesion = (name: string) => {
    openSession(name);
    activate(name);
    props.onGoToTerminal();
  };

  const cerrarDetalle = useCallback(() => {
    if (!actualId) return;
    const previo = elemento;
    setPerdido(null);
    // Con un elemento perdido el hash ya no lo lleva y no habrá hashchange.
    window.location.hash = projectHref('backlog', actualId);
    // El foco vuelve a la tarjeta del elemento cerrado.
    window.setTimeout(() => {
      if (previo) raiz.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(previo)}"]`)?.focus();
    }, 0);
  }, [actualId, elemento]);

  const alPulsar = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !elemento || dialogOpen || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.value !== '') return;
    cerrarDetalle();
  };

  const trabajar = (d: BacklogDetail) => {
    if (!actual) return;
    openDialog({ project: actual.id, prompt: workPrompt(d, d.path) });
  };

  // Recuento de la barra: elementos abiertos de cada proyecto (null hasta cargar su backlog).
  const recuentos = useMemo(() => Object.fromEntries(visibles.map((p) => [p.id, listas[p.id]?.data ? openCount(listas[p.id]!.data!.items) : null])), [visibles, listas]);

  if (!actual) return <ProjectsEmpty loaded={loaded} any={projects.length > 0} />;

  const detalleEnLinea = elemento !== null && !superpuesto;
  const pending = lista?.data?.pending ?? 0;
  const conSesiones = lugares.data?.worktrees.filter((w) => w.sessions.length > 0) ?? [];

  return (
    <div className="screen screen--proyectos" ref={raiz} onKeyDown={alPulsar}>
      <ProjectSidebar
        screen="backlog"
        projects={visibles}
        currentId={actual.id}
        sidebar={sidebar}
        counts={recuentos}
        countLabel={(n) => `${n} ${n === 1 ? 'elemento abierto' : 'elementos abiertos'}`}
        reserved={detalleEnLinea ? anchoDetalle.width : 0}
      />

      <main className="pmain">
        <ProjectHeader project={actual} path="docs/backlog/">
          <span className="phead__pending" aria-live="polite">
            {pending > 0 && pendingLabel(pending)}
          </span>
          {pending > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmando(actual.id)}>
              Confirmar cambios
            </button>
          )}
        </ProjectHeader>

        <div className="ppanel">
          {conSesiones.map((w) => (
            <WorktreeStrip key={w.name} worktree={w} sessions={sessions} onOpen={irASesion} />
          ))}
          {lista?.error && (
            <p className="ptab__error" role="alert">
              No se pudo cargar el backlog: {lista.error}
            </p>
          )}
          {!lista?.data ? (
            !lista?.error && <p className="ptab__empty">Cargando backlog…</p>
          ) : !lista.data.hasBacklog ? (
            <div className="pempty">
              <h2 className="pempty__title">Este proyecto no tiene backlog</h2>
              <p className="pempty__text">Cuando un agente registre el primer elemento según rules/backlog.md, aparecerá aquí desde docs/backlog/.</p>
            </div>
          ) : (
            <>
              <div className="pfilters" role="search" aria-label="Filtrar el backlog">
                <label className="pfilters__search" htmlFor={idBuscar}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" focusable="false">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <span className="sr-only">Buscar en título, identificador y resumen</span>
                  <input
                    id={idBuscar}
                    type="search"
                    placeholder="Buscar en el backlog"
                    value={filtros.text}
                    onChange={(e) => setFiltros((f) => ({ ...f, text: e.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <select
                  className="input pfilters__select"
                  aria-label="Filtrar por tipo"
                  value={filtros.type}
                  onChange={(e) => setFiltros((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="">Todos los tipos</option>
                  {opciones.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  className="input pfilters__select"
                  aria-label="Filtrar por prioridad"
                  value={filtros.priority}
                  onChange={(e) => setFiltros((f) => ({ ...f, priority: e.target.value }))}
                >
                  <option value="">Todas las prioridades</option>
                  {opciones.priorities.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {hayFiltros && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFiltros(NO_FILTERS)}>
                    Quitar filtros
                  </button>
                )}
                <span className="pfilters__count" aria-live="polite">
                  {hayFiltros ? `${filtrados.length} de ${items.length}` : ''}
                </span>
              </div>
              <Board grouped={grupos} totals={totales} filtered={hayFiltros} project={actual.id} selected={elemento} idBase={idBase} />
            </>
          )}
        </div>
      </main>

      {elemento && (
        <>
          {/* Solo se ve por debajo de 1100 px (CSS); pulsarlo cierra el detalle. */}
          <div className="ddet-backdrop" aria-hidden="true" onClick={cerrarDetalle} />
          {!superpuesto && (
            <ResizeHandle
              side="right"
              limits={DETAIL_LIMITS}
              panel={anchoDetalle}
              label="Ancho del panel de detalle"
              reserved={sidebar.width}
            />
          )}
          <Detail
            style={anchoDetalle.style('--ddet-w', !superpuesto)}
            key={`${actual.id}/${elemento}`}
            project={actual}
            itemId={elemento}
            listItem={items.find((i) => i.id === elemento)}
            listStamp={lista?.stamp ?? 0}
            overlay={superpuesto && !dialogOpen && confirmando === null}
            onClose={cerrarDetalle}
            onMoved={() => cargarLista(actual.id)}
            onMissing={alFaltar}
            onWork={trabajar}
          />
        </>
      )}

      {confirmando === actual.id && (
        <CommitDialog
          project={actual.id}
          onClose={() => setConfirmando(null)}
          onFinished={() => cargarLista(actual.id)}
        />
      )}
    </div>
  );
}

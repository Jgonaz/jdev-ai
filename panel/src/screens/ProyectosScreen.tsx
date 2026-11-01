import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api } from '../api.ts';
import { Monogram } from '../components/Monogram.tsx';
import { Board } from '../components/proyectos/Board.tsx';
import { CommitDialog } from '../components/proyectos/CommitDialog.tsx';
import { Detail } from '../components/proyectos/Detail.tsx';
import { GuidesTab } from '../components/proyectos/GuidesTab.tsx';
import { Tabs, tabPanelProps } from '../components/proyectos/Tabs.tsx';
import { WorktreeStrip, WorktreesTab } from '../components/proyectos/WorktreesTab.tsx';
import {
  NO_FILTERS,
  STATES,
  filterItems,
  filterOptions,
  groupByState,
  loadLastProject,
  openCount,
  pendingLabel,
  pickProject,
  saveLastProject,
  workPrompt,
} from '../lib/backlog.ts';
import type { Filters } from '../lib/backlog.ts';
import { canonicalProjectHref, projectHref } from '../lib/route.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { BacklogDetail, BacklogList, BacklogState, WorktreeList } from '../types.ts';

const POLL_MS = 30_000;
/** Igual que la media query del CSS en la que el detalle se superpone al tablero. */
const OVERLAY_QUERY = '(max-width: 1099.98px)';

type Pestana = 'backlog' | 'worktrees' | 'guias';
type Lista = { data: BacklogList | null; error: string | null; stamp: number };

/** Pantalla Proyectos: backlog por estados, detalle, worktrees y guías de cada proyecto. */
export function ProyectosScreen(props: {
  project: string | null;
  item: string | null;
  onGoToTerminal: () => void;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const { projects, sessions, loaded, onBacklogChange, reloadProjects } = useSessions();
  const { openDialog, openSession, activate, dialogOpen } = useWorkspace();
  const visibles = useMemo(() => projects.filter((p) => p.visible), [projects]);
  const ids = useMemo(() => visibles.map((p) => p.id), [visibles]);
  const actualId = pickProject(ids, props.project, loadLastProject());
  const actual = visibles.find((p) => p.id === actualId) ?? null;
  const elementoPedido = actual && props.project === actual.id ? props.item : null;
  // Elemento inexistente: su error se sigue mostrando aunque la URL ya no lo lleve.
  const [perdido, setPerdido] = useState<{ project: string; item: string } | null>(null);
  const perdidoAqui = !elementoPedido && perdido && perdido.project === actualId ? perdido.item : null;
  const elemento = elementoPedido ?? perdidoAqui;
  const superpuesto = useMediaQuery(OVERLAY_QUERY);

  const [listas, setListas] = useState<Record<string, Lista>>({});
  // La pestaña va ligada al proyecto: al cambiar de proyecto se vuelve a Backlog
  // en el mismo render (un efecto llegaría tarde y quitaría el elemento de la URL).
  const [vista, setVista] = useState<{ project: string | null; tab: Pestana }>({ project: null, tab: 'backlog' });
  const pestana: Pestana = vista.project === actualId ? vista.tab : 'backlog';
  const setPestana = useCallback((tab: Pestana) => setVista({ project: actualId, tab }), [actualId]);
  const [filtros, setFiltros] = useState<Filters>(NO_FILTERS);
  // Proyecto cuyo diálogo «Confirmar cambios» está abierto.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<{ project: string; data: WorktreeList | null; error: string | null } | null>(null);
  const seqs = useRef<Record<string, number>>({});
  const idBase = useId();
  const idBuscar = useId();
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (actualId) saveLastProject(actualId);
  }, [actualId]);

  // Al cambiar de proyecto se quitan los filtros.
  useEffect(() => {
    setFiltros(NO_FILTERS);
  }, [actualId]);

  // Con otro elemento en la URL, el perdido deja de mostrarse.
  useEffect(() => {
    if (props.item) setPerdido(null);
  }, [props.item]);

  // URL canónica: proyecto mostrado y elemento solo si se ve (pestaña Backlog y existe).
  const { onReplaceHash } = props;
  useEffect(() => {
    if (!actualId) return;
    const destino = canonicalProjectHref({ project: props.project, item: props.item }, actualId, pestana === 'backlog');
    if (destino) onReplaceHash(destino);
  }, [actualId, props.project, props.item, pestana, onReplaceHash]);

  const alFaltar = useCallback(() => {
    if (!actualId || !props.item || props.project !== actualId) return;
    setPerdido({ project: actualId, item: props.item });
    onReplaceHash(projectHref(actualId));
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

  const cargarWorktrees = useCallback((id: string) => {
    api
      .worktrees(id)
      .then((data) => setWorktrees((w) => (w && w.project !== id ? w : { project: id, data, error: null })))
      .catch((e: unknown) =>
        setWorktrees((w) => (w && w.project !== id ? w : { project: id, data: w?.data ?? null, error: e instanceof Error ? e.message : String(e) })),
      );
  }, []);
  useEffect(() => {
    if (!actualId) return;
    setWorktrees({ project: actualId, data: null, error: null });
    cargarWorktrees(actualId);
  }, [actualId, cargarWorktrees]);

  // Las sesiones del panel cambian a menudo: los worktrees se refrescan cuando cambia qué sesiones hay.
  const nombresSesiones = sessions.map((s) => `${s.name}:${s.worktree}`).join('|');
  useEffect(() => {
    if (actualId) cargarWorktrees(actualId);
  }, [nombresSesiones, actualId, cargarWorktrees]);

  // Avisos del servidor, al volver a la ventana y cada 30 s (para ver `pending` tras un commit).
  useEffect(() => {
    const baja = onBacklogChange((p) => {
      if (ids.includes(p)) cargarLista(p);
    });
    const refrescar = () => {
      if (document.visibilityState !== 'visible' || !actualId) return;
      cargarLista(actualId);
      cargarWorktrees(actualId);
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
  }, [onBacklogChange, ids, actualId, cargarLista, cargarWorktrees]);

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
    window.location.hash = projectHref(actualId);
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

  const nuevaEnWorktree = (wt: string) => {
    if (!actual) return;
    reloadProjects();
    openDialog({ project: actual.id, location: 'existing-worktree', worktree: wt });
  };

  if (!actual) {
    return (
      <div className="screen screen--proyectos">
        <p className="pscreen__empty">{loaded && projects.length > 0 ? 'No hay proyectos visibles: revisa la visibilidad en Ajustes.' : 'Cargando proyectos…'}</p>
      </div>
    );
  }

  const pending = lista?.data?.pending ?? 0;
  const conSesiones = worktrees?.project === actual.id ? (worktrees.data?.worktrees.filter((w) => w.sessions.length > 0) ?? []) : [];

  return (
    <div className="screen screen--proyectos" ref={raiz} onKeyDown={alPulsar}>
      <nav className="psidebar" aria-label="Proyectos">
        <span className="psidebar__head">~/proyectos</span>
        <ul>
          {visibles.map((p) => {
            const l = listas[p.id]?.data;
            const n = l ? openCount(l.items) : null;
            return (
              <li key={p.id}>
                <a className="prow" href={projectHref(p.id)} aria-current={p.id === actual.id ? 'page' : undefined}>
                  <Monogram project={p} />
                  <span className="prow__name">{p.name}</span>
                  {n !== null && (
                    <span className="prow__count" aria-label={`${n} ${n === 1 ? 'elemento abierto' : 'elementos abiertos'}`}>
                      {n}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="pmain">
        <div className="phead">
          <span className="phead__mono" style={{ background: actual.color }} aria-hidden="true">
            {actual.mono}
          </span>
          <h1 className="phead__name">{actual.name}</h1>
          <span className="phead__path">docs/backlog/</span>
          <span className="phead__pending" aria-live="polite">
            {pending > 0 && pendingLabel(pending)}
          </span>
          {pending > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmando(actual.id)}>
              Confirmar cambios
            </button>
          )}
          <Tabs
            tabs={[
              { value: 'backlog', label: 'Backlog' },
              { value: 'worktrees', label: 'Worktrees' },
              { value: 'guias', label: 'Guías' },
            ]}
            value={pestana}
            onChange={setPestana}
            label="Vista del proyecto"
            idBase={idBase}
            className="ptabs"
          />
        </div>

        {pestana === 'backlog' && (
          <div className="ppanel" {...tabPanelProps(idBase, 'backlog')}>
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
        )}
        {pestana === 'worktrees' && (
          <div className="ppanel" {...tabPanelProps(idBase, 'worktrees')}>
            <WorktreesTab
              project={actual}
              data={worktrees?.project === actual.id ? worktrees.data : null}
              error={worktrees?.project === actual.id ? worktrees.error : null}
              sessions={sessions}
              onOpenSession={irASesion}
              onNewSession={nuevaEnWorktree}
            />
          </div>
        )}
        {pestana === 'guias' && (
          <div className="ppanel" {...tabPanelProps(idBase, 'guias')}>
            <GuidesTab project={actual} />
          </div>
        )}
      </main>

      {elemento && pestana === 'backlog' && (
        <>
          {/* Solo se ve por debajo de 1100 px (CSS); pulsarlo cierra el detalle. */}
          <div className="ddet-backdrop" aria-hidden="true" onClick={cerrarDetalle} />
          <Detail
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

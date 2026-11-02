import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { IconPlus } from '../components/Icons.tsx';
import { Monogram } from '../components/Monogram.tsx';
import { StatusLight } from '../components/StatusLight.tsx';
import { rememberHistoryFilters, stateClass, stateText } from '../lib/history.ts';
import {
  activityWhen,
  attentionItems,
  displayName,
  inicioTitle,
  lastEntryText,
  pendingSource,
  pendingText,
  preferredSession,
  projectCards,
  relativeText,
  restingChip,
  shiftLine,
  stateCounts,
  summaryLine,
  waitingChip,
  workingChip,
} from '../lib/inicio.ts';
import type { AttentionItem, ProjectCard } from '../lib/inicio.ts';
import { fallbackProject, STATE_LABELS, visualState } from '../lib/sessions.ts';
import { sessionNamesKey } from '../lib/recent.ts';
import { historyHref, projectHref, routeHref } from '../lib/route.ts';
import { useNow } from '../lib/useNow.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useSettings } from '../state/SettingsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { Overview, ProjectInfo, SessionInfo } from '../types.ts';

const RELOAD_DEBOUNCE_MS = 400;

/**
 * Resumen de GET /api/overview. Se vuelve a pedir (con debounce) con los avisos
 * de backlog e historial, cuando cambian las sesiones del panel o la
 * visibilidad de los proyectos (ya guardada), y al volver a la ventana.
 */
function useOverview(): { overview: Overview | null; error: string | null } {
  const { onBacklogChange, onHistoryChange, sessions, connected } = useSessions();
  const { settings, saveState } = useSettings();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  // Visibilidad de proyectos actual y la del último resumen pedido.
  const claveProyectos = JSON.stringify(settings.projects);
  const claveActual = useRef(claveProyectos);
  claveActual.current = claveProyectos;
  const clavePedida = useRef<string | null>(null);

  const cargar = useCallback(() => {
    const n = ++seq.current;
    clavePedida.current = claveActual.current;
    api
      .overview()
      .then((o) => {
        if (n !== seq.current) return;
        setOverview(o);
        setError(null);
      })
      .catch((e: unknown) => {
        if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
      });
  }, []);
  const programar = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      cargar();
    }, RELOAD_DEBOUNCE_MS);
  }, [cargar]);

  useEffect(() => {
    cargar();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [cargar]);
  useEffect(() => {
    const bajas = [onBacklogChange(programar), onHistoryChange(programar)];
    const alVolver = () => {
      if (document.visibilityState === 'visible') programar();
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      for (const b of bajas) b();
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [onBacklogChange, onHistoryChange, programar]);

  // Una sesión nueva puede traer un worktree nuevo.
  const claveSesiones = sessionNamesKey(sessions);
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    programar();
  }, [claveSesiones, connected, programar]);

  // Un proyecto que se muestra trae su resumen y uno que se oculta lo quita. El
  // servidor filtra con los ajustes guardados: se espera a que acabe el PUT
  // (aquí o, releídos al volver a la ventana, en otra pestaña).
  const guardando = saveState === 'saving';
  useEffect(() => {
    if (!guardando && clavePedida.current !== null && clavePedida.current !== claveProyectos) programar();
  }, [claveProyectos, guardando, programar]);

  return { overview, error };
}

type Acciones = {
  abrirSesion: (s: SessionInfo) => void;
  abrirProyecto: (sesiones: SessionInfo[]) => void;
  nuevaSesion: (proyecto: string) => void;
};

function AttentionRow({ item, proyecto, ahora, acciones }: { item: AttentionItem; proyecto: (id: string) => ProjectInfo; ahora: number; acciones: Acciones }) {
  if (item.kind === 'pending') {
    const irAlHistorial = () => {
      // El filtro recordado de Historial es el que se aplica al abrirlo: solo
      // los pendientes vigentes, como los que cuenta Inicio.
      rememberHistoryFilters({ pending: true, includeOld: false });
      window.location.hash = historyHref();
    };
    return (
      <li className="att att--pending">
        <span className="att__mark" aria-hidden="true" />
        <span className="att__body">
          <span className="att__title">{pendingText(item.openPending)}</span>
          <span className="att__text">{pendingSource(item.entries)}</span>
        </span>
        <span className="att__meta">historial</span>
        <button type="button" className="att__btn att__btn--ghost" onClick={irAlHistorial} aria-label={`Ver en Historial: ${pendingText(item.openPending)}`}>
          Ver pendientes
        </button>
      </li>
    );
  }
  const s = item.session;
  const p = proyecto(s.project);
  const espera = item.kind === 'waiting';
  const oculto = item.kind === 'waiting' && item.hidden;
  return (
    <li className={`att ${espera ? 'att--waiting' : 'att--closed'}`}>
      <StatusLight state={visualState(s)} />
      <span className="att__body">
        <span className="att__title">{s.title}</span>
        {espera ? (
          s.notice ? (
            <span className="att__text">
              <span className="sr-only">Aviso del agente: </span>
              <span className="att__notice" lang="en" title="Texto del aviso del agente, tal como llega">
                {s.notice}
              </span>
            </span>
          ) : (
            <span className="att__text">Te espera en su terminal.</span>
          )
        ) : (
          <span className="att__text">Marcada como cerrada y sigue abierta en el panel. Revísala y ciérrala si ya no la necesitas.</span>
        )}
      </span>
      <span className="att__meta">
        {p.name}
        {oculto && (
          <span className="att__hidden" title="Proyecto oculto en Ajustes: sus sesiones que esperan se avisan igual">
            {' '}
            · proyecto oculto
          </span>
        )}{' '}
        · {relativeText(s.updatedAt, ahora)}
      </span>
      <button
        type="button"
        className={`att__btn ${espera ? 'att__btn--accent' : 'att__btn--ghost'}`}
        onClick={() => acciones.abrirSesion(s)}
        aria-label={`${espera ? 'Responder' : 'Revisar'}: ${s.title} (${p.name}${oculto ? ', proyecto oculto' : ''})`}
      >
        {espera ? 'Responder' : 'Revisar'}
      </button>
    </li>
  );
}

function ProjectCardView({ card, ahora, acciones }: { card: ProjectCard; ahora: number; acciones: Acciones }) {
  const { project: p, overview: o } = card;
  const rama = o.branch ?? p.branch;
  const recuentos = [
    [o.backlog.backlog, 'backlog'],
    [o.backlog.todo, 'por hacer'],
    [o.backlog.inProgress, 'en curso'],
    [o.worktrees, o.worktrees === 1 ? 'worktree' : 'worktrees'],
  ] as const;
  const idTitulo = `pcard-${p.id}`;
  return (
    <article className="pcard" style={{ '--pcard-color': p.color } as React.CSSProperties} aria-labelledby={idTitulo}>
      <div className="pcard__head">
        <Monogram project={p} size="lg" />
        <h3 className="pcard__name" id={idTitulo}>
          {p.name}
        </h3>
        {rama && <span className="pcard__branch">{rama}</span>}
        <span className="pcard__when">{card.lastActivity > 0 ? relativeText(card.lastActivity, ahora) : 'sin actividad'}</span>
      </div>
      <div className="pcard__sessions">
        {card.sessions.length === 0 ? (
          <span className="pchip pchip--none">Sin sesiones</span>
        ) : (
          card.sessions.map((s) => {
            const v = visualState(s);
            return (
              <button
                key={s.name}
                type="button"
                className={`pchip pchip--${v}`}
                onClick={() => acciones.abrirSesion(s)}
                aria-label={`${s.title}, ${STATE_LABELS[v].toLowerCase()}: abrir su terminal`}
              >
                <StatusLight state={v} />
                <span className="pchip__text">{s.title}</span>
              </button>
            );
          })
        )}
      </div>
      <dl className="pcard__counts">
        {recuentos.map(([n, etiqueta]) => (
          <div key={etiqueta} className="pcard__count">
            <dt className="pcard__label">{etiqueta}</dt>
            <dd className="pcard__num">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="pcard__last">
        <span className="pcard__last-label">Último registro</span>
        {o.lastEntry ? (
          <a className="pcard__last-text" href={historyHref(p.id, o.lastEntry.file)}>
            {lastEntryText(o.lastEntry)}
          </a>
        ) : (
          <span className="pcard__last-text pcard__last-text--none">Todavía no hay entradas en su historial.</span>
        )}
      </div>
      <div className="pcard__actions">
        <button type="button" className="pcard__btn pcard__btn--main" onClick={() => acciones.abrirProyecto(card.sessions)} aria-label={`Abrir terminales de ${p.name}`}>
          Abrir terminales
        </button>
        <a className="pcard__btn" href={projectHref('backlog', p.id)} aria-label={`Backlog de ${p.name}`}>
          Backlog
        </a>
        <button type="button" className="pcard__btn pcard__btn--icon" onClick={() => acciones.nuevaSesion(p.id)} aria-label={`Nueva sesión en ${p.name}`} title="Nueva sesión en este proyecto">
          <IconPlus size={14} />
        </button>
      </div>
    </article>
  );
}

/** Pantalla Inicio: qué te necesita y dónde está el trabajo de todos los proyectos. Solo lee. */
export function InicioScreen({ onGoToTerminal }: { onGoToTerminal: () => void }) {
  const { sessions, projects, loaded } = useSessions();
  const { settings } = useSettings();
  const { openSession, activate, openDialog } = useWorkspace();
  const { overview, error } = useOverview();
  const ahora = useNow();
  const fecha = new Date(ahora);

  const visibles = useMemo(() => projects.filter((p) => p.visible), [projects]);
  const idsVisibles = useMemo(() => new Set(visibles.map((p) => p.id)), [visibles]);
  const idsOcultos = useMemo(() => new Set(projects.filter((p) => !p.visible).map((p) => p.id)), [projects]);
  const propias = useMemo(() => sessions.filter((s) => idsVisibles.has(s.project)), [sessions, idsVisibles]);
  const proyecto = useCallback((id: string) => projects.find((p) => p.id === id) ?? fallbackProject(id), [projects]);

  // Las sesiones que esperan cuentan también en proyectos ocultos, como en la cabecera y el título.
  const cuentas = stateCounts(sessions, idsVisibles);
  const atencion = attentionItems(sessions, idsVisibles, overview?.history ?? null, idsOcultos);
  const tarjetas = useMemo(() => projectCards(projects, overview?.projects ?? [], sessions), [projects, overview, sessions]);
  const worktrees = tarjetas.reduce((n, t) => n + t.overview.worktrees, 0);
  const nombre = displayName(settings.profile.name, overview?.gitName ?? null);
  const conSaludo = settings.personality.greeting;

  const acciones: Acciones = {
    abrirSesion: (s) => {
      openSession(s.name);
      activate(s.name);
      onGoToTerminal();
    },
    abrirProyecto: (lista) => {
      for (const s of lista) openSession(s.name);
      const elegida = preferredSession(lista);
      if (elegida) activate(elegida.name);
      onGoToTerminal();
    },
    nuevaSesion: (id) => openDialog({ project: id }),
  };

  return (
    <div className="screen screen--inicio">
      <div className="inicio" data-grid={settings.personality.grid ? 'on' : 'off'}>
        <div className="inicio__wrap">
          <main className="inicio__main">
            <div className="inicio__hello">
              <div className="inicio__hello-text">
                {conSaludo && <span className="inicio__shift">{shiftLine(fecha)}</span>}
                <h1 className="inicio__title">
                  {inicioTitle(fecha, nombre, conSaludo)}
                  {settings.personality.cursor && (
                    <span className="inicio__cursor" aria-hidden="true">
                      ▌
                    </span>
                  )}
                </h1>
                <p className="inicio__summary">{summaryLine(visibles.length, propias.length, worktrees)}</p>
              </div>
              <div className="inicio__chips">
                {cuentas.waiting > 0 && (
                  <a className="schip schip--waiting" href={routeHref('terminales')} aria-label={`${waitingChip(cuentas.waiting)}: ir a Terminales`}>
                    <StatusLight state="waiting" />
                    {waitingChip(cuentas.waiting)}
                  </a>
                )}
                {cuentas.working > 0 && (
                  <a className="schip schip--working" href={routeHref('terminales')} aria-label={`${workingChip(cuentas.working)}: ir a Terminales`}>
                    <StatusLight state="working" />
                    {workingChip(cuentas.working)}
                  </a>
                )}
                {cuentas.resting > 0 && (
                  <a className="schip schip--idle" href={routeHref('terminales')} aria-label={`${restingChip(cuentas.resting)}: ir a Terminales`}>
                    <StatusLight state="idle" />
                    {restingChip(cuentas.resting)}
                  </a>
                )}
              </div>
              {/* Anuncio discreto de las sesiones que te esperan, sin repetir el resto del resumen. */}
              <p className="sr-only" aria-live="polite">
                {cuentas.waiting > 0 ? waitingChip(cuentas.waiting) : ''}
              </p>
            </div>

            {error && (
              <p className="inicio__error" role="alert">
                No se pudo cargar el resumen: {error}
              </p>
            )}

            <section className="inicio__section" aria-labelledby="h-atencion">
              <h2 id="h-atencion" className="inicio__h2">
                <span className="inicio__h2-mark" aria-hidden="true">
                  ›
                </span>{' '}
                necesita tu atención
              </h2>
              {atencion.length > 0 ? (
                <ul className="inicio__att">
                  {atencion.map((it) => (
                    <AttentionRow
                      key={it.kind === 'pending' ? 'pending' : it.session.name}
                      item={it}
                      proyecto={proyecto}
                      ahora={ahora}
                      acciones={acciones}
                    />
                  ))}
                </ul>
              ) : (
                <p className="inicio__calm">
                  {loaded && overview ? 'Nada que atender: ninguna sesión te espera y no quedan pendientes en el historial.' : 'Cargando…'}
                </p>
              )}
            </section>

            <section className="inicio__section" aria-labelledby="h-proyectos">
              <div className="inicio__section-head">
                <h2 id="h-proyectos" className="inicio__h2">
                  <span className="inicio__h2-mark" aria-hidden="true">
                    ›
                  </span>{' '}
                  proyectos
                </h2>
                <span className="inicio__note">Ordenados por actividad</span>
              </div>
              {tarjetas.length > 0 ? (
                <div className="inicio__cards">
                  {tarjetas.map((t) => (
                    <ProjectCardView key={t.project.id} card={t} ahora={ahora} acciones={acciones} />
                  ))}
                </div>
              ) : (
                <p className="inicio__calm">
                  {!overview
                    ? 'Cargando proyectos…'
                    : projects.length > 0
                      ? 'No hay proyectos visibles: revisa la visibilidad en Ajustes.'
                      : 'Todavía no hay proyectos: clona un repositorio en projects/ del harness.'}
                </p>
              )}
            </section>
          </main>

          <aside className="inicio__aside" aria-labelledby="h-actividad">
            <h2 id="h-actividad" className="inicio__h2">
              <span className="inicio__h2-mark" aria-hidden="true">
                ›
              </span>{' '}
              actividad reciente
            </h2>
            {overview && overview.recent.length > 0 ? (
              <ol className="activity">
                {overview.recent.map((e) => (
                  <li key={`${e.project}/${e.file}`} className="activity__item">
                    <a className="activity__link" href={historyHref(e.project, e.file)}>
                      <span className="activity__meta">
                        <span>{activityWhen(e.date, fecha)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{proyecto(e.project).name}</span>
                        <span className={`hstate--${stateClass(e.state)}`}>{stateText(e.state)}</span>
                      </span>
                      <span className="activity__title">{e.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="inicio__calm">{overview ? 'Todavía no hay entradas en el historial.' : 'Cargando…'}</p>
            )}
            <a className="inicio__all" href={historyHref()} onClick={() => rememberHistoryFilters()}>
              Ver todo el historial
            </a>
          </aside>
        </div>
      </div>
    </div>
  );
}

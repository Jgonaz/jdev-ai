import { useState } from 'react';
import type { CSSProperties } from 'react';
import { RECENT_COLLAPSED, agoLabel, groupRecent, recentPlace, visibleRecent } from '../../lib/recent.ts';
import type { RecentGroup } from '../../lib/recent.ts';
import { groupSessions, sessionMeta, visualState } from '../../lib/sessions.ts';
import type { ProjectGroup } from '../../lib/sessions.ts';
import { formatRelative } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { ProjectInfo, RecentSession, SessionInfo } from '../../types.ts';
import { IconChevron, IconClock, IconFilter } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { Legend } from './Legend.tsx';
import { LiveSidebarSection } from './LiveSessions.tsx';
import { useSessionMenu } from './SessionMenu.tsx';
import { useLiveUnopened } from './useLiveUnopened.ts';

type MenuHandlers = Pick<ReturnType<typeof useSessionMenu>, 'onContextMenu' | 'onKeyDown'>;

function SessionRow({
  s,
  ahora,
  abierta,
  onOpen,
  menu,
}: {
  s: SessionInfo;
  ahora: number;
  abierta: boolean;
  onOpen: () => void;
  menu: MenuHandlers;
}) {
  const estado = visualState(s);
  return (
    <button
      type="button"
      className={`srow srow--${estado}`}
      aria-current={abierta ? 'true' : undefined}
      onClick={onOpen}
      onContextMenu={(e) => menu.onContextMenu(e, s)}
      onKeyDown={(e) => menu.onKeyDown(e, s)}
    >
      <StatusLight state={estado} label />
      <span className="srow__text">
        <span className="srow__title">{s.title}</span>
        <span className="srow__meta">{sessionMeta(s)}</span>
      </span>
      <span className="srow__time">{formatRelative(s.updatedAt, ahora)}</span>
    </button>
  );
}

function RecentRow({ r, ahora, onResume }: { r: RecentSession; ahora: number; onResume: () => void }) {
  return (
    <button
      type="button"
      className={`rrow${r.closed ? ' rrow--closed' : ''}`}
      aria-label={`Retomar en el panel: ${r.title}, ${recentPlace(r)}, ${agoLabel(r.lastActivity, ahora)}`}
      onClick={onResume}
    >
      <IconClock size={13} className="rrow__icon" />
      <span className="srow__text">
        <span className="srow__title">{r.title}</span>
        <span className="srow__meta">{recentPlace(r)}</span>
      </span>
      <span className="srow__time rrow__time">{formatRelative(r.lastActivity, ahora)}</span>
      <span className="rrow__action" aria-hidden="true">
        Retomar
      </span>
    </button>
  );
}

/**
 * Conversaciones anteriores de Claude del proyecto que no están en marcha en el
 * panel (terminadas o abiertas en otra ventana). Plegadas por defecto: se
 * retoman desde aquí y pasan a ser sesiones vivas del mismo proyecto.
 */
function Previous({ project, items, ahora }: { project: ProjectInfo; items: RecentSession[]; ahora: number }) {
  const { openResume } = useWorkspace();
  const [abierto, setAbierto] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const { shown, hidden } = visibleRecent(items, expandido);
  return (
    <div className="prev" role="group" aria-label={`${project.name}: conversaciones anteriores`}>
      <button type="button" className="prev__head" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <IconChevron size={11} className={`recent__chevron${abierto ? ' recent__chevron--open' : ''}`} />
        <IconClock size={12} className="prev__icon" />
        <span>Anteriores</span>
        <span className="prev__count">{items.length}</span>
      </button>
      {abierto && (
        <>
          {shown.map((r) => (
            <RecentRow key={r.id} r={r} ahora={ahora} onResume={() => openResume(r)} />
          ))}
          {items.length > RECENT_COLLAPSED && (
            <button type="button" className="rmore" aria-expanded={expandido} onClick={() => setExpandido(!expandido)}>
              {expandido ? 'Ver menos' : `Ver más (${hidden})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

type SidebarGroup = { project: ProjectInfo; sessions: SessionInfo[]; previous: RecentSession[] };

/** Une las sesiones vivas y las anteriores por proyecto: primero los que tienen sesiones vivas. */
function mergeGroups(vivas: ProjectGroup[], anteriores: RecentGroup[]): SidebarGroup[] {
  const porId = new Map<string, SidebarGroup>();
  for (const g of vivas) porId.set(g.project.id, { project: g.project, sessions: g.sessions, previous: [] });
  for (const g of anteriores) {
    const existente = porId.get(g.project.id);
    if (existente) existente.previous = g.items;
    else porId.set(g.project.id, { project: g.project, sessions: [], previous: g.items });
  }
  return [...porId.values()];
}

function Group({ g, ahora, menu }: { g: SidebarGroup; ahora: number; menu: MenuHandlers }) {
  const { visible, openSession } = useWorkspace();
  return (
    <section className="group" aria-label={g.project.name}>
      <div className="group__head">
        <Monogram project={g.project} />
        <span className="group__name">{g.project.name}</span>
        {g.sessions.length > 0 && (
          <span className="group__count" title="Sesiones en marcha en el panel">
            {g.sessions.length}
          </span>
        )}
      </div>
      {g.sessions.map((s) => (
        <SessionRow key={s.name} s={s} ahora={ahora} abierta={visible.includes(s.name)} onOpen={() => openSession(s.name)} menu={menu} />
      ))}
      {g.previous.length > 0 && <Previous project={g.project} items={g.previous} ahora={ahora} />}
    </section>
  );
}

export function Sidebar({ style }: { style?: CSSProperties }) {
  const { sessions, projects, loaded, error, recent } = useSessions();
  const { prefs, setPrefs } = useWorkspace();
  const ahora = useNow();
  const sinAbrir = useLiveUnopened();
  const { menu, onContextMenu, onKeyDown } = useSessionMenu({ withOpen: true });
  const vivas = groupSessions(sessions, projects, { hideClosed: prefs.hideClosed });
  const grupos = mergeGroups(vivas, groupRecent(recent, projects, { hideClosed: prefs.hideClosed }));
  const oculta = sessions.length - vivas.reduce((n, g) => n + g.sessions.length, 0);

  return (
    <aside className="sidebar" aria-label="Proyectos y sesiones" style={style}>
      <div className="sidebar__head">
        <span className="label-mono">
          ~/proyectos <span className="sidebar__count">({grupos.length})</span>
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Ocultar sesiones cerradas"
          aria-pressed={prefs.hideClosed}
          title={prefs.hideClosed ? 'Mostrar las sesiones cerradas' : 'Ocultar las sesiones cerradas'}
          onClick={() => setPrefs({ hideClosed: !prefs.hideClosed })}
        >
          <IconFilter size={15} />
        </button>
      </div>
      {grupos.map((g) => (
        <Group key={g.project.id} g={g} ahora={ahora} menu={{ onContextMenu, onKeyDown }} />
      ))}
      {loaded && grupos.length === 0 && (
        <p className="sidebar__empty">{error ?? (oculta > 0 ? 'Solo hay sesiones cerradas.' : 'Aún no hay sesiones.')}</p>
      )}
      <LiveSidebarSection items={sinAbrir} menu={{ onContextMenu, onKeyDown }} />
      <Legend sessions={sessions} />
      {menu}
    </aside>
  );
}

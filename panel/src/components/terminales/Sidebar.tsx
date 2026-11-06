import { useState } from 'react';
import type { CSSProperties } from 'react';
import { archivedEntries, notArchived } from '../../lib/archive.ts';
import { RECENT_COLLAPSED, agoLabel, groupRecent, recentPlace, visibleRecent } from '../../lib/recent.ts';
import type { RecentGroup } from '../../lib/recent.ts';
import { SHELL_AGENT, groupSessions, sessionMeta, visualState } from '../../lib/sessions.ts';
import type { ProjectGroup } from '../../lib/sessions.ts';
import { recentTip, sessionTip } from '../../lib/sidebarTip.ts';
import { formatRelative } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { ProjectInfo, RecentSession, SessionInfo } from '../../types.ts';
import { IconCheck, IconChevron, IconClock, IconFilter, IconPlus } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { ArchivedSection } from './ArchivedSessions.tsx';
import { useConversationMenu } from './ConversationMenu.tsx';
import { Legend } from './Legend.tsx';
import { LiveSidebarSection } from './LiveSessions.tsx';
import { RowTipBlock, RowTooltip, useRowTip } from './RowTooltip.tsx';
import { useSessionMenu } from './SessionMenu.tsx';
import { useLiveUnopened } from './useLiveUnopened.ts';

type MenuHandlers = Pick<ReturnType<typeof useSessionMenu>, 'onContextMenu' | 'onKeyDown'>;
type ConversationHandlers = Pick<ReturnType<typeof useConversationMenu>, 'onContextMenu' | 'onKeyDown'>;

function SessionRow({
  s,
  project,
  ahora,
  abierta,
  onOpen,
  menu,
}: {
  s: SessionInfo;
  project: ProjectInfo;
  ahora: number;
  abierta: boolean;
  onOpen: () => void;
  menu: MenuHandlers;
}) {
  const estado = visualState(s);
  const tip = useRowTip();
  return (
    <>
      <button
        type="button"
        className={`srow srow--${estado}`}
        aria-current={abierta ? 'true' : undefined}
        {...tip.props}
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
      {tip.anchor && <RowTooltip anchor={tip.anchor} id={tip.id} build={(t) => sessionTip(s, project, t)} />}
    </>
  );
}

function RecentRow({
  r,
  project,
  ahora,
  onResume,
  menu,
}: {
  r: RecentSession;
  project: ProjectInfo;
  ahora: number;
  onResume: () => void;
  menu: ConversationHandlers;
}) {
  const tip = useRowTip();
  return (
    <>
      <button
        type="button"
        className={`rrow${r.done ? ' rrow--done' : ''}`}
        aria-label={`Retomar en el panel: ${r.title}, ${recentPlace(r)}, ${agoLabel(r.lastActivity, ahora)}${r.done ? ', hecha' : ''}`}
        {...tip.props}
        onClick={onResume}
        onContextMenu={(e) => menu.onContextMenu(e, r)}
        onKeyDown={(e) => menu.onKeyDown(e, r)}
      >
        {/* Hecha: un check en lugar del reloj, como la luz de las sesiones vivas. */}
        {r.done ? <IconCheck size={13} strokeWidth={2.4} className="rrow__icon" /> : <IconClock size={13} className="rrow__icon" />}
        <span className="srow__text">
          <span className="srow__title">{r.title}</span>
          <span className="srow__meta">{recentPlace(r)}</span>
        </span>
        <span className="srow__time rrow__time">{formatRelative(r.lastActivity, ahora)}</span>
        <span className="rrow__action" aria-hidden="true">
          Retomar
        </span>
      </button>
      {tip.anchor && <RowTooltip anchor={tip.anchor} id={tip.id} build={(t) => recentTip(r, project, t)} />}
    </>
  );
}

/**
 * Conversaciones anteriores de Claude del proyecto que no están en marcha en el
 * panel (terminadas o abiertas en otra ventana). Plegadas por defecto: se
 * retoman desde aquí y pasan a ser sesiones vivas del mismo proyecto.
 */
function Previous({ project, items, ahora, menu }: { project: ProjectInfo; items: RecentSession[]; ahora: number; menu: ConversationHandlers }) {
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
            <RecentRow key={r.id} r={r} project={project} ahora={ahora} onResume={() => openResume(r)} menu={menu} />
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

/** «+» de cada proyecto: abre «Nueva sesión» con ese proyecto y la terminal sin agente elegidos. */
function NewTerminalButton({ project }: { project: ProjectInfo }) {
  const { openDialog } = useWorkspace();
  const etiqueta = `Nueva terminal en ${project.name}`;
  return (
    <button type="button" className="group__add" aria-label={etiqueta} title={etiqueta} onClick={() => openDialog({ project: project.id, agent: SHELL_AGENT })}>
      <IconPlus size={13} />
    </button>
  );
}

function Group({ g, ahora, menu, conversationMenu }: { g: SidebarGroup; ahora: number; menu: MenuHandlers; conversationMenu: ConversationHandlers }) {
  const { visible, openSession } = useWorkspace();
  return (
    <section className="group" aria-label={g.project.name}>
      <div className="group__head">
        <Monogram project={g.project} />
        <span className="group__name">{g.project.name}</span>
        <NewTerminalButton project={g.project} />
        {g.sessions.length > 0 && (
          <span className="group__count" title="Sesiones en marcha en el panel">
            {g.sessions.length}
          </span>
        )}
      </div>
      {g.sessions.map((s) => (
        <SessionRow key={s.name} s={s} project={g.project} ahora={ahora} abierta={visible.includes(s.name)} onOpen={() => openSession(s.name)} menu={menu} />
      ))}
      {g.previous.length > 0 && <Previous project={g.project} items={g.previous} ahora={ahora} menu={conversationMenu} />}
    </section>
  );
}

export function Sidebar({ style }: { style?: CSSProperties }) {
  const { sessions, projects, loaded, error, recent } = useSessions();
  const { prefs, setPrefs } = useWorkspace();
  const ahora = useNow();
  const sinAbrir = useLiveUnopened();
  const { menu, open: menuAbierto, onContextMenu, onKeyDown } = useSessionMenu({ withOpen: true });
  const conversacion = useConversationMenu();
  // Lo archivado sale de su proyecto, de «Anteriores» y de «En segundo plano»: tiene su propia sección.
  const activas = notArchived(sessions);
  const vivas = groupSessions(activas, projects, { hideDone: prefs.hideDone });
  const grupos = mergeGroups(vivas, groupRecent(notArchived(recent), projects, { hideDone: prefs.hideDone }));
  const oculta = activas.length - vivas.reduce((n, g) => n + g.sessions.length, 0);
  const archivadas = archivedEntries(sessions, recent, projects, { hideDone: prefs.hideDone });

  return (
    <aside className="sidebar" aria-label="Proyectos y sesiones" style={style}>
      <RowTipBlock value={menuAbierto || conversacion.open}>
        <div className="sidebar__head">
          <span className="label-mono">
            ~/proyectos <span className="sidebar__count">({grupos.length})</span>
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Ocultar hechas"
            aria-pressed={prefs.hideDone}
            title={prefs.hideDone ? 'Mostrar las sesiones hechas' : 'Ocultar las sesiones hechas'}
            onClick={() => setPrefs({ hideDone: !prefs.hideDone })}
          >
            <IconFilter size={15} />
          </button>
        </div>
        {grupos.map((g) => (
          <Group key={g.project.id} g={g} ahora={ahora} menu={{ onContextMenu, onKeyDown }} conversationMenu={conversacion} />
        ))}
        {loaded && grupos.length === 0 && (
          <p className="sidebar__empty">
            {error ??
              (oculta > 0 ? 'Solo hay sesiones hechas.' : archivadas.length > 0 ? 'Solo hay sesiones archivadas.' : 'Aún no hay sesiones.')}
          </p>
        )}
        <LiveSidebarSection items={sinAbrir} menu={{ onContextMenu, onKeyDown }} />
        <ArchivedSection entries={archivadas} session={{ onContextMenu, onKeyDown }} conversation={conversacion} />
        <Legend sessions={sessions} />
        {menu}
        {conversacion.menu}
      </RowTipBlock>
    </aside>
  );
}

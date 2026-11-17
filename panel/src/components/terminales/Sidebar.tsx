import { Fragment, useState } from 'react';
import type { CSSProperties } from 'react';
import { archivedEntries, notArchived } from '../../lib/archive.ts';
import { RECENT_COLLAPSED, agoLabel, groupRecent, recentPlace, visibleRecent } from '../../lib/recent.ts';
import { groupSessions, isRunning, sessionMeta, visualState } from '../../lib/sessions.ts';
import { mergeGroups } from '../../lib/sidebarGroups.ts';
import type { SidebarGroup } from '../../lib/sidebarGroups.ts';
import { recentTip, sessionTip } from '../../lib/sidebarTip.ts';
import { formatRelative } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { ProjectInfo, RecentSession, SessionInfo } from '../../types.ts';
import { IconCheck, IconChevronDown, IconClock, IconFilter, IconPlus } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { ArchivedSection } from './ArchivedSessions.tsx';
import { useConversationMenu } from './ConversationMenu.tsx';
import { Legend } from './Legend.tsx';
import { LiveSidebarSection } from './LiveSessions.tsx';
import { RunButton } from './RunButton.tsx';
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
        <StatusLight state={estado} label running={typeof s.run === 'string' && estado === 'shell'} />
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

/** «Ver más (N)» / «Ver menos» de una lista de conversaciones que enseña solo las primeras. */
function MoreButton({ total, hidden, expandido, onToggle }: { total: number; hidden: number; expandido: boolean; onToggle: () => void }) {
  if (total <= RECENT_COLLAPSED) return null;
  return (
    <button type="button" className="rmore rmore--side" aria-expanded={expandido} onClick={onToggle}>
      {expandido ? 'Ver menos' : `Ver más (${hidden})`}
    </button>
  );
}

/**
 * Conversaciones de Claude del proyecto sin terminar que no están en marcha en
 * el panel (cerradas sin marcar como hechas o abiertas en otra ventana). Se ven
 * sueltas bajo las sesiones vivas, para no perder de vista lo que quedó a medias
 * al abrir el panel; se retoman desde aquí y pasan a ser sesiones vivas.
 */
function Pending({ project, items, ahora, menu }: { project: ProjectInfo; items: RecentSession[]; ahora: number; menu: ConversationHandlers }) {
  const { openResume } = useWorkspace();
  const [expandido, setExpandido] = useState(false);
  const { shown, hidden } = visibleRecent(items, expandido);
  return (
    <div className="prev" role="group" aria-label={`${project.name}: conversaciones sin terminar`}>
      {shown.map((r) => (
        <RecentRow key={r.id} r={r} project={project} ahora={ahora} onResume={() => openResume(r)} menu={menu} />
      ))}
      <MoreButton total={items.length} hidden={hidden} expandido={expandido} onToggle={() => setExpandido(!expandido)} />
    </div>
  );
}

/** Conversaciones hechas del proyecto que no están en marcha en el panel. Plegadas por defecto. */
function Finished({ project, items, ahora, menu }: { project: ProjectInfo; items: RecentSession[]; ahora: number; menu: ConversationHandlers }) {
  const { openResume } = useWorkspace();
  const [abierto, setAbierto] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const { shown, hidden } = visibleRecent(items, expandido);
  return (
    <div className="prev" role="group" aria-label={`${project.name}: conversaciones terminadas`}>
      {/* Separador con etiqueta y flecha al final: no compite con las filas de conversación. */}
      <button type="button" className="fin__head" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <span className="fin__label">Terminadas</span>
        <span className="fin__line" aria-hidden="true" />
        <span className="fin__count">{items.length}</span>
        <IconChevronDown size={12} className={`fin__chevron${abierto ? ' fin__chevron--open' : ''}`} />
      </button>
      {abierto && (
        <>
          {shown.map((r) => (
            <RecentRow key={r.id} r={r} project={project} ahora={ahora} onResume={() => openResume(r)} menu={menu} />
          ))}
          <MoreButton total={items.length} hidden={hidden} expandido={expandido} onToggle={() => setExpandido(!expandido)} />
        </>
      )}
    </div>
  );
}


/** «+» de cada proyecto: abre «Nueva sesión» con ese proyecto y el agente por defecto (Claude salvo que se cambie). */
function NewTerminalButton({ project }: { project: ProjectInfo }) {
  const { openDialog } = useWorkspace();
  const etiqueta = `Nueva terminal en ${project.name}`;
  return (
    <button type="button" className="group__add" aria-label={etiqueta} title={etiqueta} onClick={() => openDialog({ project: project.id })}>
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
        <RunButton project={g.project} />
        {g.sessions.length > 0 && (
          <span className="group__count" title="Sesiones en marcha en el panel">
            {g.sessions.length}
          </span>
        )}
      </div>
      {g.sessions.map((s, i) => (
        <Fragment key={s.name}>
          {/* Separa las terminales de arranque en marcha (van primero) de las demás. */}
          {i > 0 && isRunning(g.sessions[i - 1]!) && !isRunning(s) && <hr className="group__sep" />}
          <SessionRow s={s} project={g.project} ahora={ahora} abierta={visible.includes(s.name)} onOpen={() => openSession(s.name)} menu={menu} />
        </Fragment>
      ))}
      {g.pending.length > 0 && <Pending project={g.project} items={g.pending} ahora={ahora} menu={conversationMenu} />}
      {g.done.length > 0 && <Finished project={g.project} items={g.done} ahora={ahora} menu={conversationMenu} />}
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
  // Lo archivado sale de su proyecto, de «Terminadas» y de «En segundo plano»: tiene su propia sección.
  const activas = notArchived(sessions);
  const vivas = groupSessions(activas, projects, { hideDone: prefs.hideDone });
  const grupos = mergeGroups(vivas, groupRecent(notArchived(recent), projects, { hideDone: prefs.hideDone }), projects);
  const oculta = activas.length - vivas.reduce((n, g) => n + g.sessions.length, 0);
  const archivadas = archivedEntries(sessions, recent, projects, { hideDone: prefs.hideDone });

  return (
    <aside className="sidebar" aria-label="Proyectos y sesiones" style={style}>
      <RowTipBlock value={menuAbierto || conversacion.open}>
        <div className="sidebar__head">
          <span className="sidebar__label">
            Proyectos <span className="sidebar__count">({grupos.length})</span>
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

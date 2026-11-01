import { useState } from 'react';
import { RECENT_COLLAPSED, agoLabel, groupRecent, recentPlace, visibleRecent } from '../../lib/recent.ts';
import type { RecentGroup } from '../../lib/recent.ts';
import { groupSessions, sessionMeta, visualState } from '../../lib/sessions.ts';
import type { ProjectGroup } from '../../lib/sessions.ts';
import { formatRelative } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { RecentSession, SessionInfo } from '../../types.ts';
import { IconChevron, IconClock, IconFilter } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { Legend } from './Legend.tsx';

function SessionRow({ s, ahora, abierta, onOpen }: { s: SessionInfo; ahora: number; abierta: boolean; onOpen: () => void }) {
  const estado = visualState(s);
  return (
    <button type="button" className={`srow srow--${estado}`} aria-current={abierta ? 'true' : undefined} onClick={onOpen}>
      <StatusLight state={estado} label />
      <span className="srow__text">
        <span className="srow__title">{s.title}</span>
        <span className="srow__meta">{sessionMeta(s)}</span>
      </span>
      <span className="srow__time">{formatRelative(s.updatedAt, ahora)}</span>
    </button>
  );
}

function Group({ g, ahora }: { g: ProjectGroup; ahora: number }) {
  const { visible, openSession } = useWorkspace();
  return (
    <section className="group" aria-label={g.project.name}>
      <div className="group__head">
        <Monogram project={g.project} />
        <span className="group__name">{g.project.name}</span>
        <span className="group__count">{g.sessions.length}</span>
      </div>
      {g.sessions.map((s) => (
        <SessionRow key={s.name} s={s} ahora={ahora} abierta={visible.includes(s.name)} onOpen={() => openSession(s.name)} />
      ))}
    </section>
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

function RecentGroupView({ g, ahora }: { g: RecentGroup; ahora: number }) {
  const { openResume } = useWorkspace();
  const [expandido, setExpandido] = useState(false);
  const { shown, hidden } = visibleRecent(g.items, expandido);
  return (
    <div className="group" role="group" aria-label={`${g.project.name}: sesiones recientes`}>
      <div className="group__head">
        <Monogram project={g.project} />
        <span className="group__name">{g.project.name}</span>
        <span className="group__count">{g.items.length}</span>
      </div>
      {shown.map((r) => (
        <RecentRow key={r.id} r={r} ahora={ahora} onResume={() => openResume(r)} />
      ))}
      {g.items.length > RECENT_COLLAPSED && (
        <button type="button" className="rmore" aria-expanded={expandido} onClick={() => setExpandido(!expandido)}>
          {expandido ? 'Ver menos' : `Ver más (${hidden})`}
        </button>
      )}
    </div>
  );
}

function RecentSection({ grupos, ahora }: { grupos: RecentGroup[]; ahora: number }) {
  const [abierto, setAbierto] = useState(true);
  const total = grupos.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return null;
  return (
    <section className="recent" aria-label="Sesiones recientes">
      <button type="button" className="recent__head" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>
        <IconChevron size={12} className={`recent__chevron${abierto ? ' recent__chevron--open' : ''}`} />
        <span className="label-mono">Sesiones recientes</span>
        <span className="group__count">{total}</span>
      </button>
      {abierto && grupos.map((g) => <RecentGroupView key={g.project.id} g={g} ahora={ahora} />)}
    </section>
  );
}

export function Sidebar() {
  const { sessions, projects, loaded, error, recent } = useSessions();
  const { prefs, setPrefs } = useWorkspace();
  const ahora = useNow();
  const grupos = groupSessions(sessions, projects, { hideClosed: prefs.hideClosed });
  const gruposRecientes = groupRecent(recent, projects, { hideClosed: prefs.hideClosed });
  const oculta = sessions.length - grupos.reduce((n, g) => n + g.sessions.length, 0);

  return (
    <aside className="sidebar" aria-label="Proyectos y sesiones">
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
        <Group key={g.project.id} g={g} ahora={ahora} />
      ))}
      {loaded && grupos.length === 0 && (
        <p className="sidebar__empty">{error ?? (oculta > 0 ? 'Solo hay sesiones cerradas.' : 'Aún no hay sesiones.')}</p>
      )}
      <RecentSection grupos={gruposRecientes} ahora={ahora} />
      <Legend sessions={sessions} />
    </aside>
  );
}

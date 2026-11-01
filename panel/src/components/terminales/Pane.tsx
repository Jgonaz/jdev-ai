import { fallbackProject, sessionPlace, stateChip, visualState } from '../../lib/sessions.ts';
import { formatRelative } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { TerminalBody } from './TerminalBody.tsx';

export function Pane({ session, suspended }: { session: SessionInfo; suspended: boolean }) {
  const { projects } = useSessions();
  const { workspace, activate } = useWorkspace();
  const ahora = useNow();
  const estado = visualState(session);
  const proyecto = projects.find((p) => p.id === session.project) ?? fallbackProject(session.project);
  const activa = workspace.active === session.name;

  return (
    <section
      id={`pane-${session.name}`}
      className={`pane pane--${estado}${activa ? ' pane--active' : ''}`}
      role="tabpanel"
      aria-labelledby={`tab-${session.name}`}
    >
      <div className="pane__head">
        <div className="pane__titles">
          <span className="pane__title">{session.title}</span>
          <span className="pane__sub">
            <span className="pane__square" style={{ color: proyecto.color }} aria-hidden="true">
              ■
            </span>{' '}
            {proyecto.name} · {sessionPlace(session)} · {session.agent}
          </span>
        </div>
        <span className={`chip chip--${estado}`}>{stateChip(session, formatRelative(session.updatedAt, ahora))}</span>
        <MoreMenu session={session} />
      </div>
      <TerminalBody name={session.name} active={activa} suspended={suspended} onFocus={() => !activa && activate(session.name)} />
    </section>
  );
}

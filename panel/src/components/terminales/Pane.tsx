import { fallbackProject, visualState } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import { PaneHeader } from './PaneHeader.tsx';
import { TerminalBody } from './TerminalBody.tsx';

export function Pane({ session, suspended }: { session: SessionInfo; suspended: boolean }) {
  const { projects } = useSessions();
  const { workspace, activate } = useWorkspace();
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
      <PaneHeader session={session} project={proyecto} />
      <TerminalBody name={session.name} active={activa} suspended={suspended} onFocus={() => !activa && activate(session.name)} />
    </section>
  );
}

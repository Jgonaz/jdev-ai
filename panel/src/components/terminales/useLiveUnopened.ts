import { useMemo } from 'react';
import { liveUnopened } from '../../lib/liveUnopened.ts';
import type { LiveItem } from '../../lib/liveUnopened.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';

/** Sesiones vivas del panel que no están en ninguna pestaña, con los filtros de la interfaz aplicados. */
export function useLiveUnopened(): LiveItem[] {
  const { sessions, projects } = useSessions();
  const { workspace, prefs } = useWorkspace();
  return useMemo(
    () => liveUnopened(sessions, projects, workspace.tabs, { hideDone: prefs.hideDone }),
    [sessions, projects, workspace.tabs, prefs.hideDone],
  );
}

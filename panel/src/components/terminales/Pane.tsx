import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { fallbackProject, visualState } from '../../lib/sessions.ts';
import { viewOf } from '../../lib/workspace.ts';
import type { PaneView } from '../../lib/workspace.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { SessionInfo } from '../../types.ts';
import { ChatBody } from './ChatBody.tsx';
import { PaneHeader } from './PaneHeader.tsx';
import { TerminalBody } from './TerminalBody.tsx';

export function Pane({ session, suspended }: { session: SessionInfo; suspended: boolean }) {
  const { projects } = useSessions();
  const { workspace, activate, setView, requestTerminalFocus } = useWorkspace();
  const estado = visualState(session);
  const proyecto = projects.find((p) => p.id === session.project) ?? fallbackProject(session.project);
  const activa = workspace.active === session.name;
  // La vista elegida se recuerda por pestaña, pero el chat solo se ve mientras la sesión lo permite.
  const vista: PaneView = viewOf(workspace, session.name) === 'chat' && session.chat.available ? 'chat' : 'terminal';
  const [buscando, setBuscando] = useState(false);
  const [pideBuscar, setPideBuscar] = useState(0);

  const cambiarVista = useCallback(
    (v: PaneView) => {
      setView(session.name, v);
      // La terminal sigue montada: al volver recupera el foco del teclado.
      if (v === 'terminal') requestTerminalFocus();
    },
    [setView, session.name, requestTerminalFocus],
  );

  // Ctrl+F (o ⌘F) con el foco dentro de este pane en vista chat abre la búsqueda de la conversación; no hay atajo global.
  const alPulsar = (e: KeyboardEvent<HTMLElement>) => {
    if (vista === 'chat' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setBuscando(true);
      setPideBuscar((n) => n + 1);
    }
  };

  return (
    <section
      id={`pane-${session.name}`}
      className={`pane pane--${estado}${activa ? ' pane--active' : ''}`}
      role="tabpanel"
      aria-labelledby={`tab-${session.name}`}
      onKeyDown={alPulsar}
    >
      <PaneHeader
        session={session}
        project={proyecto}
        view={vista}
        onView={cambiarVista}
        searching={buscando}
        onSearch={() => {
          setBuscando((b) => !b);
          setPideBuscar((n) => n + 1);
        }}
      />
      {/* La terminal no se desmonta al pasar al chat: así no se reconecta el WebSocket ni se pierde el scroll. */}
      <TerminalBody
        name={session.name}
        active={activa && vista === 'terminal'}
        suspended={suspended || vista === 'chat'}
        hidden={vista === 'chat'}
        onFocus={() => !activa && activate(session.name)}
      />
      {vista === 'chat' && (
        <ChatBody
          session={session}
          active={!suspended}
          searching={buscando}
          onSearching={setBuscando}
          searchTick={pideBuscar}
          onTerminal={() => cambiarVista('terminal')}
        />
      )}
    </section>
  );
}

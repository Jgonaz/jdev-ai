import type { CSSProperties } from 'react';
import { ownerSession } from '../../lib/follow.ts';
import { attachCommand, fallbackProject } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { Collapsible } from '../Collapsible.tsx';
import { MapPanel, noMapReason } from './MapPanel.tsx';
import { SessionDetails } from './SessionDetails.tsx';

/**
 * Panel derecho de Terminales: la sesión activa (o, en una pestaña de seguimiento, la que la lanzó) con su mapa de
 * actividad, la línea de «ahora» y dos desplegables, «Actividad reciente» y «Sesión», abiertos por defecto y con el
 * estado recordado. Sin mapa (Codex, terminal sin agente, conversación no disponible) va una nota con el motivo y «Sesión»
 * a la vista. `hidden` es que la pantalla está oculta.
 */
export function ContextPanel({ style, hidden = false }: { style?: CSSProperties; hidden?: boolean }) {
  const { sessions, projects, tmuxSocket } = useSessions();
  const { workspace, contextOverlay, closeContextOverlay, prefs, setPrefs, dialogOpen } = useWorkspace();
  const sesion = sessions.find((s) => s.name === ownerSession(workspace.active)) ?? null;
  const proyecto = sesion ? (projects.find((p) => p.id === sesion.project) ?? fallbackProject(sesion.project)) : null;
  const comando = sesion && tmuxSocket ? attachCommand(sesion.name, tmuxSocket) : '';
  const motivo = sesion ? noMapReason(sesion) : null;

  return (
    <aside
      className={`context${contextOverlay ? ' context--overlay' : ''}`}
      aria-label="Sesión y actividad"
      style={style}
      onKeyDown={(e) => {
        if (contextOverlay && e.key === 'Escape') closeContextOverlay();
      }}
    >
      {sesion && proyecto ? (
        <>
          <div className="context__who">
            <span className="context__whoname">{sesion.title}</span>
            <span className="context__whoagent">{sesion.agent === 'shell' ? 'terminal' : sesion.agent}</span>
          </div>
          <MapPanel session={sesion} active={!hidden && !dialogOpen} activityOpen={prefs.mapActivityOpen} onActivityToggle={(o) => setPrefs({ mapActivityOpen: o })} />
          {motivo !== null ? (
            <div className="context__ses context__ses--plain">
              <SessionDetails session={sesion} project={proyecto} command={comando} />
            </div>
          ) : (
            <div className="context__ses">
              <Collapsible
                title="Sesión"
                summary={`${proyecto.name} · ${sesion.branch ?? 'desconocida'}`}
                label={`Sesión, ${proyecto.name}, ${sesion.branch ?? 'rama desconocida'}`}
                open={prefs.mapSessionOpen}
                onToggle={(o) => setPrefs({ mapSessionOpen: o })}
              >
                <SessionDetails session={sesion} project={proyecto} command={comando} />
              </Collapsible>
            </div>
          )}
        </>
      ) : (
        <p className="context__empty">Abre una terminal para ver aquí su mapa de actividad y su sesión.</p>
      )}
    </aside>
  );
}

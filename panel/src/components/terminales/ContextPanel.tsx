import { useState } from 'react';
import { attachCommand, fallbackProject, sessionPlace } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { IconCopy } from '../Icons.tsx';

/** Contexto de la terminal activa: solo datos que ya conoce el panel. */
export function ContextPanel() {
  const { sessions, projects, tmuxSocket } = useSessions();
  const { workspace, contextOverlay, closeContextOverlay } = useWorkspace();
  const [copiado, setCopiado] = useState(false);
  const sesion = sessions.find((s) => s.name === workspace.active);
  const proyecto = sesion ? (projects.find((p) => p.id === sesion.project) ?? fallbackProject(sesion.project)) : null;
  const comando = sesion && tmuxSocket ? attachCommand(sesion.name, tmuxSocket) : '';

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(comando);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sin permiso para el portapapeles: el comando sigue visible para copiarlo a mano.
    }
  };

  return (
    <aside
      className={`context${contextOverlay ? ' context--overlay' : ''}`}
      aria-label="Contexto del proyecto"
      onKeyDown={(e) => {
        if (contextOverlay && e.key === 'Escape') closeContextOverlay();
      }}
    >
      <div className="context__head">
        <span className="context__eyebrow">Contexto</span>
        <span className="context__name">{proyecto?.name ?? 'Sin terminal activa'}</span>
        {sesion && <span className="context__branch">{sessionPlace(sesion)}</span>}
      </div>

      {sesion && proyecto ? (
        <>
          <section className="context__section" aria-labelledby="ctx-sesion">
            <h2 id="ctx-sesion" className="context__h">
              Sesión
            </h2>
            <dl className="context__dl">
              <dt>Proyecto</dt>
              <dd>{proyecto.name}</dd>
              <dt>Rama</dt>
              <dd className="mono-text">{sesion.branch ?? 'desconocida'}</dd>
              <dt>Worktree</dt>
              <dd className="mono-text">{sesion.worktree || 'checkout principal'}</dd>
              <dt>Agente</dt>
              <dd>{sesion.agent}</dd>
              {proyecto.path && (
                <>
                  <dt>Ruta</dt>
                  <dd className="mono-text context__path">{proyecto.path}</dd>
                </>
              )}
            </dl>
          </section>
          <section className="context__section" aria-labelledby="ctx-adjuntar">
            <h2 id="ctx-adjuntar" className="context__h">
              Adjuntar desde otra terminal
            </h2>
            <code className="context__cmd">{comando || 'Cargando…'}</code>
            <button type="button" className="btn btn--ghost btn--sm" disabled={!comando} onClick={() => void copiar()}>
              <IconCopy size={14} />
              {copiado ? 'Copiado' : 'Copiar comando'}
            </button>
          </section>
        </>
      ) : (
        <p className="context__empty">Abre una terminal para ver aquí su proyecto, rama y worktree.</p>
      )}

      <section className="context__section context__section--last" aria-labelledby="ctx-pronto">
        <h2 id="ctx-pronto" className="context__h">
          Backlog e historial
        </h2>
        <p className="context__soon">Backlog e historial: próximamente.</p>
      </section>
    </aside>
  );
}

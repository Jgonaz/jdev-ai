import { useState } from 'react';
import { rememberHistoryFilters } from '../../lib/history.ts';
import { historyHref, projectHref } from '../../lib/route.ts';
import type { ProjectInfo, SessionInfo } from '../../types.ts';
import { IconCopy } from '../Icons.tsx';

/**
 * Información de la sesión del panel derecho (solo datos que ya conoce el panel): proyecto, rama, worktree, agente y
 * ruta, el comando para adjuntarla desde otra terminal con su botón de copiar y los enlaces al backlog y al historial.
 * `comando` llega vacío mientras no se conoce el socket de tmux.
 */
export function SessionDetails({ session, project, command }: { session: SessionInfo; project: ProjectInfo; command: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sin permiso para el portapapeles: el comando sigue visible para copiarlo a mano.
    }
  };

  return (
    <div className="sesinfo">
      <dl className="sesinfo__dl">
        <dt>Proyecto</dt>
        <dd>{project.name}</dd>
        <dt>Rama</dt>
        <dd className="mono-text">{session.branch ?? 'desconocida'}</dd>
        <dt>Worktree</dt>
        <dd className="mono-text">{session.worktree || 'checkout principal'}</dd>
        <dt>Agente</dt>
        <dd>{session.agent === 'shell' ? 'Terminal (sin agente)' : session.agent}</dd>
        {project.path && (
          <>
            <dt>Ruta</dt>
            <dd className="mono-text">{project.path}</dd>
          </>
        )}
      </dl>
      <div className="sesinfo__attach">
        <span className="sesinfo__label">Adjuntar desde otra terminal</span>
        <code className="sesinfo__cmd">{command || 'Cargando…'}</code>
      </div>
      <div className="sesinfo__actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={!command} onClick={() => void copiar()}>
          <IconCopy size={14} />
          {copiado ? 'Copiado' : 'Copiar comando'}
        </button>
        <a className="btn btn--ghost btn--sm" href={projectHref('backlog', project.id)} aria-label={`Ver backlog de ${project.name}`}>
          Ver backlog
        </a>
        {/* Historial abre con el filtro recordado: se deja solo el de este proyecto. */}
        <a
          className="btn btn--ghost btn--sm"
          href={historyHref()}
          onClick={() => rememberHistoryFilters({ project: project.id })}
          aria-label={`Historial de ${project.name}`}
        >
          Historial del proyecto
        </a>
      </div>
    </div>
  );
}

import { aheadBehind } from '../../lib/backlog.ts';
import { visualState } from '../../lib/sessions.ts';
import type { ProjectInfo, SessionInfo, WorktreeDetail, WorktreeList } from '../../types.ts';
import { IconPlus } from '../Icons.tsx';
import { StatusLight } from '../StatusLight.tsx';

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" focusable="false">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="9" r="2" />
      <path d="M6 7v10M18 11c0 4-6 3-12 6" />
    </svg>
  );
}

/** Botones de las sesiones del panel en un worktree; al pulsar se abre su terminal. */
export function SessionLinks(props: { names: string[]; sessions: readonly SessionInfo[]; onOpen: (name: string) => void }) {
  const conocidas = props.names.map((n) => props.sessions.find((s) => s.name === n)).filter((s) => s !== undefined);
  if (conocidas.length === 0) return null;
  return (
    <ul className="wt__sessions" aria-label="Sesiones del panel">
      {conocidas.map((s) => (
        <li key={s.name}>
          <button type="button" className="wt__session" onClick={() => props.onOpen(s.name)} aria-label={`Ir a la terminal: ${s.title}`}>
            <StatusLight state={visualState(s)} label />
            <span>{s.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Franja del diseño con el worktree que tiene sesiones del panel. */
export function WorktreeStrip(props: { worktree: WorktreeDetail; sessions: readonly SessionInfo[]; onOpen: (name: string) => void }) {
  const w = props.worktree;
  const primera = w.sessions.find((n) => props.sessions.some((s) => s.name === n));
  const trabajando = w.sessions.filter((n) => props.sessions.find((s) => s.name === n && visualState(s) === 'working')).length;
  return (
    <div className="wtstrip">
      <BranchIcon />
      <span className="wtstrip__branch">{w.branch ?? w.name}</span>
      {w.ahead !== null && w.ahead > 0 && <span className="wtstrip__meta">+{w.ahead} {w.ahead === 1 ? 'commit' : 'commits'}</span>}
      <span className="wtstrip__meta">
        {trabajando > 0 ? (
          <span className="wtstrip__working">
            <StatusLight state="working" />
            {trabajando === 1 ? '1 sesión trabajando' : `${trabajando} sesiones trabajando`}
          </span>
        ) : w.sessions.length === 1 ? (
          '1 sesión en el panel'
        ) : (
          `${w.sessions.length} sesiones en el panel`
        )}
      </span>
      {primera && (
        <button type="button" className="link-btn wtstrip__go" onClick={() => props.onOpen(primera)}>
          Ir a la terminal
        </button>
      )}
    </div>
  );
}

export function WorktreesTab(props: {
  project: ProjectInfo;
  data: WorktreeList | null;
  error: string | null;
  sessions: readonly SessionInfo[];
  onOpenSession: (name: string) => void;
  onNewSession: (worktree: string) => void;
}) {
  const { project, data } = props;
  if (project.harness) return <p className="ptab__empty">El propio harness no admite worktrees: se trabaja siempre sobre su checkout principal.</p>;
  if (props.error) return <p className="ptab__error" role="alert">{props.error}</p>;
  if (!data) return <p className="ptab__empty">Cargando…</p>;
  const base = data.base ?? 'la rama principal';
  return (
    <div className="wt">
      <p className="ptab__note">
        Los elementos del backlog que se creen o muevan en una rama de worktree no se ven aquí hasta que se integran en {base}.
      </p>
      {data.worktrees.length === 0 ? (
        <p className="ptab__empty">No hay worktrees abiertos en este proyecto.</p>
      ) : (
        <ul className="wt__list">
          {data.worktrees.map((w) => {
            const ab = aheadBehind(w.ahead, w.behind);
            return (
              <li key={w.name} className="wt__item">
                <div className="wt__row">
                  <BranchIcon />
                  <span className="wt__branch">{w.branch ?? '(sin rama)'}</span>
                  <span className="wt__name">{w.name}</span>
                  {ab && (
                    <span className="wt__ab" title={`Commits por delante y por detrás de ${base}`}>
                      <span className="sr-only">Respecto a {base}: </span>
                      {ab}
                    </span>
                  )}
                  {w.dirty && <span className="wt__dirty">cambios sin commit</span>}
                  <button type="button" className="btn btn--ghost btn--sm wt__new" onClick={() => props.onNewSession(w.name)}>
                    <IconPlus size={13} />
                    Nueva sesión aquí
                  </button>
                </div>
                <SessionLinks names={w.sessions} sessions={props.sessions} onOpen={props.onOpenSession} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

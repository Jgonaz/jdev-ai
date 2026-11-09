import { visualState } from '../../lib/sessions.ts';
import type { SessionInfo, WorktreeInfo } from '../../types.ts';
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

/** Botones de las sesiones del panel en un lugar (checkout principal o worktree); al pulsar se abre su terminal. */
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
export function WorktreeStrip(props: { worktree: WorktreeInfo; sessions: readonly SessionInfo[]; onOpen: (name: string) => void }) {
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

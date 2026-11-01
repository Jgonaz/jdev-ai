import { visualState } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';

/** Barra de estado estilo tmux: ventanas abiertas, atajos y recuento. */
export function StatusBar() {
  const { sessions, projects } = useSessions();
  const { workspace, visible } = useWorkspace();
  const vivas = sessions.filter((s) => s.alive).length;

  return (
    <footer className="statusbar" aria-label="Barra de estado">
      <span className="statusbar__session">[jdev]</span>
      <span className="statusbar__windows">
        {workspace.tabs.map((name, i) => {
          const s = sessions.find((x) => x.name === name);
          if (!s) return null;
          const estado = visualState(s);
          const activa = workspace.active === name;
          const marca = activa ? '*' : estado === 'waiting' ? '!' : '';
          const nombre = projects.find((p) => p.id === s.project)?.name ?? s.project;
          return (
            <span key={name} className={`statusbar__win${activa ? ' is-active' : ''}${estado === 'waiting' ? ' is-waiting' : ''}`}>
              {i}:{nombre}
              {marca}
            </span>
          );
        })}
      </span>
      <span className="statusbar__keys">
        <kbd>Ctrl+Alt+←/→</kbd> cambia de terminal
        <span className="statusbar__extra">
          {' '}
          · <kbd>Ctrl+Alt+N</kbd> nueva · <kbd>Ctrl+Alt+L</kbd> distribución · <kbd>Ctrl+Alt+Esc</kbd> sale de la terminal
        </span>
      </span>
      <span className="statusbar__sep" aria-hidden="true">
        │
      </span>
      <span>
        {vivas} {vivas === 1 ? 'viva' : 'vivas'} · {visible.length} {visible.length === 1 ? 'visible' : 'visibles'}
      </span>
    </footer>
  );
}

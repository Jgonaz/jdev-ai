import { projectHref, routeHref } from '../lib/route.ts';
import type { Route } from '../lib/route.ts';
import { waitingCount, waitingLabel } from '../lib/sessions.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import { IconPlus } from './Icons.tsx';
import { Logo } from './Logo.tsx';

function Disabled({ label }: { label: string }) {
  return (
    // Sin enlace real: estas pantallas llegan en versiones posteriores.
    <span className="nav__link nav__link--disabled" role="link" aria-disabled="true" tabIndex={-1} title="Próximamente" aria-label={`${label} (próximamente)`}>
      {label}
    </span>
  );
}

export function Header({ route }: { route: Route }) {
  const { sessions } = useSessions();
  const { openDialog } = useWorkspace();
  const esperan = waitingCount(sessions);

  return (
    <header className="header">
      <a className="header__logo" href={routeHref('terminales')} aria-label="jdev-ai, ir a Terminales">
        <Logo />
      </a>
      <nav className="nav" aria-label="Secciones">
        <Disabled label="Inicio" />
        <a className="nav__link" href={routeHref('terminales')} aria-current={route === 'terminales' ? 'page' : undefined}>
          Terminales
        </a>
        <a className="nav__link" href={projectHref()} aria-current={route === 'proyectos' ? 'page' : undefined}>
          Proyectos
        </a>
        <Disabled label="Historial" />
        <a className="nav__link" href={routeHref('ajustes')} aria-current={route === 'ajustes' ? 'page' : undefined}>
          Ajustes
        </a>
      </nav>
      {route === 'ajustes' ? (
        <span className="header__path" title="Ubicación por defecto; respeta XDG_CONFIG_HOME">
          ~/.config/jdev-ai/panel.json
        </span>
      ) : (
        <div className="header__right">
          {esperan > 0 && (
            <div className="pill" role="status">
              <span className="pill__dot" aria-hidden="true" />
              {waitingLabel(esperan)}
            </div>
          )}
          <button type="button" className="btn btn--accent" onClick={() => openDialog()}>
            <IconPlus size={14} />
            Nueva sesión
          </button>
        </div>
      )}
    </header>
  );
}

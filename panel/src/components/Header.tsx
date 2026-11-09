import { historyHref, isProjectScreen, routeHref } from '../lib/route.ts';
import type { Route } from '../lib/route.ts';
import { waitingChip } from '../lib/inicio.ts';
import { waitingCount, waitingLabel } from '../lib/sessions.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import { HeaderAgent } from './HeaderAgent.tsx';
import { HeaderLimits } from './HeaderLimits.tsx';
import { HeaderShortcuts } from './HeaderShortcuts.tsx';
import { IconPlus } from './Icons.tsx';
import { Logo } from './Logo.tsx';
import { ProjectsMenu } from './ProjectsMenu.tsx';

export function Header({ route }: { route: Route | null }) {
  const { sessions } = useSessions();
  const { openDialog } = useWorkspace();
  const esperan = waitingCount(sessions);

  return (
    <header className="header">
      <a className="header__logo" href={routeHref('inicio')} aria-label="jdev-ai, ir a Inicio">
        <Logo />
      </a>
      <nav className="nav" aria-label="Secciones">
        <a className="nav__link" href={routeHref('inicio')} aria-current={route === 'inicio' ? 'page' : undefined}>
          Inicio
        </a>
        <a className="nav__link" href={routeHref('terminales')} aria-current={route === 'terminales' ? 'page' : undefined}>
          Terminales
        </a>
        <ProjectsMenu pantalla={isProjectScreen(route) ? route : null} />
        <a className="nav__link" href={historyHref()} aria-current={route === 'historial' ? 'page' : undefined}>
          Historial
        </a>
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
          <HeaderAgent />
          <HeaderLimits />
          {esperan > 0 && (
            <div className="pill" role="status">
              <span className="pill__dot" aria-hidden="true" />
              <span className="pill__long">{waitingLabel(esperan)}</span>
              <span className="pill__short" aria-hidden="true">
                {waitingChip(esperan)}
              </span>
            </div>
          )}
          <HeaderShortcuts />
          <button type="button" className="btn btn--accent" aria-label="Nueva sesión" title="Nueva sesión" onClick={() => openDialog()}>
            <IconPlus size={14} />
            <span className="btn__label">Nueva sesión</span>
          </button>
        </div>
      )}
    </header>
  );
}

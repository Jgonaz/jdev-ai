import { useEffect, useRef } from 'react';
import { ResizeHandle } from '../components/ResizeHandle.tsx';
import { usePanelWidth } from '../lib/usePanelWidth.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import type { PanelLimits } from '../lib/panelWidth.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import { useImages } from '../state/ImagesContext.tsx';
import { useSettings } from '../state/SettingsContext.tsx';
import { ImageViewer } from '../components/terminales/ImageViewer.tsx';
import { ContextPanel } from '../components/terminales/ContextPanel.tsx';
import { EmptyState } from '../components/terminales/EmptyState.tsx';
import { IconPlus } from '../components/Icons.tsx';
import { Pane } from '../components/terminales/Pane.tsx';
import { Sidebar } from '../components/terminales/Sidebar.tsx';
import { StatusBar } from '../components/terminales/StatusBar.tsx';
import { TabsBar } from '../components/terminales/TabsBar.tsx';

const SIDEBAR_LIMITS: PanelLimits = { min: 200, max: 480, default: 280 };
/** Ancho del panel derecho: Contexto y visor comparten hueco y también ancho. */
const RIGHT_LIMITS: PanelLimits = { min: 280, max: 720, default: 320 };
/** Igual que el `@media` de `.sidebar` en terminales.css, donde la barra pasa a tener un ancho fijo. */
const SIDEBAR_COMPACT_QUERY = '(max-width: 800px)';

/** Pantalla Terminales. Se mantiene montada (oculta) al ir a Ajustes para no perder las terminales. */
export function TerminalesScreen({ hidden }: { hidden: boolean }) {
  const { sessions, connected, loaded } = useSessions();
  const { workspace, visible, contextVisible, contextOverlay, dialogOpen, openDialog } = useWorkspace();
  const { settings } = useSettings();
  const { viewer, followTerminal } = useImages();
  const compacta = useMediaQuery(SIDEBAR_COMPACT_QUERY);
  const izquierdo = usePanelWidth('terminales-izquierdo', SIDEBAR_LIMITS);
  // El visor tiene otro ancho por defecto que Contexto (el de su `clamp` en CSS).
  const derecho = usePanelWidth('terminales-derecho', {
    ...RIGHT_LIMITS,
    default: viewer ? Math.min(520, Math.max(380, Math.round(window.innerWidth * 0.36))) : RIGHT_LIMITS.default,
  });
  const derechoEnLinea = (viewer !== null || contextVisible) && !contextOverlay;

  // El visor sigue a la terminal activa: al cambiar de pestaña muestra la última imagen de la nueva
  // terminal o, si no tiene ninguna, se cierra y vuelve el panel de Contexto.
  const activa = workspace.active;
  const activaPrevia = useRef(activa);
  useEffect(() => {
    if (activaPrevia.current === activa) return;
    activaPrevia.current = activa;
    followTerminal(activa);
  }, [activa, followTerminal]);

  const abiertas = visible.map((n) => sessions.find((s) => s.name === n)).filter((s) => s !== undefined);
  const huecos = workspace.layout - abiertas.length;

  return (
    <div className="screen screen--terminales" hidden={hidden}>
      {loaded && !connected && (
        <div className="banner" role="status">
          Sin conexión con el panel. Reintentando…
        </div>
      )}
      <div className="workspace">
        <Sidebar style={izquierdo.style('--sidebar-w', !compacta)} />
        {!compacta && (
          <ResizeHandle
            side="left"
            limits={SIDEBAR_LIMITS}
            panel={izquierdo}
            label="Ancho de la barra de proyectos y sesiones"
            reserved={derechoEnLinea ? derecho.width : 0}
          />
        )}
        <main className="main">
          <TabsBar />
          {workspace.tabs.length === 0 ? (
            <div className="canvas canvas--empty">
              <EmptyState haySesiones={sessions.length > 0} />
            </div>
          ) : (
            <div className={`canvas canvas--l${workspace.layout}`}>
              {abiertas.map((s) => (
                <Pane key={s.name} session={s} suspended={dialogOpen || hidden} />
              ))}
              {Array.from({ length: Math.max(0, huecos) }, (_, i) => (
                <div key={`hueco-${i}`} className="slot">
                  <span>Hueco libre</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => openDialog()}>
                    <IconPlus size={13} />
                    Nueva sesión
                  </button>
                </div>
              ))}
            </div>
          )}
          {settings.terminal.tmuxBar && <StatusBar />}
        </main>
        {/* El visor ocupa el lugar del panel de contexto mientras está abierto; al cerrarlo vuelve el estado previo. */}
        {derechoEnLinea && (
          <ResizeHandle
            side="right"
            limits={RIGHT_LIMITS}
            panel={derecho}
            label={viewer ? 'Ancho del visor de imágenes' : 'Ancho del panel de contexto'}
            reserved={compacta ? 220 : izquierdo.width}
          />
        )}
        {viewer ? (
          <ImageViewer target={viewer} style={derecho.style('--right-w', !contextOverlay)} />
        ) : (
          contextVisible && <ContextPanel style={derecho.style('--right-w', !contextOverlay)} />
        )}
      </div>
    </div>
  );
}

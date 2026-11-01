import { useCallback, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { NewSessionDialog } from './components/NewSessionDialog.tsx';
import { ResumeDialog } from './components/ResumeDialog.tsx';
import { focusActiveTab } from './lib/focus.ts';
import { useAlerts } from './lib/useAlerts.ts';
import { useRoute } from './lib/route.ts';
import { useShortcuts } from './lib/useShortcuts.ts';
import { HistorialScreen } from './screens/HistorialScreen.tsx';
import { InicioScreen } from './screens/InicioScreen.tsx';
import { ProyectosScreen } from './screens/ProyectosScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { TerminalesScreen } from './screens/TerminalesScreen.tsx';
import { ImagesProvider } from './state/ImagesContext.tsx';
import { SessionsProvider } from './state/SessionsContext.tsx';
import { SettingsProvider, useSettings } from './state/SettingsContext.tsx';
import { WorkspaceProvider, useWorkspace } from './state/WorkspaceContext.tsx';

function Shell() {
  const { settings, loaded: ajustesListos, loadError } = useSettings();
  const { ruta, proyecto, elemento, implicita, navegar, reemplazar } = useRoute(settings.startScreen);
  const { dialogOpen, newSessionOpen, resumeTarget, openDialog, move, cycleLayout, requestTerminalFocus } = useWorkspace();
  // Sin ruta, la pantalla depende de un ajuste: hasta tenerlo no se muestra ninguna.
  const pendiente = implicita && !ajustesListos;
  const irATerminales = useCallback(() => navegar('terminales'), [navegar]);

  // Al volver a Terminales la terminal activa recupera el foco.
  useEffect(() => {
    if (ruta === 'terminales') requestTerminalFocus();
  }, [ruta, requestTerminalFocus]);

  useAlerts(irATerminales);
  useShortcuts(
    {
      prev: () => move(-1),
      next: () => move(1),
      newSession: () => {
        navegar('terminales');
        openDialog();
      },
      cycleLayout,
      focusTabs: () => {
        navegar('terminales');
        focusActiveTab();
      },
    },
    !dialogOpen,
  );

  return (
    <div className="app">
      <Header route={pendiente ? null : ruta} />
      {loadError && (
        <div className="banner banner--error" role="alert">
          No se pudieron cargar los ajustes: {loadError}
        </div>
      )}
      <TerminalesScreen hidden={pendiente || ruta !== 'terminales'} />
      {!pendiente && ruta === 'inicio' && <InicioScreen onGoToTerminal={irATerminales} />}
      {ruta === 'proyectos' && <ProyectosScreen project={proyecto} item={elemento} onGoToTerminal={irATerminales} onReplaceHash={reemplazar} />}
      {ruta === 'historial' && <HistorialScreen project={proyecto} file={elemento} onReplaceHash={reemplazar} />}
      {ruta === 'ajustes' && <SettingsScreen />}
      {newSessionOpen && <NewSessionDialog onCreated={irATerminales} />}
      {resumeTarget && <ResumeDialog recent={resumeTarget} onCreated={irATerminales} />}
    </div>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <SessionsProvider>
        <WorkspaceProvider>
          <ImagesProvider>
            <Shell />
          </ImagesProvider>
        </WorkspaceProvider>
      </SessionsProvider>
    </SettingsProvider>
  );
}

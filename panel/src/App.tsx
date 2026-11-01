import { useCallback, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { NewSessionDialog } from './components/NewSessionDialog.tsx';
import { ResumeDialog } from './components/ResumeDialog.tsx';
import { focusActiveTab } from './lib/focus.ts';
import { useAlerts } from './lib/useAlerts.ts';
import { useRoute } from './lib/route.ts';
import { useShortcuts } from './lib/useShortcuts.ts';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { TerminalesScreen } from './screens/TerminalesScreen.tsx';
import { ImagesProvider } from './state/ImagesContext.tsx';
import { SessionsProvider } from './state/SessionsContext.tsx';
import { SettingsProvider, useSettings } from './state/SettingsContext.tsx';
import { WorkspaceProvider, useWorkspace } from './state/WorkspaceContext.tsx';

function Shell() {
  const { ruta, navegar, aviso, descartarAviso } = useRoute();
  const { dialogOpen, newSessionOpen, resumeTarget, openDialog, move, cycleLayout, requestTerminalFocus } = useWorkspace();
  const { loadError } = useSettings();
  const irATerminales = useCallback(() => navegar('terminales'), [navegar]);

  // Al volver a Terminales la terminal activa recupera el foco.
  useEffect(() => {
    if (ruta === 'terminales') requestTerminalFocus();
  }, [ruta, requestTerminalFocus]);

  // El aviso «Próximamente» se retira solo.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(descartarAviso, 4500);
    return () => window.clearTimeout(t);
  }, [aviso, descartarAviso]);

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
      <Header route={ruta} />
      {loadError && (
        <div className="banner banner--error" role="alert">
          No se pudieron cargar los ajustes: {loadError}
        </div>
      )}
      <TerminalesScreen hidden={ruta !== 'terminales'} />
      {ruta === 'ajustes' && <SettingsScreen />}
      {aviso && (
        <div className="toast" role="status">
          {aviso}: próximamente.
        </div>
      )}
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

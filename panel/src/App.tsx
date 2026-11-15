import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { Header } from './components/Header.tsx';
import { NewSessionDialog } from './components/NewSessionDialog.tsx';
import { ResumeDialog } from './components/ResumeDialog.tsx';
import { CloseDoneDialog } from './components/terminales/CloseDoneDialog.tsx';
import { focusActiveTab } from './lib/focus.ts';
import { ownerSession } from './lib/follow.ts';
import { loadLastSession, saveLastSession, suggestSession } from './lib/lastSession.ts';
import { liveUnopened, pickBackgroundSession } from './lib/liveUnopened.ts';
import { useAlerts } from './lib/useAlerts.ts';
import { useRoute } from './lib/route.ts';
import { useShortcuts } from './lib/useShortcuts.ts';
import { BacklogScreen } from './screens/BacklogScreen.tsx';
import { GuiasScreen } from './screens/GuiasScreen.tsx';
import { HistorialScreen } from './screens/HistorialScreen.tsx';
import { InicioScreen } from './screens/InicioScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { TerminalesScreen } from './screens/TerminalesScreen.tsx';
import { CambiosScreen } from './screens/CambiosScreen.tsx';
import { ImagesProvider } from './state/ImagesContext.tsx';
import { SessionsProvider, useSessions } from './state/SessionsContext.tsx';
import { SettingsProvider, useSettings } from './state/SettingsContext.tsx';
import { WorkspaceProvider, useWorkspace } from './state/WorkspaceContext.tsx';

const AVISO_MS = 8000;

function Shell() {
  const { settings, loaded: ajustesListos, loadError } = useSettings();
  const { ruta, proyecto, elemento, implicita, navegar, reemplazar } = useRoute(settings.startScreen);
  const { sessions, projects, upsert } = useSessions();
  const {
    workspace,
    dialogOpen,
    newSessionOpen,
    resumeTarget,
    openDialog,
    openSession,
    startLaunch,
    requestClose,
    closedOrder,
    move,
    cycleLayout,
    requestTerminalFocus,
  } = useWorkspace();
  // Aviso de un fallo al crear la sesión con Ctrl+T, que no tiene diálogo donde mostrarlo.
  const [avisoRapido, setAvisoRapido] = useState<string | null>(null);
  const creandoRapido = useRef(false);
  // Sin ruta, la pantalla depende de un ajuste: hasta tenerlo no se muestra ninguna.
  const pendiente = implicita && !ajustesListos;
  const irATerminales = useCallback(() => navegar('terminales'), [navegar]);

  // Al volver a Terminales la terminal activa recupera el foco.
  useEffect(() => {
    if (ruta === 'terminales') requestTerminalFocus();
  }, [ruta, requestTerminalFocus]);

  useEffect(() => {
    if (avisoRapido === null) return;
    const t = window.setTimeout(() => setAvisoRapido(null), AVISO_MS);
    return () => window.clearTimeout(t);
  }, [avisoRapido]);

  // Ctrl+T: sesión nueva sin diálogo, en el checkout principal, con el último proyecto y agente.
  // Ctrl+Mayús+N (`agentePorDefecto`): igual, pero con el agente por defecto de Ajustes.
  const sesionRapida = async (agentePorDefecto = false) => {
    if (creandoRapido.current) return;
    const activa = sessions.find((x) => x.name === ownerSession(workspace.active));
    const sugerida = suggestSession({
      projects,
      last: loadLastSession(),
      activeProject: activa?.project,
      settingsAgent: settings.newSession.agent,
    });
    const project = sugerida.project;
    const agent = agentePorDefecto ? settings.newSession.agent : sugerida.agent;
    navegar('terminales');
    if (!project) {
      openDialog();
      return;
    }
    creandoRapido.current = true;
    setAvisoRapido(null);
    try {
      const r = await api.createSession({ project, agent, location: 'main' });
      upsert(r.session);
      openSession(r.session.name);
      startLaunch(r.session.name);
      saveLastSession({ project, agent });
    } catch (e) {
      setAvisoRapido(`No se pudo crear la sesión: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      creandoRapido.current = false;
    }
  };

  // Ctrl+Alt+T: vuelve a la sesión que más recientemente se mandó a segundo plano.
  const reabrirSegundoPlano = () => {
    const elegida = pickBackgroundSession(liveUnopened(sessions, projects, workspace.tabs), closedOrder());
    if (!elegida) return;
    navegar('terminales');
    openSession(elegida.session.name);
    requestTerminalFocus();
  };

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
      closeTab: () => {
        if (ruta === 'terminales' && workspace.active) requestClose(workspace.active);
      },
      quickSession: () => void sesionRapida(),
      quickDefaultSession: () => void sesionRapida(true),
      lastBackground: reabrirSegundoPlano,
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
      {avisoRapido && (
        <div className="banner banner--error" role="alert">
          {avisoRapido}
        </div>
      )}
      <TerminalesScreen hidden={pendiente || ruta !== 'terminales'} />
      {!pendiente && ruta === 'inicio' && <InicioScreen onGoToTerminal={irATerminales} />}
      {ruta === 'backlog' && <BacklogScreen project={proyecto} item={elemento} onGoToTerminal={irATerminales} onReplaceHash={reemplazar} />}
      {ruta === 'cambios' && <CambiosScreen project={proyecto} item={elemento} onGoToTerminal={irATerminales} onReplaceHash={reemplazar} />}
      {ruta === 'guias' && <GuiasScreen project={proyecto} item={elemento} onReplaceHash={reemplazar} />}
      {ruta === 'historial' && <HistorialScreen project={proyecto} file={elemento} onReplaceHash={reemplazar} />}
      {ruta === 'ajustes' && <SettingsScreen />}
      {newSessionOpen && <NewSessionDialog onCreated={irATerminales} />}
      {resumeTarget && <ResumeDialog recent={resumeTarget} onCreated={irATerminales} />}
      <CloseDoneDialog />
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

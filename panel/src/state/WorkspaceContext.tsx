import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { AgentId } from '../types.ts';
import type { ReactNode } from 'react';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { followKey, isFollowKey } from '../lib/follow.ts';
import type { FollowKind } from '../lib/follow.ts';
import { forgetBtw } from '../lib/btw.ts';
import { forgetConversation } from '../lib/useConversation.ts';
import { forgetFollow } from '../lib/useFollow.ts';
import { visualState } from '../lib/sessions.ts';
import {
  EMPTY_WORKSPACE,
  loadUiPrefs,
  loadWorkspace,
  saveUiPrefs,
  saveWorkspace,
  visibleTabs,
  workspaceReducer,
} from '../lib/workspace.ts';
import type { Layout, PaneView, UiPrefs, Workspace } from '../lib/workspace.ts';
import { useSessions } from './SessionsContext.tsx';
import { useSettings } from './SettingsContext.tsx';
import type { LocationId, RecentSession, SessionInfo } from '../types.ts';

type WorkspaceValue = {
  workspace: Workspace;
  visible: string[];
  openSession: (name: string, opciones?: { nextToActive?: boolean; minLayout?: Layout }) => void;
  /** Abre la pestaña de seguimiento de un subagente o una shell en segundo plano (o la activa si ya está abierta). */
  openFollow: (session: string, kind: FollowKind, id: string) => void;
  activate: (name: string) => void;
  /** Cambia una pestaña entre la vista de terminal y la de chat (se recuerda por pestaña). */
  setView: (name: string, view: PaneView) => void;
  closeTab: (name: string) => void;
  move: (delta: number) => void;
  /** Lleva una pestaña a otra posición (arrastrándola en la barra). */
  reorder: (name: string, to: number) => void;
  setLayout: (layout: Layout) => void;
  cycleLayout: () => void;
  /** Algún diálogo modal (nueva sesión o retomar) está abierto. */
  dialogOpen: boolean;
  newSessionOpen: boolean;
  /** Valores con los que se abrió Nueva sesión (p. ej. desde Proyectos); null con los de siempre. */
  newSessionInit: NewSessionInit | null;
  openDialog: (init?: NewSessionInit) => void;
  closeDialog: () => void;
  /** Sesión reciente cuyo diálogo «Retomar en el panel» está abierto. */
  resumeTarget: RecentSession | null;
  openResume: (r: RecentSession) => void;
  closeResume: () => void;
  prefs: UiPrefs;
  setPrefs: (parche: Partial<UiPrefs>) => void;
  /** Panel de contexto visible ahora: la preferencia en anchos grandes, el desplegable en estrechos. */
  contextVisible: boolean;
  /** El panel de contexto va superpuesto (ancho estrecho). */
  contextOverlay: boolean;
  toggleContext: () => void;
  closeContextOverlay: () => void;
  /** Pide que la terminal activa tome el foco en cuanto pueda (hasta ~3 s). */
  requestTerminalFocus: () => void;
  /** Aumenta con cada petición de foco; las terminales lo usan para reaccionar. */
  focusTick: number;
  /** Consume una petición de foco pendiente. */
  takeFocusRequest: () => boolean;
};

/** Valores iniciales de Nueva sesión. */
export type NewSessionInit = {
  project?: string;
  prompt?: string;
  location?: LocationId;
  /** Nombre del worktree existente (con location «existing-worktree»). */
  worktree?: string;
  /** Agente preseleccionado (p. ej. «Nueva terminal» de la barra lateral abre con la terminal sin agente). */
  agent?: AgentId;
};

/** Debajo de este ancho el panel de contexto no cabe junto a las terminales. */
export const CONTEXT_NARROW_QUERY = '(max-width: 1100px)';
const FOCUS_REQUEST_MS = 3000;

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { settings, loaded: ajustesListos } = useSettings();
  const { sessions, loaded: sesionesListas } = useSessions();
  const guardado = useRef(loadWorkspace());
  const [workspace, dispatch] = useReducer(workspaceReducer, guardado.current ?? EMPTY_WORKSPACE);
  const [newSessionOpen, setDialogOpen] = useState(false);
  const [newSessionInit, setNewSessionInit] = useState<NewSessionInit | null>(null);
  const [resumeTarget, setResumeTarget] = useState<RecentSession | null>(null);
  const narrow = useMediaQuery(CONTEXT_NARROW_QUERY);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const focusUntil = useRef(0);
  const [prefs, setPrefsState] = useState<UiPrefs>(() => loadUiPrefs());

  // «Distribución al abrir»: una vez cargados los ajustes, salvo «la última usada».
  const layoutAplicado = useRef(false);
  useEffect(() => {
    if (!ajustesListos || layoutAplicado.current) return;
    layoutAplicado.current = true;
    const inicial = settings.terminal.initialLayout;
    if (inicial !== 'last') dispatch({ type: 'layout', layout: inicial });
    else if (guardado.current === null) dispatch({ type: 'layout', layout: 2 });
  }, [ajustesListos, settings.terminal.initialLayout]);

  // Primera vez (sin pestañas recordadas): se abren las primeras sesiones vivas.
  const autoAbierto = useRef(false);
  useEffect(() => {
    if (!sesionesListas || !ajustesListos || autoAbierto.current) return;
    autoAbierto.current = true;
    if (guardado.current !== null) return;
    // Las que te esperan, primero; la primera abierta queda activa.
    const rango = (s: SessionInfo) => (visualState(s) === 'waiting' ? 0 : visualState(s) === 'working' ? 1 : 2);
    const candidatas = sessions
      .filter((s) => visualState(s) !== 'ended')
      .sort((a, b) => rango(a) - rango(b))
      .slice(0, 4);
    for (const s of candidatas) dispatch({ type: 'open', name: s.name });
    if (candidatas[0]) dispatch({ type: 'activate', name: candidatas[0].name });
  }, [sesionesListas, ajustesListos, sessions]);

  // Las sesiones terminadas desde fuera del panel desaparecen de las pestañas.
  useEffect(() => {
    if (!sesionesListas) return;
    dispatch({ type: 'prune', alive: new Set(sessions.map((s) => s.name)) });
  }, [sesionesListas, sessions]);

  useEffect(() => {
    if (autoAbierto.current) saveWorkspace(workspace);
  }, [workspace]);

  const openSession = useCallback<WorkspaceValue['openSession']>((name, opciones) => dispatch({ type: 'open', name, ...opciones }), []);
  const activate = useCallback((name: string) => dispatch({ type: 'activate', name }), []);
  const openFollow = useCallback<WorkspaceValue['openFollow']>((session, kind, id) => dispatch({ type: 'openFollow', key: followKey(session, kind, id) }), []);
  const setView = useCallback((name: string, view: PaneView) => dispatch({ type: 'view', name, view }), []);
  const closeTab = useCallback((name: string) => {
    if (isFollowKey(name)) forgetFollow(name);
    else {
      forgetConversation(name);
      forgetBtw(name);
    }
    dispatch({ type: 'close', name });
  }, []);
  const move = useCallback((delta: number) => dispatch({ type: 'move', delta }), []);
  const reorder = useCallback((name: string, to: number) => dispatch({ type: 'reorder', name, to }), []);
  const setLayout = useCallback((layout: Layout) => dispatch({ type: 'layout', layout }), []);
  const cycleLayout = useCallback(() => dispatch({ type: 'cycleLayout' }), []);
  const openDialog = useCallback((init?: NewSessionInit) => {
    setNewSessionInit(init ?? null);
    setDialogOpen(true);
  }, []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const openResume = useCallback((r: RecentSession) => setResumeTarget(r), []);
  const closeResume = useCallback(() => setResumeTarget(null), []);
  const dialogOpen = newSessionOpen || resumeTarget !== null;
  const setPrefs = useCallback((parche: Partial<UiPrefs>) => {
    setPrefsState((p) => {
      const siguiente = { ...p, ...parche };
      saveUiPrefs(siguiente);
      return siguiente;
    });
  }, []);

  const toggleContext = useCallback(() => {
    if (narrow) setOverlayOpen((o) => !o);
    else setPrefs({ contextOpen: !prefs.contextOpen });
  }, [narrow, prefs.contextOpen, setPrefs]);
  const closeContextOverlay = useCallback(() => setOverlayOpen(false), []);
  const requestTerminalFocus = useCallback(() => {
    focusUntil.current = Date.now() + FOCUS_REQUEST_MS;
    setFocusTick((t) => t + 1);
  }, []);
  const takeFocusRequest = useCallback(() => {
    const vigente = Date.now() < focusUntil.current;
    focusUntil.current = 0;
    return vigente;
  }, []);
  const contextVisible = narrow ? overlayOpen : prefs.contextOpen;

  const visible = useMemo(() => visibleTabs(workspace), [workspace]);
  const valor = useMemo<WorkspaceValue>(
    () => ({
      workspace,
      visible,
      openSession,
      openFollow,
      activate,
      setView,
      closeTab,
      move,
      reorder,
      setLayout,
      cycleLayout,
      dialogOpen,
      newSessionOpen,
      newSessionInit,
      openDialog,
      closeDialog,
      resumeTarget,
      openResume,
      closeResume,
      prefs,
      setPrefs,
      contextVisible,
      contextOverlay: narrow,
      toggleContext,
      closeContextOverlay,
      requestTerminalFocus,
      focusTick,
      takeFocusRequest,
    }),
    [
      workspace,
      visible,
      openSession,
      openFollow,
      activate,
      setView,
      closeTab,
      move,
      reorder,
      setLayout,
      cycleLayout,
      dialogOpen,
      newSessionOpen,
      newSessionInit,
      openDialog,
      closeDialog,
      resumeTarget,
      openResume,
      closeResume,
      prefs,
      setPrefs,
      contextVisible,
      narrow,
      toggleContext,
      closeContextOverlay,
      requestTerminalFocus,
      focusTick,
      takeFocusRequest,
    ],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace fuera de WorkspaceProvider');
  return v;
}

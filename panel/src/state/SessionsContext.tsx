import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, wsUrl } from '../api.ts';
import { sessionNamesKey } from '../lib/recent.ts';
import { effectiveProject } from '../lib/sessions.ts';
import type { CommitPhase, ProjectInfo, RecentSession, SessionInfo } from '../types.ts';
import { useSettings } from './SettingsContext.tsx';

type SessionsValue = {
  sessions: SessionInfo[];
  /** Proyectos con los overrides de Ajustes ya aplicados. */
  projects: ProjectInfo[];
  /** Socket de tmux del servidor (null hasta cargar la lista). */
  tmuxSocket: string | null;
  /** HOME del usuario del servidor (null hasta cargar la lista): expande las rutas «~/…». */
  home: string | null;
  loaded: boolean;
  connected: boolean;
  error: string | null;
  /** Añade o sustituye una sesión recién creada sin esperar al evento. */
  upsert: (s: SessionInfo) => void;
  reloadProjects: () => void;
  /** Sesiones recientes de Claude que se pueden retomar (sin las que ya están en el panel). */
  recent: RecentSession[];
  reloadRecent: () => void;
  /** Suscribe a los avisos `{type:'backlog', project}` de /ws/events; devuelve la baja. */
  onBacklogChange: (cb: (project: string) => void) => () => void;
  /** Suscribe a los avisos `{type:'history', project}` de /ws/events; devuelve la baja. */
  onHistoryChange: (cb: (project: string) => void) => () => void;
  /** Suscribe a las fases `{type:'backlog-commit', project, phase}` del commit del backlog; devuelve la baja. */
  onBacklogCommitPhase: (cb: (project: string, phase: CommitPhase) => void) => () => void;
};

const Ctx = createContext<SessionsValue | null>(null);

const BACKOFF_MIN = 500;
const BACKOFF_MAX = 10_000;
const RECENT_POLL_MS = 30_000;
const RECENT_DEBOUNCE_MS = 600;

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [rawProjects, setRawProjects] = useState<ProjectInfo[]>([]);
  const [tmuxSocket, setTmuxSocket] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const recentSeq = useRef(0);
  const backlogListeners = useRef(new Set<(project: string) => void>());
  const onBacklogChange = useCallback((cb: (project: string) => void) => {
    backlogListeners.current.add(cb);
    return () => {
      backlogListeners.current.delete(cb);
    };
  }, []);

  const historyListeners = useRef(new Set<(project: string) => void>());
  const onHistoryChange = useCallback((cb: (project: string) => void) => {
    historyListeners.current.add(cb);
    return () => {
      historyListeners.current.delete(cb);
    };
  }, []);

  const commitListeners = useRef(new Set<(project: string, phase: CommitPhase) => void>());
  const onBacklogCommitPhase = useCallback((cb: (project: string, phase: CommitPhase) => void) => {
    commitListeners.current.add(cb);
    return () => {
      commitListeners.current.delete(cb);
    };
  }, []);

  // Una respuesta lenta no debe pisar a otra más reciente.
  const reloadRecent = useCallback(() => {
    const n = ++recentSeq.current;
    api
      .recent()
      .then((r) => {
        if (n === recentSeq.current) setRecent(r);
      })
      .catch(() => {
        // Es una ayuda secundaria: si falla se conserva la última lista.
      });
  }, []);

  const reloadProjects = useCallback(() => {
    api
      .projects()
      .then((p) => setRawProjects(p))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Carga inicial por REST: la lista aparece aunque el canal de eventos tarde.
  useEffect(() => {
    let cancelado = false;
    reloadProjects();
    api
      .sessions()
      .then(({ sessions: s, tmuxSocket: socket, home: casa }) => {
        if (cancelado) return;
        if (socket) setTmuxSocket(socket);
        if (casa) setHome(casa);
        setSessions((previas) => (previas.length > 0 ? previas : s));
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      });
    return () => {
      cancelado = true;
    };
  }, [reloadProjects]);

  // Canal de eventos con reconexión exponencial.
  const intento = useRef(0);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reintento: number | null = null;
    let cerrado = false;

    const conectar = () => {
      ws = new WebSocket(wsUrl('/ws/events'));
      ws.onopen = () => {
        intento.current = 0;
        setConnected(true);
        setError(null);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; sessions?: SessionInfo[]; project?: unknown; phase?: unknown };
          if (msg.type === 'sessions' && Array.isArray(msg.sessions)) {
            setSessions(msg.sessions);
            setLoaded(true);
          } else if (msg.type === 'backlog' && typeof msg.project === 'string') {
            const proyecto = msg.project;
            for (const cb of backlogListeners.current) cb(proyecto);
          } else if (msg.type === 'history' && typeof msg.project === 'string') {
            const proyecto = msg.project;
            for (const cb of historyListeners.current) cb(proyecto);
          } else if (
            msg.type === 'backlog-commit' &&
            typeof msg.project === 'string' &&
            (msg.phase === 'commit' || msg.phase === 'push' || msg.phase === 'done' || msg.phase === 'error')
          ) {
            const proyecto = msg.project;
            const fase = msg.phase;
            for (const cb of commitListeners.current) cb(proyecto, fase);
          }
        } catch {
          // Mensaje ilegible: se ignora.
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (cerrado) return;
        const espera = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** intento.current++);
        reintento = window.setTimeout(conectar, espera);
      };
      ws.onerror = () => ws?.close();
    };
    conectar();
    return () => {
      cerrado = true;
      if (reintento !== null) window.clearTimeout(reintento);
      ws?.close();
    };
  }, []);

  // Al recuperar la conexión se refrescan también los proyectos (pueden haber cambiado).
  useEffect(() => {
    if (connected) reloadProjects();
  }, [connected, reloadProjects]);

  // Recientes: al cargar, al cambiar qué sesiones hay en el panel (con debounce),
  // cada 30 s y al volver a la ventana.
  const clave = sessionNamesKey(sessions);
  useEffect(() => {
    const t = window.setTimeout(reloadRecent, RECENT_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [clave, reloadRecent]);
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') reloadRecent();
    };
    const periodico = window.setInterval(alVolver, RECENT_POLL_MS);
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearInterval(periodico);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [reloadRecent]);

  const projects = useMemo(
    () => rawProjects.map((p) => effectiveProject(p, settings.projects[p.id])),
    [rawProjects, settings.projects],
  );

  const upsert = useCallback((s: SessionInfo) => {
    setSessions((previas) => (previas.some((p) => p.name === s.name) ? previas.map((p) => (p.name === s.name ? s : p)) : [...previas, s]));
  }, []);

  const valor = useMemo<SessionsValue>(
    () => ({ sessions, projects, tmuxSocket, home, loaded, connected, error, upsert, reloadProjects, recent, reloadRecent, onBacklogChange, onHistoryChange, onBacklogCommitPhase }),
    [sessions, projects, tmuxSocket, home, loaded, connected, error, upsert, reloadProjects, recent, reloadRecent, onBacklogChange, onHistoryChange, onBacklogCommitPhase],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessions(): SessionsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessions fuera de SessionsProvider');
  return v;
}

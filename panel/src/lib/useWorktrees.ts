import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import type { WorktreeList } from '../types.ts';

const POLL_MS = 30_000;

type Estado = { project: string; data: WorktreeList | null; error: string | null };

/**
 * Worktrees del proyecto mostrado. Se recargan al cambiar de proyecto, cuando
 * cambia qué sesiones hay en el panel (cada una cuelga de su worktree), al volver
 * a la ventana y cada 30 s (para ver los cambios sin commit y los commits nuevos).
 */
export function useWorktrees(projectId: string | null): { data: WorktreeList | null; error: string | null; reload: () => void } {
  const { sessions } = useSessions();
  const [estado, setEstado] = useState<Estado | null>(null);

  const cargar = useCallback((id: string) => {
    api
      .worktrees(id)
      .then((data) => setEstado((w) => (w && w.project !== id ? w : { project: id, data, error: null })))
      .catch((e: unknown) =>
        setEstado((w) => (w && w.project !== id ? w : { project: id, data: w?.data ?? null, error: e instanceof Error ? e.message : String(e) })),
      );
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setEstado({ project: projectId, data: null, error: null });
    cargar(projectId);
  }, [projectId, cargar]);

  const nombresSesiones = sessions.map((s) => `${s.name}:${s.worktree}`).join('|');
  useEffect(() => {
    if (projectId) cargar(projectId);
  }, [nombresSesiones, projectId, cargar]);

  useEffect(() => {
    if (!projectId) return;
    const refrescar = () => {
      if (document.visibilityState === 'visible') cargar(projectId);
    };
    const t = window.setInterval(refrescar, POLL_MS);
    window.addEventListener('focus', refrescar);
    document.addEventListener('visibilitychange', refrescar);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', refrescar);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [projectId, cargar]);

  const reload = useCallback(() => {
    if (projectId) cargar(projectId);
  }, [projectId, cargar]);
  const vigente = estado !== null && estado.project === projectId;
  return { data: vigente ? estado.data : null, error: vigente ? estado.error : null, reload };
}

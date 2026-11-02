import { useEffect, useMemo } from 'react';
import { loadLastProject, pickProject, saveLastProject } from './backlog.ts';
import { canonicalProjectHref } from './route.ts';
import type { ProjectScreen } from './route.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import type { ProjectInfo } from '../types.ts';

/**
 * Lo común a las tres pantallas de proyecto (Backlog, Worktrees y Guías): el
 * proyecto mostrado (el pedido en la ruta, si no el último usado —compartido
 * entre las tres— o el primero visible), el recuerdo del último y la
 * corrección de la URL al proyecto mostrado.
 */
export function useProjectScreen(
  pantalla: ProjectScreen,
  pedido: { project: string | null; item: string | null },
  onReplaceHash: (hash: string) => void,
  /** Falso cuando el elemento o la guía de la ruta no existen: se quitan de la URL. */
  withItem = true,
): { projects: ProjectInfo[]; visibles: ProjectInfo[]; ids: string[]; actual: ProjectInfo | null; loaded: boolean } {
  const { projects, loaded } = useSessions();
  const visibles = useMemo(() => projects.filter((p) => p.visible), [projects]);
  const ids = useMemo(() => visibles.map((p) => p.id), [visibles]);
  const actualId = pickProject(ids, pedido.project, loadLastProject());
  const actual = visibles.find((p) => p.id === actualId) ?? null;

  useEffect(() => {
    if (actualId) saveLastProject(actualId);
  }, [actualId]);

  const { project, item } = pedido;
  useEffect(() => {
    if (!actualId) return;
    const destino = canonicalProjectHref(pantalla, { project, item }, actualId, withItem);
    if (destino) onReplaceHash(destino);
  }, [pantalla, actualId, project, item, withItem, onReplaceHash]);

  return { projects, visibles, ids, actual, loaded };
}

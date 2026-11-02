import { useEffect, useMemo, useRef } from 'react';
import { loadLastProject, pickProject, pickWorktreesProject, rememberDecision, saveLastProject } from './backlog.ts';
import { canonicalProjectHref } from './route.ts';
import type { ProjectScreen } from './route.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import type { ProjectInfo } from '../types.ts';

/**
 * Lo común a las tres pantallas de proyecto (Backlog, Worktrees y Guías): el
 * proyecto mostrado, el recuerdo del último y la corrección de la URL al proyecto
 * mostrado. Solo se recuerda el proyecto que la persona elige. Sin proyecto en la ruta, Backlog y Guías muestran el último usado
 * —compartido entre las tres— o el primero visible; Worktrees, el primero visible
 * con worktrees abiertos o, si ninguno tiene, el primero. Los worktrees salen de
 * la lista de proyectos, que ya está cargada: no hace falta corregir luego.
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
  const actualId =
    pantalla === 'worktrees'
      ? pickWorktreesProject(ids, pedido.project, new Set(visibles.filter((p) => p.worktrees.length > 0).map((p) => p.id)))
      : pickProject(ids, pedido.project, loadLastProject());
  const actual = visibles.find((p) => p.id === actualId) ?? null;

  // El último proyecto usado es el que la persona elige; el que Worktrees escoge solo no se recuerda.
  const automatico = useRef<string | null>(null);
  const { project, item } = pedido;
  useEffect(() => {
    if (!actualId) return;
    const d = rememberDecision(pantalla, project, actualId, automatico.current);
    automatico.current = d.automatico;
    if (d.remember) saveLastProject(actualId);
  }, [pantalla, actualId, project]);

  useEffect(() => {
    if (!actualId) return;
    const destino = canonicalProjectHref(pantalla, { project, item }, actualId, withItem);
    if (destino) onReplaceHash(destino);
  }, [pantalla, actualId, project, item, withItem, onReplaceHash]);

  return { projects, visibles, ids, actual, loaded };
}

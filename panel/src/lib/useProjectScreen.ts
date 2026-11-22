import { useEffect, useMemo, useRef } from 'react';
import { loadLastCambios, loadLastProject, pickCambiosProject, pickProject, rememberDecision, saveLastCambios, saveLastProject } from './backlog.ts';
import { USER_PROJECT, canonicalProjectHref, isUserSkills } from './route.ts';
import type { ProjectScreen } from './route.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import type { ProjectInfo } from '../types.ts';

/**
 * Lo común a las pantallas de proyecto (Backlog, Cambios, Guías y Skills): el
 * proyecto mostrado, el recuerdo del último y la corrección de la URL al proyecto
 * mostrado. Solo se recuerda el proyecto que la persona elige. Sin proyecto en la
 * ruta, Backlog y Guías muestran el último usado —compartido entre ellas— o el
 * primero visible; Cambios, el primero visible con cambios (`conCambios`, del
 * resumen del servidor), si ninguno tiene, el último usado en Cambios o, si no, el
 * primero. Mientras `conCambios` es null y la ruta no trae proyecto, Cambios no
 * escoge ninguno (`actual` es null y `loaded` falso): así no cambia de proyecto al llegar el resumen.
 * Solo en Skills, la ruta puede pedir la entrada «Usuario» (`USER_PROJECT`): no es un
 * proyecto, así que `actual` es null y `usuario` verdadero, y no se recuerda como
 * último proyecto (los demás proyectos lo comparten).
 */
export function useProjectScreen(
  pantalla: ProjectScreen,
  pedido: { project: string | null; item: string | null },
  onReplaceHash: (hash: string) => void,
  /** Falso cuando el elemento o la guía de la ruta no existen: se quitan de la URL. */
  withItem = true,
  /** Solo Cambios: ids de los proyectos con cambios; null mientras el resumen no ha llegado. */
  conCambios: ReadonlySet<string> | null = null,
): { projects: ProjectInfo[]; visibles: ProjectInfo[]; ids: string[]; actual: ProjectInfo | null; usuario: boolean; loaded: boolean } {
  const { projects, loaded } = useSessions();
  const visibles = useMemo(() => projects.filter((p) => p.visible), [projects]);
  const ids = useMemo(() => visibles.map((p) => p.id), [visibles]);
  const usuario = isUserSkills(pantalla, pedido.project);
  const actualId = usuario
    ? USER_PROJECT
    : pantalla === 'cambios'
      ? pickCambiosProject(ids, pedido.project, conCambios, loadLastCambios())
      : pickProject(ids, pedido.project, loadLastProject());
  const esperando = pantalla === 'cambios' && actualId === null && ids.length > 0;
  const actual = usuario ? null : (visibles.find((p) => p.id === actualId) ?? null);

  // El último proyecto usado es el que la persona elige; el que Cambios escoge solo no se recuerda.
  const automatico = useRef<string | null>(null);
  const { project, item } = pedido;
  useEffect(() => {
    if (!actualId || actualId === USER_PROJECT) return;
    const d = rememberDecision(pantalla, project, actualId, automatico.current);
    automatico.current = d.automatico;
    if (d.remember) {
      saveLastProject(actualId);
      if (pantalla === 'cambios') saveLastCambios(actualId);
    }
  }, [pantalla, actualId, project]);

  useEffect(() => {
    if (!actualId) return;
    const destino = canonicalProjectHref(pantalla, { project, item }, actualId, withItem);
    if (destino) onReplaceHash(destino);
  }, [pantalla, actualId, project, item, withItem, onReplaceHash]);

  return { projects, visibles, ids, actual, usuario, loaded: loaded && !esperando };
}

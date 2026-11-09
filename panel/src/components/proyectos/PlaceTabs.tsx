import type { KeyboardEvent } from 'react';
import { cambiosItem, projectHref } from '../../lib/route.ts';
import type { PlaceRef } from '../../lib/route.ts';
import { visualState } from '../../lib/sessions.ts';
import type { ChangesOverview, ProjectInfo, SessionInfo } from '../../types.ts';
import { IconBranch, IconHome } from '../Icons.tsx';
import { fmt } from './FileTree.tsx';

/** Id de la pestaña de un lugar (el panel de cambios se describe con ella). */
export const placeTabId = (l: PlaceRef): string => (l.kind === 'main' ? 'place-tab-main' : `place-tab-wt-${encodeURIComponent(l.name)}`);

const mismo = (a: PlaceRef, b: PlaceRef) => (a.kind === 'main' ? b.kind === 'main' : b.kind === 'wt' && b.name === a.name);

/**
 * Pestañas de lugar de Cambios: el checkout principal (`main`) y un worktree por
 * pestaña, cada una con su número de archivos cambiados y un punto si una sesión del
 * panel está trabajando ahí. Son enlaces (la dirección guarda el lugar) con la
 * semántica y el teclado de unas pestañas: flechas, Inicio y Fin. Se desplazan en horizontal si no caben.
 */
export function PlaceTabs(props: {
  project: ProjectInfo;
  overview: ChangesOverview | null;
  place: PlaceRef;
  sessions: readonly SessionInfo[];
}) {
  const { project, overview } = props;
  // Hasta que llegue la lista de lugares, las pestañas salen de los worktrees de la lista de proyectos (sin recuento).
  const lugares: { place: PlaceRef; label: string; changes: number | null; sessions: string[] }[] = [
    { place: { kind: 'main' }, label: 'main', changes: overview?.main.changes ?? null, sessions: overview?.main.sessions ?? [] },
    ...(overview?.worktrees ?? project.worktrees.map((w) => ({ name: w.name, changes: null, sessions: [] as string[] }))).map((w) => ({
      place: { kind: 'wt', name: w.name } as PlaceRef,
      label: w.name,
      changes: w.changes,
      sessions: w.sessions,
    })),
  ];
  const trabajando = (nombres: string[]) => nombres.some((n) => props.sessions.some((s) => s.name === n && visualState(s) === 'working'));

  const teclado = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = lugares.findIndex((l) => mismo(l.place, props.place));
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % lugares.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + lugares.length) % lugares.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = lugares.length - 1;
    if (j < 0 || j === i) return;
    e.preventDefault();
    // Activación automática: elegir la pestaña es navegar, y el foco la sigue.
    window.location.hash = projectHref('cambios', project.id, cambiosItem(lugares[j]!.place));
    requestAnimationFrame(() => document.getElementById(placeTabId(lugares[j]!.place))?.focus());
  };

  return (
    <div className="ptabs" role="tablist" aria-label="Dónde mirar los cambios" onKeyDown={teclado}>
      {lugares.map((l) => {
        const activa = mismo(l.place, props.place);
        const work = trabajando(l.sessions);
        return (
          <a
            key={placeTabId(l.place)}
            id={placeTabId(l.place)}
            role="tab"
            className={`ptabs__tab${l.place.kind === 'wt' ? ' ptabs__tab--wt' : ''}`}
            href={projectHref('cambios', project.id, cambiosItem(l.place))}
            aria-selected={activa}
            tabIndex={activa ? 0 : -1}
          >
            {l.place.kind === 'main' ? <IconHome size={14} /> : <IconBranch size={14} />}
            <span>{l.label}</span>
            <span className="ptabs__count" data-zero={l.changes === 0}>
              {l.changes === null ? '–' : fmt(l.changes)}
              <span className="sr-only">{l.changes === null ? ' cambios sin calcular' : l.changes === 1 ? ' archivo cambiado' : ' archivos cambiados'}</span>
            </span>
            {work && <span className="ptabs__work" title="Una sesión trabajando" role="img" aria-label="Una sesión trabajando" />}
          </a>
        );
      })}
      {project.harness && <span className="ptabs__note">El harness no usa worktrees.</span>}
    </div>
  );
}

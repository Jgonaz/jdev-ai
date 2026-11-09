import { useCallback, useEffect, useMemo } from 'react';
import { PlaceChanges } from '../components/proyectos/PlaceChanges.tsx';
import { PlaceTabs, placeTabId } from '../components/proyectos/PlaceTabs.tsx';
import { ProjectHeader, ProjectSidebar, ProjectsEmpty, useSidebarWidth } from '../components/proyectos/ProjectSidebar.tsx';
import { cambiosItem, parseCambiosItem, projectHref } from '../lib/route.ts';
import { useChangesOverview } from '../lib/useChangesOverview.ts';
import { fmt } from '../components/proyectos/FileTree.tsx';
import { useChangesSummary } from '../lib/useChangesSummary.ts';
import { useProjectScreen } from '../lib/useProjectScreen.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { ChangesOverview } from '../types.ts';

/** Archivos cambiados del proyecto entre su checkout principal y sus worktrees; null si alguno no se pudo calcular. */
const totalDe = (o: ChangesOverview): number | null => {
  const cuentas = [o.main.changes, ...o.worktrees.map((w) => w.changes)];
  return cuentas.some((c) => c === null) ? null : cuentas.reduce<number>((a, c) => a + (c ?? 0), 0);
};

/**
 * Pantalla Cambios: lo que cambia en el checkout principal del proyecto (también en
 * el harness) y en cada uno de sus worktrees, con pestañas por lugar, un árbol de
 * archivos y el diff del elegido. El lugar y el archivo van en la ruta
 * (`#/cambios/<id>[/main[/<archivo>]|/wt/<worktree>[/<archivo>]]`).
 */
export function CambiosScreen(props: {
  project: string | null;
  /** `main[/<archivo>]` o `wt/<worktree>[/<archivo>]`, de la ruta. */
  item: string | null;
  onGoToTerminal: () => void;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const { sessions, reloadProjects } = useSessions();
  const { openDialog, openSession, activate } = useWorkspace();
  const resumen = useChangesSummary();
  // Proyecto por defecto: el primero con cambios. Si el resumen falla, se cuenta como que ninguno tiene.
  const conCambios = useMemo(
    () => (resumen.data ? new Set(Object.entries(resumen.data).filter(([, n]) => n !== null && n > 0).map(([id]) => id)) : resumen.failed ? new Set<string>() : null),
    [resumen.data, resumen.failed],
  );
  const { projects, visibles, actual, loaded } = useProjectScreen('cambios', { project: props.project, item: props.item }, props.onReplaceHash, true, conCambios);
  const sidebar = useSidebarWidth();
  const actualId = actual?.id ?? null;
  const lugares = useChangesOverview(actualId);
  const { onReplaceHash } = props;

  const pedido = parseCambiosItem(props.item) ?? { place: { kind: 'main' as const }, file: null };
  const place = pedido.place;
  const nombreWt = place.kind === 'wt' ? place.name : null;

  // Con la lista de lugares cargada, un worktree que no existe se quita de la URL, sin añadir una entrada al historial.
  const lista = lugares.data;
  useEffect(() => {
    if (actualId && props.project === actualId && nombreWt !== null && lista && !lista.worktrees.some((w) => w.name === nombreWt)) {
      onReplaceHash(projectHref('cambios', actualId));
    }
  }, [actualId, props.project, nombreWt, lista, onReplaceHash]);

  const quitarArchivo = useCallback(() => {
    if (actualId) onReplaceHash(projectHref('cambios', actualId, cambiosItem(place, null)));
  }, [actualId, place, onReplaceHash]);

  // Recuento de la barra: el del resumen y, para el proyecto mostrado, el de sus lugares, que se refrescan al actualizar.
  const recuentos = useMemo(() => {
    const m: Record<string, number | null | undefined> = { ...resumen.data };
    if (actualId && lugares.data) m[actualId] = totalDe(lugares.data) ?? m[actualId] ?? null;
    return Object.fromEntries(visibles.map((p) => [p.id, m[p.id] ?? null]));
  }, [resumen.data, lugares.data, actualId, visibles]);

  if (!actual) return <ProjectsEmpty loaded={loaded} any={projects.length > 0} />;

  const irASesion = (name: string) => {
    openSession(name);
    activate(name);
    props.onGoToTerminal();
  };
  const nuevaAqui = () => {
    reloadProjects();
    openDialog(place.kind === 'main' ? { project: actual.id, location: 'main' } : { project: actual.id, location: 'existing-worktree', worktree: place.name });
  };
  const info = place.kind === 'main' ? (lugares.data?.main ?? null) : (lugares.data?.worktrees.find((w) => w.name === place.name) ?? null);
  const carpeta = actual.harness
    ? 'el harness · checkout principal'
    : place.kind === 'main'
      ? `projects/${actual.id}/`
      : `projects/${actual.id}.worktrees/${place.name}/`;

  return (
    <div className="screen screen--proyectos">
      <ProjectSidebar
        screen="cambios"
        projects={visibles}
        currentId={actual.id}
        sidebar={sidebar}
        counts={recuentos}
        countLabel={(n) => (n === 0 ? 'sin cambios' : `${fmt(n)} ${n === 1 ? 'archivo cambiado' : 'archivos cambiados'}`)}
        countText={(n) => (n === 0 ? 'sin cambios' : `${fmt(n)} ${n === 1 ? 'cambio' : 'cambios'}`)}
      />
      <main className="pmain">
        <ProjectHeader project={actual} path={carpeta} />
        <div className="ppanel">
          <PlaceTabs project={actual} overview={lugares.data} place={place} sessions={sessions} />
          <PlaceChanges
            key={`${actual.id}/${place.kind === 'wt' ? `wt/${place.name}` : 'main'}`}
            project={actual}
            place={place}
            info={info}
            base={lugares.data?.base ?? null}
            file={pedido.file}
            sessions={sessions}
            tabId={placeTabId(place)}
            onSelectFile={(path) => {
              window.location.hash = projectHref('cambios', actual.id, cambiosItem(place, path));
            }}
            onDropFile={quitarArchivo}
            onOpenSession={irASesion}
            onNewSession={nuevaAqui}
            onRefresh={() => {
              lugares.reload();
              resumen.reload();
            }}
          />
        </div>
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { GuidesView } from '../components/proyectos/Guides.tsx';
import { ProjectHeader, ProjectSidebar, ProjectsEmpty, useSidebarWidth } from '../components/proyectos/ProjectSidebar.tsx';
import { projectHref } from '../lib/route.ts';
import { useProjectScreen } from '../lib/useProjectScreen.ts';
import type { Guide } from '../types.ts';

type Lista = { data: Guide[] | null; error: string | null };

/** Pantalla Guías: los documentos de `docs/user-guides/` del proyecto y un lector; la guía abierta va en la ruta. */
export function GuiasScreen(props: {
  project: string | null;
  /** Ruta de la guía abierta, de `#/guias/<id>/<ruta>`. */
  item: string | null;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const [listas, setListas] = useState<Record<string, Lista>>({});
  const { onReplaceHash } = props;

  const { projects, visibles, ids, actual, loaded } = useProjectScreen('guias', { project: props.project, item: props.item }, onReplaceHash);
  const sidebar = useSidebarWidth();
  const actualId = actual?.id ?? null;

  // Una lista por proyecto visible: da los recuentos de la barra y la lista del proyecto mostrado.
  const clave = ids.join('\n');
  useEffect(() => {
    const control = new AbortController();
    for (const id of clave.split('\n')) {
      if (!id) continue;
      api
        .guides(id, control.signal)
        .then((data) => setListas((l) => ({ ...l, [id]: { data, error: null } })))
        .catch((e: unknown) => {
          if (!control.signal.aborted) setListas((l) => ({ ...l, [id]: { data: null, error: e instanceof Error ? e.message : String(e) } }));
        });
    }
    return () => control.abort();
  }, [clave]);

  const lista = actualId ? listas[actualId] : undefined;
  const existe = props.item !== null && (lista?.data?.some((g) => g.path === props.item) ?? false);
  // Con la lista cargada, una guía que no existe se quita de la URL.
  useEffect(() => {
    if (actualId && props.item !== null && props.project === actualId && lista?.data && !existe) onReplaceHash(projectHref('guias', actualId));
  }, [actualId, props.item, props.project, lista, existe, onReplaceHash]);
  const elegida = existe ? props.item : null;

  const recuentos = useMemo(() => Object.fromEntries(visibles.map((p) => [p.id, listas[p.id]?.data?.length ?? null])), [visibles, listas]);
  const elegir = useCallback(
    (path: string) => {
      if (actualId) window.location.hash = projectHref('guias', actualId, path);
    },
    [actualId],
  );

  if (!actual) return <ProjectsEmpty loaded={loaded} any={projects.length > 0} />;

  return (
    <div className="screen screen--proyectos">
      <ProjectSidebar
        screen="guias"
        projects={visibles}
        currentId={actual.id}
        sidebar={sidebar}
        counts={recuentos}
        countLabel={(n) => `${n} ${n === 1 ? 'guía' : 'guías'}`}
      />
      <main className="pmain">
        <ProjectHeader project={actual} path="docs/user-guides/" />
        <div className="ppanel">
          <GuidesView project={actual} guias={lista?.data ?? null} error={lista?.error ?? null} elegida={elegida} onSelect={elegir} />
        </div>
      </main>
    </div>
  );
}

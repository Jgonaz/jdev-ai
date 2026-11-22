import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { ProjectHeader, ProjectSidebar, ProjectsEmpty, useSidebarWidth } from '../components/proyectos/ProjectSidebar.tsx';
import type { SidebarExtra } from '../components/proyectos/ProjectSidebar.tsx';
import { McpsView } from '../components/proyectos/Mcps.tsx';
import { USER_PROJECT, projectHref } from '../lib/route.ts';
import { mcpCountLabel } from '../lib/mcps.ts';
import { useProjectScreen } from '../lib/useProjectScreen.ts';
import type { McpSummary } from '../types.ts';

type Lista = { data: McpSummary[] | null; error: string | null };

// La entrada «Usuario» no es un proyecto: se pinta como uno, con un monograma neutro.
const USUARIO: SidebarExtra = { id: USER_PROJECT, name: 'Usuario', mono: '~', color: 'var(--fg-muted)' };

/**
 * Pantalla MCPs: los servidores MCP de cada proyecto (archivos de configuración de la
 * raíz de su checkout principal, los privados de `~/.claude.json` y, en el harness, los
 * de sus subagentes) y, en la entrada «Usuario» de la barra, los de usuario, con su
 * detalle. El MCP abierto va en la ruta: `#/mcps/<id>/<nombre>`.
 */
export function McpsScreen(props: {
  project: string | null;
  /** Nombre del MCP abierto, de `#/mcps/<id>/<nombre>`. */
  item: string | null;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const [listas, setListas] = useState<Record<string, Lista>>({});
  const { onReplaceHash } = props;

  const { projects, visibles, ids, actual, usuario, loaded } = useProjectScreen('mcps', { project: props.project, item: props.item }, onReplaceHash);
  const sidebar = useSidebarWidth();
  const actualId = usuario ? USER_PROJECT : (actual?.id ?? null);

  // Una lista por proyecto visible y la de usuario: dan los recuentos de la barra y la lista mostrada.
  const clave = [...ids, USER_PROJECT].join('\n');
  useEffect(() => {
    const control = new AbortController();
    for (const id of clave.split('\n')) {
      api
        .mcps(id, control.signal)
        .then((data) => setListas((l) => ({ ...l, [id]: { data, error: null } })))
        .catch((e: unknown) => {
          if (!control.signal.aborted) setListas((l) => ({ ...l, [id]: { data: null, error: e instanceof Error ? e.message : String(e) } }));
        });
    }
    return () => control.abort();
  }, [clave]);

  const lista = actualId ? listas[actualId] : undefined;
  const existe = props.item !== null && (lista?.data?.some((m) => m.name === props.item) ?? false);
  // Con la lista cargada, un MCP que no existe se quita de la URL.
  useEffect(() => {
    if (actualId && props.item !== null && props.project === actualId && lista?.data && !existe) onReplaceHash(projectHref('mcps', actualId));
  }, [actualId, props.item, props.project, lista, existe, onReplaceHash]);
  const elegido = existe ? props.item : null;

  const recuentos = useMemo(
    () => Object.fromEntries([...visibles.map((p) => p.id), USER_PROJECT].map((id) => [id, listas[id]?.data?.length ?? null])),
    [visibles, listas],
  );
  const elegir = useCallback(
    (nombre: string) => {
      if (actualId) window.location.hash = projectHref('mcps', actualId, nombre);
    },
    [actualId],
  );

  if (!actual && !usuario) return <ProjectsEmpty loaded={loaded} any={projects.length > 0} />;

  return (
    <div className="screen screen--proyectos">
      <ProjectSidebar screen="mcps" projects={visibles} currentId={actualId ?? ''} extra={USUARIO} sidebar={sidebar} counts={recuentos} countLabel={mcpCountLabel} />
      <main className="pmain">
        <ProjectHeader project={actual ?? USUARIO} path={usuario ? '~/.claude.json y otros' : '.mcp.json y otros'} />
        <div className="ppanel">
          <McpsView
            key={actualId ?? ''}
            projectId={actualId ?? ''}
            mcps={lista?.data ?? null}
            error={lista?.error ?? null}
            empty={usuario ? 'No hay MCPs de usuario.' : 'Este proyecto no tiene MCPs.'}
            elegido={elegido}
            onSelect={elegir}
          />
        </div>
      </main>
    </div>
  );
}

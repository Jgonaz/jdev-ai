import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { ProjectHeader, ProjectSidebar, ProjectsEmpty, useSidebarWidth } from '../components/proyectos/ProjectSidebar.tsx';
import type { SidebarExtra } from '../components/proyectos/ProjectSidebar.tsx';
import { SkillsView } from '../components/proyectos/Skills.tsx';
import { USER_PROJECT, projectHref } from '../lib/route.ts';
import { skillCountLabel } from '../lib/skills.ts';
import { useProjectScreen } from '../lib/useProjectScreen.ts';
import type { SkillSummary } from '../types.ts';

type Lista = { data: SkillSummary[] | null; error: string | null };

// La entrada «Usuario» no es un proyecto: se pinta como uno, con un monograma neutro.
const USUARIO: SidebarExtra = { id: USER_PROJECT, name: 'Usuario', mono: '~', color: 'var(--fg-muted)' };

/**
 * Pantalla Skills: las skills de cada proyecto (carpetas de agente de la raíz de su
 * checkout principal) y, en la entrada «Usuario» de la barra, las de usuario, con un
 * lector. La skill abierta va en la ruta: `#/skills/<id>/<nombre>`.
 */
export function SkillsScreen(props: {
  project: string | null;
  /** Nombre de la skill abierta, de `#/skills/<id>/<nombre>`. */
  item: string | null;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const [listas, setListas] = useState<Record<string, Lista>>({});
  const { onReplaceHash } = props;

  const { projects, visibles, ids, actual, usuario, loaded } = useProjectScreen('skills', { project: props.project, item: props.item }, onReplaceHash);
  const sidebar = useSidebarWidth();
  const actualId = usuario ? USER_PROJECT : (actual?.id ?? null);

  // Una lista por proyecto visible y la de usuario: dan los recuentos de la barra y la lista mostrada.
  const clave = [...ids, USER_PROJECT].join('\n');
  useEffect(() => {
    const control = new AbortController();
    for (const id of clave.split('\n')) {
      api
        .skills(id, control.signal)
        .then((data) => setListas((l) => ({ ...l, [id]: { data, error: null } })))
        .catch((e: unknown) => {
          if (!control.signal.aborted) setListas((l) => ({ ...l, [id]: { data: null, error: e instanceof Error ? e.message : String(e) } }));
        });
    }
    return () => control.abort();
  }, [clave]);

  const lista = actualId ? listas[actualId] : undefined;
  const existe = props.item !== null && (lista?.data?.some((s) => s.name === props.item) ?? false);
  // Con la lista cargada, una skill que no existe se quita de la URL.
  useEffect(() => {
    if (actualId && props.item !== null && props.project === actualId && lista?.data && !existe) onReplaceHash(projectHref('skills', actualId));
  }, [actualId, props.item, props.project, lista, existe, onReplaceHash]);
  const elegida = existe ? props.item : null;

  const recuentos = useMemo(
    () => Object.fromEntries([...visibles.map((p) => p.id), USER_PROJECT].map((id) => [id, listas[id]?.data?.length ?? null])),
    [visibles, listas],
  );
  const elegir = useCallback(
    (nombre: string) => {
      if (actualId) window.location.hash = projectHref('skills', actualId, nombre);
    },
    [actualId],
  );

  if (!actual && !usuario) return <ProjectsEmpty loaded={loaded} any={projects.length > 0} />;

  return (
    <div className="screen screen--proyectos">
      <ProjectSidebar screen="skills" projects={visibles} currentId={actualId ?? ''} extra={USUARIO} sidebar={sidebar} counts={recuentos} countLabel={skillCountLabel} />
      <main className="pmain">
        <ProjectHeader project={actual ?? USUARIO} path={usuario ? '~/.claude/skills/ y otras' : '.claude/skills/ y otras'} />
        <div className="ppanel">
          <SkillsView
            key={actualId ?? ''}
            projectId={actualId ?? ''}
            skills={lista?.data ?? null}
            error={lista?.error ?? null}
            empty={usuario ? 'No hay skills de usuario.' : 'Este proyecto no tiene skills.'}
            elegida={elegida}
            onSelect={elegir}
          />
        </div>
      </main>
    </div>
  );
}

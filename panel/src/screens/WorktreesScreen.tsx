import { useMemo } from 'react';
import { ProjectHeader, ProjectSidebar, ProjectsEmpty, useSidebarWidth } from '../components/proyectos/ProjectSidebar.tsx';
import { WorktreesList } from '../components/proyectos/Worktrees.tsx';
import { useProjectScreen } from '../lib/useProjectScreen.ts';
import { useWorktrees } from '../lib/useWorktrees.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';

/** Pantalla Worktrees: las ramas abiertas del proyecto en `projects/<proyecto>.worktrees/`, con sus sesiones. */
export function WorktreesScreen(props: {
  project: string | null;
  item: string | null;
  onGoToTerminal: () => void;
  /** Corrige el hash sin añadir una entrada al historial. */
  onReplaceHash: (hash: string) => void;
}) {
  const { sessions, reloadProjects } = useSessions();
  const { openDialog, openSession, activate } = useWorkspace();
  // Worktrees no lleva elemento en la ruta: si la URL trae uno, se quita.
  const { projects, visibles, actual, loaded } = useProjectScreen('worktrees', { project: props.project, item: props.item }, props.onReplaceHash);
  const sidebar = useSidebarWidth();
  const worktrees = useWorktrees(actual?.id ?? null);

  // Recuento de la barra: worktrees abiertos de cada proyecto, que ya vienen con la lista de proyectos.
  // El harness no usa worktrees y no lleva recuento.
  const recuentos = useMemo(() => Object.fromEntries(visibles.map((p) => [p.id, p.harness ? null : p.worktrees.length])), [visibles]);

  if (!actual) return <ProjectsEmpty loaded={loaded} any={projects.length > 0} />;

  const irASesion = (name: string) => {
    openSession(name);
    activate(name);
    props.onGoToTerminal();
  };
  const nuevaEnWorktree = (wt: string) => {
    reloadProjects();
    openDialog({ project: actual.id, location: 'existing-worktree', worktree: wt });
  };

  return (
    <div className="screen screen--proyectos">
      <ProjectSidebar
        screen="worktrees"
        projects={visibles}
        currentId={actual.id}
        sidebar={sidebar}
        counts={recuentos}
        countLabel={(n) => `${n} ${n === 1 ? 'worktree' : 'worktrees'}`}
      />
      <main className="pmain">
        <ProjectHeader project={actual} path={actual.harness ? 'el harness no usa worktrees' : `projects/${actual.id}.worktrees/`} />
        <div className="ppanel">
          <WorktreesList
            project={actual}
            data={worktrees.data}
            error={worktrees.error}
            sessions={sessions}
            onOpenSession={irASesion}
            onNewSession={nuevaEnWorktree}
          />
        </div>
      </main>
    </div>
  );
}

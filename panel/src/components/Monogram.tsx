import type { ProjectInfo } from '../types.ts';

// El color de fondo es un dato dinámico (viene del proyecto), no del tema.
export function Monogram({ project, size = 'md' }: { project: Pick<ProjectInfo, 'mono' | 'color'>; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`mono mono--${size}`} style={{ background: project.color }} aria-hidden="true">
      {project.mono}
    </span>
  );
}

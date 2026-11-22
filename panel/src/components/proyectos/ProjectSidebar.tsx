import type { ReactNode } from 'react';
import { Monogram } from '../Monogram.tsx';
import { ResizeHandle } from '../ResizeHandle.tsx';
import { saveLastProject } from '../../lib/backlog.ts';
import { projectHref } from '../../lib/route.ts';
import type { ProjectScreen } from '../../lib/route.ts';
import type { PanelLimits } from '../../lib/panelWidth.ts';
import { usePanelWidth } from '../../lib/usePanelWidth.ts';
import { useMediaQuery } from '../../lib/useMediaQuery.ts';
import type { PanelWidth } from '../../lib/usePanelWidth.ts';
import type { ProjectInfo } from '../../types.ts';

const SIDEBAR_LIMITS: PanelLimits = { min: 160, max: 400, default: 210 };
/** Igual que el `@media` de `.psidebar` en proyectos.css, donde la barra queda reducida a los monogramas. */
const SIDEBAR_COMPACT_QUERY = '(max-width: 859.98px)';
const COMPACT_SIDEBAR_W = 64;

/**
 * Ancho de la barra de proyectos. Es el mismo en las tres pantallas (se recuerda
 * con una sola clave), y `width` es el que ocupa de verdad, para que el panel de
 * detalle del Backlog calcule su máximo.
 */
export function useSidebarWidth(): { panel: PanelWidth; compact: boolean; width: number } {
  const compact = useMediaQuery(SIDEBAR_COMPACT_QUERY);
  const panel = usePanelWidth('proyectos-barra', SIDEBAR_LIMITS);
  return { panel, compact, width: compact ? COMPACT_SIDEBAR_W : panel.width };
}

/** Entrada que no es un proyecto (la de «Usuario» de Skills): va al final, separada de los proyectos. */
export type SidebarExtra = { id: string; name: string; mono: string; color: string };

/**
 * Barra lateral común a Backlog, Cambios, Guías y Skills. Cada enlace lleva al otro
 * proyecto en la misma pantalla, y el recuento (si lo hay) es el de la pantalla:
 * `counts[id]` es null mientras no se conoce o no aplica, y entonces no se pinta.
 */
export function ProjectSidebar(props: {
  screen: ProjectScreen;
  projects: readonly ProjectInfo[];
  currentId: string;
  /** Entrada extra al final, separada (su recuento está en `counts[extra.id]`). Solo Skills la usa. */
  extra?: SidebarExtra;
  sidebar: ReturnType<typeof useSidebarWidth>;
  counts: Readonly<Record<string, number | null | undefined>>;
  /** Texto accesible del recuento: «3 elementos abiertos». */
  countLabel: (n: number) => string;
  /** Texto visible del recuento si no es solo el número («13 cambios»); con la barra reducida a monogramas se ve el número. */
  countText?: (n: number) => string;
  /** Ancho que ocupan otros paneles en línea del mismo contenedor (el detalle del Backlog). */
  reserved?: number;
}) {
  const { sidebar } = props;
  return (
    <>
      <nav className="psidebar" aria-label="Proyectos" style={sidebar.panel.style('--psidebar-w', !sidebar.compact)}>
        <span className="psidebar__head">Proyectos</span>
        <ul>
          {props.projects.map((p) => (
            <li key={p.id}>
              <SidebarRow screen={props.screen} id={p.id} name={p.name} project={p} current={p.id === props.currentId} counts={props.counts} countLabel={props.countLabel} countText={props.countText} remember />
            </li>
          ))}
        </ul>
        {props.extra && (
          <ul className="psidebar__extra">
            <li>
              <SidebarRow
                screen={props.screen}
                id={props.extra.id}
                name={props.extra.name}
                project={props.extra}
                current={props.extra.id === props.currentId}
                counts={props.counts}
                countLabel={props.countLabel}
                countText={props.countText}
              />
            </li>
          </ul>
        )}
      </nav>
      {!sidebar.compact && (
        <ResizeHandle
          side="left"
          limits={SIDEBAR_LIMITS}
          panel={sidebar.panel}
          label="Ancho de la barra de proyectos"
          reserved={props.reserved ?? 0}
        />
      )}
    </>
  );
}

function SidebarRow(props: {
  screen: ProjectScreen;
  id: string;
  name: string;
  project: Pick<ProjectInfo, 'mono' | 'color'>;
  current: boolean;
  counts: Readonly<Record<string, number | null | undefined>>;
  countLabel: (n: number) => string;
  countText?: (n: number) => string;
  /** Recordar el proyecto como el último usado al pulsarlo (no la entrada «Usuario»). */
  remember?: boolean;
}) {
  const n = props.counts[props.id] ?? null;
  return (
    <a className="prow" href={projectHref(props.screen, props.id)} onClick={props.remember ? () => saveLastProject(props.id) : undefined} aria-current={props.current ? 'page' : undefined}>
      <Monogram project={props.project} />
      <span className="prow__name">{props.name}</span>
      {n !== null && (
        <span className="prow__count" aria-label={props.countLabel(n)}>
          {props.countText ? (
            <>
              <span className="prow__long" aria-hidden="true">{props.countText(n)}</span>
              <span className="prow__short" aria-hidden="true">{n > 0 ? n : ''}</span>
            </>
          ) : (
            n
          )}
        </span>
      )}
    </a>
  );
}

/** Cabecera de una pantalla de proyecto: monograma, nombre y la ruta que muestra; `children` es lo propio de cada pantalla. */
export function ProjectHeader(props: { project: Pick<ProjectInfo, 'name' | 'mono' | 'color'>; path: string; children?: ReactNode }) {
  const { project } = props;
  return (
    <div className="phead">
      <span className="phead__mono" style={{ background: project.color }} aria-hidden="true">
        {project.mono}
      </span>
      <h1 className="phead__name">{project.name}</h1>
      <span className="phead__path">{props.path}</span>
      {props.children}
    </div>
  );
}

/** Mensaje de las pantallas de proyecto cuando no hay ninguno que mostrar. */
export function ProjectsEmpty({ loaded, any }: { loaded: boolean; any: boolean }) {
  return (
    <div className="screen screen--proyectos">
      <p className="pscreen__empty">{loaded && any ? 'No hay proyectos visibles: revisa la visibilidad en Ajustes.' : 'Cargando proyectos…'}</p>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { visualState } from '../../lib/sessions.ts';
import type { Layout } from '../../lib/workspace.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useImages } from '../../state/ImagesContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { fallbackProject } from '../../lib/sessions.ts';
import { focusActiveTabSoon } from '../../lib/focus.ts';
import { IconClose, IconLayout1, IconLayout2, IconLayout4, IconSidePanel } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { useSessionMenu } from './SessionMenu.tsx';

const LAYOUTS: { layout: Layout; label: string; Icon: typeof IconLayout1 }[] = [
  { layout: 1, label: 'Una terminal', Icon: IconLayout1 },
  { layout: 2, label: 'Dos columnas', Icon: IconLayout2 },
  { layout: 4, label: 'Cuadrícula de cuatro', Icon: IconLayout4 },
];

export function TabsBar() {
  const { sessions, projects } = useSessions();
  const { workspace, visible, activate, move, closeTab, setLayout, contextVisible, toggleContext, requestTerminalFocus } = useWorkspace();
  const { viewer, closeViewer } = useImages();
  const lista = useRef<HTMLDivElement>(null);
  const { menu, onContextMenu, onKeyDown } = useSessionMenu({ onTabClosed: focusActiveTabSoon });

  // La pestaña seleccionada siempre queda a la vista (atajo, clic o al abrir). Si el foco
  // estaba en la lista de pestañas, lo sigue: las flechas no mandan el foco a la terminal.
  useEffect(() => {
    const sel = lista.current?.querySelector<HTMLElement>('.tab[aria-selected="true"]');
    if (!sel) return;
    sel.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    if (lista.current?.contains(document.activeElement)) sel.focus({ preventScroll: true });
  }, [workspace.active, workspace.tabs.length]);

  // Cierra la pestaña en el panel (la sesión sigue viva en tmux) y deja el foco en la pestaña activa.
  const cerrar = (name: string) => {
    closeTab(name);
    focusActiveTabSoon();
  };

  return (
    <div className="tabsbar">
      <div
        ref={lista}
        className="tabs"
        role="tablist"
        aria-label="Terminales abiertas"
        onKeyDown={(e) => {
          // Flechas dentro de la lista de pestañas (sin Ctrl+Alt, que es el atajo global).
          if (e.ctrlKey || e.altKey || e.metaKey) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            move(e.key === 'ArrowRight' ? 1 : -1);
          }
        }}
      >
        {workspace.tabs.map((name) => {
          const s = sessions.find((x) => x.name === name);
          if (!s) return null;
          const estado = visualState(s);
          const proyecto = projects.find((p) => p.id === s.project) ?? fallbackProject(s.project);
          const activa = workspace.active === name;
          return (
            // El contenedor no es un control: la pestaña y su «x» son botones hermanos (no se anidan).
            <div
              key={name}
              role="presentation"
              className={`tabwrap${activa ? ' tabwrap--active' : ''}`}
              onContextMenu={(e) => onContextMenu(e, s, e.currentTarget.querySelector<HTMLElement>('.tab'))}
              onKeyDown={(e) => onKeyDown(e, s, e.currentTarget.querySelector<HTMLElement>('.tab'))}
              // El clic central cierra la pestaña, como en el navegador; sin esto el navegador activa el autodesplazamiento.
              onMouseDown={(e) => e.button === 1 && e.preventDefault()}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                cerrar(name);
              }}
            >
              <button
                type="button"
                role="tab"
                id={`tab-${name}`}
                aria-selected={activa}
                aria-controls={visible.includes(name) ? `pane-${name}` : undefined}
                tabIndex={activa ? 0 : -1}
                className={`tab tab--${estado}${visible.includes(name) ? ' tab--visible' : ''}`}
                onClick={() => {
                  // Clic, Enter o Espacio: la pestaña se activa y la terminal recibe el foco.
                  activate(name);
                  requestTerminalFocus();
                }}
                title={`${s.title} · ${proyecto.name}`}
              >
                <StatusLight state={estado} label />
                <Monogram project={proyecto} size="sm" />
                <span className="tab__title">{s.title}</span>
              </button>
              <button
                type="button"
                className="tab__close"
                aria-label={`Cerrar pestaña de ${s.title}`}
                title="Cerrar en el panel (la sesión sigue viva)"
                tabIndex={activa ? 0 : -1}
                onClick={() => cerrar(name)}
              >
                <IconClose size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tabsbar__tools">
        <span className="tabsbar__label">Distribución</span>
        {LAYOUTS.map(({ layout, label, Icon }) => (
          <button
            key={layout}
            type="button"
            className="icon-btn icon-btn--box"
            aria-label={label}
            aria-pressed={workspace.layout === layout}
            title={label}
            onClick={() => setLayout(layout)}
          >
            <Icon />
          </button>
        ))}
        <button
          type="button"
          className="icon-btn icon-btn--box"
          aria-label="Mostrar u ocultar el panel de contexto"
          aria-pressed={contextVisible && !viewer}
          title="Panel de contexto"
          onClick={() => {
            // Con el visor abierto, el botón lo cierra y muestra el contexto.
            if (!viewer) toggleContext();
            else {
              closeViewer();
              if (!contextVisible) toggleContext();
            }
          }}
        >
          <IconSidePanel />
        </button>
      </div>
      {menu}
    </div>
  );
}

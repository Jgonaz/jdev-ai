import { useEffect, useRef } from 'react';
import { visualState } from '../../lib/sessions.ts';
import type { Layout } from '../../lib/workspace.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { fallbackProject } from '../../lib/sessions.ts';
import { IconLayout1, IconLayout2, IconLayout4, IconSidePanel } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';

const LAYOUTS: { layout: Layout; label: string; Icon: typeof IconLayout1 }[] = [
  { layout: 1, label: 'Una terminal', Icon: IconLayout1 },
  { layout: 2, label: 'Dos columnas', Icon: IconLayout2 },
  { layout: 4, label: 'Cuadrícula de cuatro', Icon: IconLayout4 },
];

export function TabsBar() {
  const { sessions, projects } = useSessions();
  const { workspace, visible, activate, move, setLayout, contextVisible, toggleContext, requestTerminalFocus } = useWorkspace();
  const lista = useRef<HTMLDivElement>(null);

  // La pestaña seleccionada siempre queda a la vista (atajo, clic o al abrir). Si el foco
  // estaba en la lista de pestañas, lo sigue: las flechas no mandan el foco a la terminal.
  useEffect(() => {
    const sel = lista.current?.querySelector<HTMLElement>('.tab[aria-selected="true"]');
    if (!sel) return;
    sel.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    if (lista.current?.contains(document.activeElement)) sel.focus({ preventScroll: true });
  }, [workspace.active, workspace.tabs.length]);

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
            <button
              key={name}
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
          aria-pressed={contextVisible}
          title="Panel de contexto"
          onClick={toggleContext}
        >
          <IconSidePanel />
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { visualState } from '../../lib/sessions.ts';
import type { Layout } from '../../lib/workspace.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useImages } from '../../state/ImagesContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { fallbackProject } from '../../lib/sessions.ts';
import { focusActiveTabSoon } from '../../lib/focus.ts';
import { isFollowKey, parseFollowKey } from '../../lib/follow.ts';
import { useFollowEntry } from '../../lib/useFollow.ts';
import { IconClose, IconEye, IconLayout1, IconLayout2, IconLayout4, IconShell, IconSidePanel } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { useSessionMenu } from './SessionMenu.tsx';

const LAYOUTS: { layout: Layout; label: string; Icon: typeof IconLayout1 }[] = [
  { layout: 1, label: 'Una terminal', Icon: IconLayout1 },
  { layout: 2, label: 'Dos columnas', Icon: IconLayout2 },
  { layout: 4, label: 'Cuadrícula de cuatro', Icon: IconLayout4 },
];

/** Pestaña de seguimiento de un subagente o una shell: solo lectura, sin luz de estado de sesión. */
function FollowTab({ clave, activa, enPantalla, onClose }: { clave: string; activa: boolean; enPantalla: boolean; onClose: () => void }) {
  const objetivo = parseFollowKey(clave);
  const { sessions } = useSessions();
  const { activate } = useWorkspace();
  const guardado = useFollowEntry(clave);
  if (!objetivo) return null;
  const esAgente = objetivo.kind === 'agent';
  const actividad = sessions.find((s) => s.name === objetivo.session)?.activity;
  const tipo = guardado?.meta?.agentType || actividad?.subagents.find((a) => a.id === objetivo.id)?.type || 'subagente';
  const nombre = esAgente
    ? (guardado?.meta?.description ?? '')
    : guardado?.meta?.command || actividad?.shells.find((a) => a.id === objetivo.id)?.label || 'shell';
  const completo = esAgente ? `${tipo}${nombre ? ` · ${nombre}` : ''}` : nombre;
  return (
    <div
      role="presentation"
      className={`tabwrap${activa ? ' tabwrap--active' : ''}`}
      // El clic central cierra la pestaña, como en el navegador; sin esto el navegador activa el autodesplazamiento.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose();
      }}
    >
      <button
        type="button"
        role="tab"
        id={`tab-${clave}`}
        aria-selected={activa}
        aria-controls={enPantalla ? `pane-${clave}` : undefined}
        tabIndex={activa ? 0 : -1}
        className={`tab tab--follow${enPantalla ? ' tab--visible' : ''}`}
        onClick={() => activate(clave)}
        title={`Seguimiento (solo lectura): ${completo}`}
      >
        <span className="tab__eye">{esAgente ? <IconEye size={14} /> : <IconShell size={14} />}</span>
        {esAgente ? (
          <>
            <span className="tab__kind">{tipo}</span>
            {nombre && <span className="tab__title">{nombre}</span>}
          </>
        ) : (
          <span className="tab__kind tab__title">{nombre}</span>
        )}
      </button>
      <button
        type="button"
        className="tab__close"
        aria-label={`Cerrar el seguimiento de ${esAgente ? tipo : nombre}`}
        title="Cerrar el seguimiento"
        tabIndex={activa ? 0 : -1}
        onClick={onClose}
      >
        <IconClose size={12} />
      </button>
    </div>
  );
}

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
          if (isFollowKey(name)) {
            return <FollowTab key={name} clave={name} activa={workspace.active === name} enPantalla={visible.includes(name)} onClose={() => cerrar(name)} />;
          }
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

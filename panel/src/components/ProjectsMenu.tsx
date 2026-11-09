import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { loadLastProject, pickProject } from '../lib/backlog.ts';
import { projectHref } from '../lib/route.ts';
import type { ProjectScreen } from '../lib/route.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { IconChevron } from './Icons.tsx';

const OPCIONES: { pantalla: ProjectScreen; label: string }[] = [
  { pantalla: 'backlog', label: 'Backlog' },
  { pantalla: 'cambios', label: 'Cambios' },
  { pantalla: 'guias', label: 'Guías' },
];

// Con ratón, el menú se abre al detenerse sobre el botón y se cierra al salir de él
// y del menú. El retardo de apertura evita que se abra al cruzar la cabecera camino
// de otra cosa; el de cierre deja cruzar el hueco entre el botón y la lista.
const RETARDO_ABRIR_MS = 120;
const RETARDO_CERRAR_MS = 250;

/**
 * «Proyectos» de la cabecera: un desplegable con las tres pantallas de proyecto
 * (Backlog, Cambios y Guías). Es un solo botón (no uno partido): el menú es la
 * única forma de llegar a ellas. Cada opción es un enlace a la pantalla del
 * último proyecto usado (o el primero visible), así que también funciona con
 * Ctrl+clic y sirve estando ya en una de ellas. `pantalla` es la pantalla de
 * proyecto en curso (null en cualquier otra): marca el botón como activo y la
 * opción como la actual (aria-current) dentro del menú.
 *
 * Se abre con clic, con Enter, Espacio o las flechas, y con el puntero de tipo
 * ratón al detenerse encima (en táctil, solo con clic). Si se abrió por hover,
 * no roba el foco y se cierra al salir; un clic o el teclado lo fijan abierto.
 */
export function ProjectsMenu({ pantalla }: { pantalla: ProjectScreen | null }) {
  const { projects } = useSessions();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const focoInicial = useRef<'primero' | 'ultimo' | 'ninguno'>('primero');
  // Abierto solo por hover: se cierra al salir y no ha movido el foco.
  const porHover = useRef(false);
  const temporizador = useRef<number | null>(null);
  // Se decide al abrir el menú: el último proyecto cambia al usar las pantallas de proyecto.
  const [proyecto, setProyecto] = useState<string | null>(null);

  const limpiarTemporizador = () => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    temporizador.current = null;
  };
  useEffect(() => limpiarTemporizador, []);

  const abrir = (foco: 'primero' | 'ultimo' | 'ninguno' = 'primero') => {
    limpiarTemporizador();
    porHover.current = foco === 'ninguno';
    const ids = projects.filter((p) => p.visible).map((p) => p.id);
    setProyecto(pickProject(ids, null, loadLastProject()));
    focoInicial.current = foco;
    setAbierto(true);
  };
  const cerrar = (devolverFoco: boolean) => {
    limpiarTemporizador();
    setAbierto(false);
    if (devolverFoco) boton.current?.focus();
  };

  // Al abrirse, el foco entra en el menú (en la primera opción, o la última si se abrió con ↑).
  useEffect(() => {
    if (!abierto) return;
    if (focoInicial.current === 'ninguno') return;
    const items = raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[focoInicial.current === 'primero' ? 0 : items.length - 1]?.focus();
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) cerrar(false);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const alPulsarBoton = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && abierto) {
      e.preventDefault();
      cerrar(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (abierto) {
        // Ya abierto (p. ej. por hover): el teclado lo fija y entra en la lista.
        porHover.current = false;
        const items = raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        items?.[e.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
      } else {
        abrir(e.key === 'ArrowDown' ? 'primero' : 'ultimo');
      }
    }
  };
  const alClicar = () => {
    if (abierto && porHover.current) porHover.current = false; // el clic fija el menú abierto
    else if (abierto) cerrar(false);
    else abrir();
  };
  const alEntrar = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    limpiarTemporizador();
    if (abierto) return;
    temporizador.current = window.setTimeout(() => abrir('ninguno'), RETARDO_ABRIR_MS);
  };
  const alSalir = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    limpiarTemporizador();
    if (!abierto || !porHover.current) return;
    temporizador.current = window.setTimeout(() => cerrar(false), RETARDO_CERRAR_MS);
  };
  const alPulsarMenu = (e: KeyboardEvent) => {
    const items = [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let j = -1;
    if (e.key === 'ArrowDown') j = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = items.length - 1;
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cerrar(true);
      return;
    } else if (e.key === 'Tab') {
      // Tab sale del menú sin atraparlo: se cierra y el foco sigue su camino.
      cerrar(false);
      return;
    }
    if (j < 0) return;
    e.preventDefault();
    items[j]?.focus();
  };

  return (
    <div className="navmenu" ref={raiz} onPointerEnter={alEntrar} onPointerLeave={alSalir}>
      <button
        ref={boton}
        type="button"
        className="nav__link"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        aria-current={pantalla ? 'page' : undefined}
        onClick={alClicar}
        onKeyDown={alPulsarBoton}
      >
        Proyectos
        <IconChevron size={12} className="nav__caret" />
      </button>
      {abierto && (
        <div id={idMenu} className="menu__list" role="menu" aria-label="Proyectos" onKeyDown={alPulsarMenu}>
          {OPCIONES.map((o) => (
            <a
              key={o.pantalla}
              role="menuitem"
              className="menu__item"
              href={projectHref(o.pantalla, o.pantalla === 'cambios' && pantalla !== 'cambios' ? null : proyecto)}
              aria-current={pantalla === o.pantalla ? 'page' : undefined}
              tabIndex={-1}
              onClick={() => cerrar(false)}
            >
              {o.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

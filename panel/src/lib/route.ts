import { useCallback, useEffect, useMemo, useState } from 'react';

export type Route = 'inicio' | 'terminales' | 'backlog' | 'worktrees' | 'guias' | 'historial' | 'ajustes';

/** Pantalla que se muestra con la URL sin ruta (ajuste «Pantalla al abrir»). */
export type StartScreen = 'inicio' | 'terminales';

/** Pantallas de un proyecto, a las que se llega desde el menú «Proyectos». */
export type ProjectScreen = 'backlog' | 'worktrees' | 'guias';
export const PROJECT_SCREENS: readonly ProjectScreen[] = ['backlog', 'worktrees', 'guias'];

export const isProjectScreen = (r: Route | string | null | undefined): r is ProjectScreen => PROJECT_SCREENS.some((p) => p === r);

export type ResolvedRoute = {
  route: Route;
  /**
   * Proyecto de las rutas por proyecto (`#/backlog/<id>`, `#/worktrees/<id>`,
   * `#/guias/<id>`) y del historial (`#/historial/<id>/<archivo>`).
   */
  project: string | null;
  /**
   * Elemento del backlog de `#/backlog/<id>/<itemId>`, ruta de la guía de
   * `#/guias/<id>/<ruta>` o archivo de la entrada de `#/historial/<id>/<archivo>`.
   */
  item: string | null;
  /** La URL no lleva ruta: la pantalla es la de «Pantalla al abrir». */
  implicit: boolean;
  /** El hash pedido no es una ruta conocida y debe quitarse (vuelve a la pantalla al abrir). */
  normalize: boolean;
  /**
   * Hash al que hay que sustituir el pedido: las rutas antiguas `#/proyectos…`
   * (de enlaces guardados) se traducen a las de cada pantalla. null si no hay que corregir.
   */
  redirect: string | null;
};

const decodificar = (s: string | undefined): string | null => {
  if (s === undefined || s === '') return null;
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/** Ruta de una guía (`a/b.md`) a partir de los segmentos de la URL, o null si no hay o alguno no se decodifica. */
const decodificarRuta = (partes: string[]): string | null => {
  if (partes.length === 0) return null;
  const decodificadas = partes.map(decodificar);
  return decodificadas.every((d) => d !== null) ? decodificadas.join('/') : null;
};

const NOMBRES_ANTIGUOS: readonly string[] = ['worktrees', 'guias', 'backlog'];

// Formato de los identificadores del backlog (el mismo que ITEM_ID_RE de server/backlog.ts).
const ITEM_ID = /^BL-[0-9]{8}-[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveRoute(hash: string, start: StartScreen = 'inicio'): ResolvedRoute {
  const clave = hash.replace(/^#\/?/, '');
  const base = { project: null, item: null, implicit: false, normalize: false, redirect: null };
  if (clave === '') return { ...base, route: start, implicit: true };
  if (clave === 'ajustes' || clave === 'terminales' || clave === 'inicio') return { ...base, route: clave };
  const partes = clave.split('/');
  if (partes[0] === 'backlog' && partes.length <= 3) {
    const project = decodificar(partes[1]);
    const item = decodificar(partes[2]);
    // Un elemento con formato imposible se quita de la URL sin preguntar al servidor.
    if (partes[2] !== undefined && (item === null || !ITEM_ID.test(item))) {
      return { ...base, route: 'backlog', project, redirect: projectHref('backlog', project, null) };
    }
    return { ...base, route: 'backlog', project, item };
  }
  if (partes[0] === 'worktrees' && partes.length <= 2) {
    return { ...base, route: 'worktrees', project: decodificar(partes[1]) };
  }
  // Guías: la ruta de la guía puede tener subcarpetas, así que ocupa el resto de la URL.
  if (partes[0] === 'guias') {
    const project = decodificar(partes[1]);
    const item = decodificarRuta(partes.slice(2));
    // Una guía que no se puede decodificar se quita de la URL.
    if (partes.length > 2 && item === null) {
      return { ...base, route: 'guias', project, redirect: projectHref('guias', project, null) };
    }
    return { ...base, route: 'guias', project, item };
  }
  // Ruta antigua `#/proyectos[/<id>[/<elemento o pestaña>]]`: se traduce a la de la pantalla.
  // Los identificadores del backlog empiezan por `BL-`, así que un elemento nunca se confunde con una pestaña.
  if (partes[0] === 'proyectos' && partes.length <= 3) {
    const project = decodificar(partes[1]);
    const tercero = partes[2];
    const pantalla: ProjectScreen = tercero !== undefined && NOMBRES_ANTIGUOS.includes(tercero) ? (tercero as ProjectScreen) : 'backlog';
    const item = pantalla === 'backlog' && tercero !== 'backlog' ? decodificar(tercero) : null;
    return { ...base, route: pantalla, project, item, redirect: projectHref(pantalla, project, item) };
  }
  if (partes[0] === 'historial' && partes.length <= 3) {
    const project = decodificar(partes[1]);
    const item = decodificar(partes[2]);
    // Una entrada necesita proyecto y archivo; si falta alguno se muestra la lista sola.
    return project && item ? { ...base, route: 'historial', project, item } : { ...base, route: 'historial' };
  }
  return { ...base, route: start, implicit: true, normalize: true };
}

export function parseRoute(hash: string): Route {
  return resolveRoute(hash).route;
}

export function routeHref(ruta: Route): string {
  return `#/${ruta}`;
}

/**
 * Ruta de una pantalla de proyecto: `#/backlog[/<id>[/<itemId>]]`,
 * `#/worktrees[/<id>]` o `#/guias[/<id>[/<ruta de la guía>]]`. Sin proyecto, la
 * pantalla elige el último usado o el primero visible. Worktrees no lleva
 * elemento. La ruta de una guía conserva sus `/` y codifica cada tramo.
 */
export function projectHref(pantalla: ProjectScreen, proyecto?: string | null, item?: string | null): string {
  const raiz = `#/${pantalla}`;
  if (!proyecto) return raiz;
  const p = `${raiz}/${encodeURIComponent(proyecto)}`;
  if (!item || pantalla === 'worktrees') return p;
  return pantalla === 'guias' ? `${p}/${item.split('/').map(encodeURIComponent).join('/')}` : `${p}/${encodeURIComponent(item)}`;
}

/** `#/historial` o `#/historial/<proyecto>/<archivo>`. */
export function historyHref(proyecto?: string | null, archivo?: string | null): string {
  if (!proyecto || !archivo) return '#/historial';
  return `#/historial/${encodeURIComponent(proyecto)}/${encodeURIComponent(archivo)}`;
}

/**
 * Hash canónico de una pantalla de proyecto para lo que se muestra, o null si el
 * pedido ya lo es. Un proyecto inexistente u oculto se sustituye por el mostrado
 * (sin elemento), y el elemento se quita si no se muestra (`withItem` falso: un
 * elemento o una guía que no existe) o si la pantalla no lleva ninguno (Worktrees).
 */
export function canonicalProjectHref(
  pantalla: ProjectScreen,
  pedido: { project: string | null; item: string | null },
  mostrado: string,
  withItem = true,
): string | null {
  const item = pantalla !== 'worktrees' && pedido.project === mostrado && withItem ? pedido.item : null;
  return pedido.project === mostrado && pedido.item === item ? null : projectHref(pantalla, mostrado, item);
}

/**
 * Enrutado mínimo por hash: no hace falta una librería para siete pantallas.
 * Sin ruta se muestra la pantalla de `start` (y la sigue si cambia el ajuste);
 * las rutas desconocidas se quitan de la URL con replaceState, para que Atrás
 * no vuelva a la ruta rota.
 */
export function useRoute(start: StartScreen): {
  ruta: Route;
  proyecto: string | null;
  elemento: string | null;
  /** La pantalla sale de «Pantalla al abrir» (URL sin ruta). */
  implicita: boolean;
  navegar: (r: Route) => void;
  /** Sustituye el hash sin añadir una entrada al historial (Atrás no vuelve a la URL corregida). */
  reemplazar: (hash: string) => void;
} {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const aplicar = () => {
      const actual = window.location.hash;
      const resuelta = resolveRoute(actual);
      if (resuelta.normalize) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setHash('');
      } else if (resuelta.redirect !== null) {
        // Ruta antigua de Proyectos: se sustituye por la de su pantalla, sin entrada nueva en el historial.
        window.history.replaceState(null, '', window.location.pathname + window.location.search + resuelta.redirect);
        setHash(resuelta.redirect);
      } else setHash(actual);
    };
    aplicar();
    window.addEventListener('hashchange', aplicar);
    return () => window.removeEventListener('hashchange', aplicar);
  }, []);
  const navegar = useCallback((r: Route) => {
    window.location.hash = routeHref(r);
  }, []);
  // replaceState no emite hashchange: se actualiza el estado a mano.
  const reemplazar = useCallback((nuevo: string) => {
    window.history.replaceState(null, '', nuevo);
    setHash(nuevo);
  }, []);
  const resuelta = useMemo(() => resolveRoute(hash, start), [hash, start]);
  return {
    ruta: resuelta.route,
    proyecto: resuelta.project,
    elemento: resuelta.item,
    implicita: resuelta.implicit,
    navegar,
    reemplazar,
  };
}

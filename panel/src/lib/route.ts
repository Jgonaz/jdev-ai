import { useCallback, useEffect, useMemo, useState } from 'react';

export type Route = 'inicio' | 'terminales' | 'proyectos' | 'historial' | 'ajustes';

/** Pantalla que se muestra con la URL sin ruta (ajuste «Pantalla al abrir»). */
export type StartScreen = 'inicio' | 'terminales';

export type ResolvedRoute = {
  route: Route;
  /**
   * Proyecto y elemento del backlog de `#/proyectos/<id>/<itemId>`, o proyecto
   * y archivo de la entrada de `#/historial/<id>/<archivo>`.
   */
  project: string | null;
  item: string | null;
  /** La URL no lleva ruta: la pantalla es la de «Pantalla al abrir». */
  implicit: boolean;
  /** El hash pedido no es una ruta conocida y debe quitarse (vuelve a la pantalla al abrir). */
  normalize: boolean;
};

const decodificar = (s: string | undefined): string | null => {
  if (s === undefined || s === '') return null;
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

export function resolveRoute(hash: string, start: StartScreen = 'inicio'): ResolvedRoute {
  const clave = hash.replace(/^#\/?/, '');
  const base = { project: null, item: null, implicit: false, normalize: false };
  if (clave === '') return { ...base, route: start, implicit: true };
  if (clave === 'ajustes' || clave === 'terminales' || clave === 'inicio') return { ...base, route: clave };
  const partes = clave.split('/');
  if (partes[0] === 'proyectos' && partes.length <= 3) {
    return { ...base, route: 'proyectos', project: decodificar(partes[1]), item: decodificar(partes[2]) };
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

/** `#/proyectos`, `#/proyectos/<id>` o `#/proyectos/<id>/<itemId>`. */
export function projectHref(proyecto?: string | null, item?: string | null): string {
  if (!proyecto) return '#/proyectos';
  const p = `#/proyectos/${encodeURIComponent(proyecto)}`;
  return item ? `${p}/${encodeURIComponent(item)}` : p;
}

/** `#/historial` o `#/historial/<proyecto>/<archivo>`. */
export function historyHref(proyecto?: string | null, archivo?: string | null): string {
  if (!proyecto || !archivo) return '#/historial';
  return `#/historial/${encodeURIComponent(proyecto)}/${encodeURIComponent(archivo)}`;
}

/**
 * Hash canónico de Proyectos para lo que se muestra, o null si el pedido ya lo
 * es. Un proyecto inexistente u oculto se sustituye por el mostrado (sin
 * elemento), y el elemento se quita si no se muestra (`withItem` falso: otra
 * pestaña o un elemento que no existe).
 */
export function canonicalProjectHref(
  pedido: { project: string | null; item: string | null },
  mostrado: string,
  withItem: boolean,
): string | null {
  const item = pedido.project === mostrado && withItem ? pedido.item : null;
  return pedido.project === mostrado && pedido.item === item ? null : projectHref(mostrado, item);
}

/**
 * Enrutado mínimo por hash: no hace falta una librería para cinco pantallas.
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
      if (resolveRoute(actual).normalize) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        setHash('');
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

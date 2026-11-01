import { useCallback, useEffect, useState } from 'react';

export type Route = 'terminales' | 'proyectos' | 'ajustes';

/** Secciones del diseño que aún no existen. */
export const FUTURE_SECTIONS: Record<string, string> = {
  inicio: 'Inicio',
  historial: 'Historial',
};

export type ResolvedRoute = {
  route: Route;
  /** Proyecto y elemento del backlog de `#/proyectos/<id>/<itemId>`. */
  project: string | null;
  item: string | null;
  /** Nombre de la sección futura pedida (para el aviso «Próximamente»). */
  soon: string | null;
  /** El hash pedido no es canónico y debe sustituirse por `#/terminales`. */
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

export function resolveRoute(hash: string): ResolvedRoute {
  const clave = hash.replace(/^#\/?/, '');
  const base = { project: null, item: null, soon: null, normalize: false };
  if (clave === 'ajustes') return { ...base, route: 'ajustes' };
  if (clave === 'terminales' || clave === '') return { ...base, route: 'terminales' };
  const partes = clave.split('/');
  if (partes[0] === 'proyectos' && partes.length <= 3) {
    return { ...base, route: 'proyectos', project: decodificar(partes[1]), item: decodificar(partes[2]) };
  }
  const futura = Object.hasOwn(FUTURE_SECTIONS, clave) ? FUTURE_SECTIONS[clave]! : null;
  return { ...base, route: 'terminales', soon: futura, normalize: true };
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
 * Enrutado mínimo por hash: no hace falta una librería para tres pantallas.
 * Las rutas futuras y las desconocidas se normalizan a `#/terminales` (con
 * replaceState, para que Atrás no vuelva a la ruta rota) y las futuras
 * devuelven su nombre en `aviso` para decir «Próximamente».
 */
export function useRoute(): {
  ruta: Route;
  proyecto: string | null;
  elemento: string | null;
  navegar: (r: Route) => void;
  /** Sustituye el hash sin añadir una entrada al historial (Atrás no vuelve a la URL corregida). */
  reemplazar: (hash: string) => void;
  aviso: string | null;
  descartarAviso: () => void;
} {
  const [resuelta, setResuelta] = useState<ResolvedRoute>(() => resolveRoute(window.location.hash));
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    const aplicar = () => {
      const r = resolveRoute(window.location.hash);
      if (r.normalize) window.history.replaceState(null, '', routeHref('terminales'));
      if (r.soon) setAviso(r.soon);
      setResuelta(r);
    };
    aplicar();
    window.addEventListener('hashchange', aplicar);
    return () => window.removeEventListener('hashchange', aplicar);
  }, []);
  const navegar = useCallback((r: Route) => {
    window.location.hash = routeHref(r);
  }, []);
  // replaceState no emite hashchange: se actualiza el estado a mano.
  const reemplazar = useCallback((hash: string) => {
    window.history.replaceState(null, '', hash);
    setResuelta(resolveRoute(hash));
  }, []);
  const descartarAviso = useCallback(() => setAviso(null), []);
  return { ruta: resuelta.route, proyecto: resuelta.project, elemento: resuelta.item, navegar, reemplazar, aviso, descartarAviso };
}

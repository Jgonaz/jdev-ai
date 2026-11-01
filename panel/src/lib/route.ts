import { useCallback, useEffect, useState } from 'react';

export type Route = 'terminales' | 'ajustes';

/** Secciones del diseño que aún no existen. */
export const FUTURE_SECTIONS: Record<string, string> = {
  inicio: 'Inicio',
  proyectos: 'Proyectos',
  historial: 'Historial',
};

export type ResolvedRoute = {
  route: Route;
  /** Nombre de la sección futura pedida (para el aviso «Próximamente»). */
  soon: string | null;
  /** El hash pedido no es canónico y debe sustituirse por `#/terminales`. */
  normalize: boolean;
};

export function resolveRoute(hash: string): ResolvedRoute {
  const clave = hash.replace(/^#\/?/, '');
  if (clave === 'ajustes') return { route: 'ajustes', soon: null, normalize: false };
  if (clave === 'terminales' || clave === '') return { route: 'terminales', soon: null, normalize: false };
  const futura = Object.hasOwn(FUTURE_SECTIONS, clave) ? FUTURE_SECTIONS[clave]! : null;
  return { route: 'terminales', soon: futura, normalize: true };
}

export function parseRoute(hash: string): Route {
  return resolveRoute(hash).route;
}

export function routeHref(ruta: Route): string {
  return `#/${ruta}`;
}

/**
 * Enrutado mínimo por hash: no hace falta una librería para dos pantallas.
 * Las rutas futuras y las desconocidas se normalizan a `#/terminales` (con
 * replaceState, para que Atrás no vuelva a la ruta rota) y las futuras
 * devuelven su nombre en `aviso` para decir «Próximamente».
 */
export function useRoute(): { ruta: Route; navegar: (r: Route) => void; aviso: string | null; descartarAviso: () => void } {
  const [ruta, setRuta] = useState<Route>(() => parseRoute(window.location.hash));
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    const aplicar = () => {
      const r = resolveRoute(window.location.hash);
      if (r.normalize) window.history.replaceState(null, '', routeHref('terminales'));
      if (r.soon) setAviso(r.soon);
      setRuta(r.route);
    };
    aplicar();
    window.addEventListener('hashchange', aplicar);
    return () => window.removeEventListener('hashchange', aplicar);
  }, []);
  const navegar = useCallback((r: Route) => {
    window.location.hash = routeHref(r);
  }, []);
  const descartarAviso = useCallback(() => setAviso(null), []);
  return { ruta, navegar, aviso, descartarAviso };
}

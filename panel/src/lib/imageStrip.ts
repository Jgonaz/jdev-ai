// Tira de imágenes de una terminal: las rutas que se han abierto o que aparecen
// en ella, la más reciente primero y con un máximo.

export const MAX_STRIP = 20;

/**
 * Añade una ruta al principio de la tira. Si ya estaba se deja donde estaba
 * (la tira no se reordena al elegir una imagen) y se devuelve la misma lista.
 * Al pasar el máximo se descartan las más antiguas.
 */
export function pushImage(lista: readonly string[], path: string, max: number = MAX_STRIP): readonly string[] {
  if (lista.includes(path)) return lista;
  return [path, ...lista].slice(0, max);
}

/** Añade varias rutas (de la más antigua a la más reciente), de modo que la última queda la primera. */
export function pushImages(lista: readonly string[], paths: readonly string[], max: number = MAX_STRIP): readonly string[] {
  return paths.reduce((acc, p) => pushImage(acc, p, max), lista);
}

/** Ruta vecina en la tira (con vuelta) al mover la selección con las flechas; null si la lista está vacía. */
export function neighbour(lista: readonly string[], actual: string | null, delta: number): string | null {
  if (lista.length === 0) return null;
  const i = actual === null ? -1 : lista.indexOf(actual);
  if (i < 0) return lista[delta < 0 ? lista.length - 1 : 0]!;
  return lista[(((i + delta) % lista.length) + lista.length) % lista.length]!;
}

/** Nombre del archivo y carpeta de una ruta, para la cabecera y las etiquetas del visor. */
export function splitPath(path: string): { name: string; dir: string } {
  const limpia = path.replace(/\/+$/, '');
  const i = limpia.lastIndexOf('/');
  if (i < 0) return { name: limpia, dir: '' };
  return { name: limpia.slice(i + 1), dir: i === 0 ? '/' : limpia.slice(0, i) };
}

// ------------------------------------------------------- Deduplicar por ruta resuelta

/** Normaliza una ruta sin tocar el disco: quita «//», «.» y resuelve «..» donde se puede. */
export function normalizePath(path: string): string {
  const absoluta = path.startsWith('/');
  const trozos: string[] = [];
  for (const t of path.split('/')) {
    if (t === '' || t === '.') continue;
    if (t === '..') {
      if (trozos.length > 0 && trozos[trozos.length - 1] !== '..') trozos.pop();
      else if (!absoluta) trozos.push('..');
    } else {
      trozos.push(t);
    }
  }
  const unida = trozos.join('/');
  return absoluta ? `/${unida}` : unida === '' ? '.' : unida;
}

/**
 * Forma comparable de una ruta: la absoluta normalizada y la relativa unida al
 * directorio de la terminal si se conoce (si no, solo normalizada).
 */
export function canonicalPath(path: string, cwd: string | null | undefined): string {
  if (path.startsWith('/') || !cwd) return normalizePath(path);
  return normalizePath(`${cwd}/${path}`);
}

/**
 * Directorio de la terminal deducido de una ruta relativa y de la ruta real que
 * devolvió el servidor, o null si no se puede (la relativa sube con «..» o la
 * real no termina igual, p. ej. por un enlace simbólico).
 */
export function inferCwd(relativa: string, resuelta: string): string | null {
  if (relativa.startsWith('/') || !resuelta.startsWith('/')) return null;
  const rel = normalizePath(relativa);
  const partes = rel.split('/');
  if (partes.includes('..') || rel === '.') return null;
  const real = resuelta.split('/').filter((t) => t !== '');
  if (real.length < partes.length) return null;
  const cola = real.slice(real.length - partes.length);
  if (cola.some((t, i) => t !== partes[i])) return null;
  const base = real.slice(0, real.length - partes.length);
  return `/${base.join('/')}`;
}

/** Pasa cada ruta a su forma canónica y quita las repetidas (se queda con la primera). */
export function canonicalList(lista: readonly string[], cwd: string | null | undefined): readonly string[] {
  const vistas = new Set<string>();
  const nueva: string[] = [];
  for (const p of lista) {
    const c = canonicalPath(p, cwd);
    if (vistas.has(c)) continue;
    vistas.add(c);
    nueva.push(c);
  }
  return nueva.length === lista.length && nueva.every((p, i) => p === lista[i]) ? lista : nueva;
}

/**
 * Sustituye `de` por la ruta real `a`. Si `a` ya estaba en la tira se quita `de`
 * (eran el mismo archivo); si no, `a` ocupa su sitio. Devuelve la misma lista si no cambia nada.
 */
export function replaceResolved(lista: readonly string[], de: string, a: string): readonly string[] {
  if (de === a || !lista.includes(de)) return lista;
  if (lista.includes(a)) return lista.filter((p) => p !== de);
  return lista.map((p) => (p === de ? a : p));
}

/**
 * Añade rutas (de la más antigua a la más reciente) sin repetir lo que ya está:
 * una relativa cuya forma absoluta, según el directorio `cwd` de la terminal, ya
 * figura en la tira no se añade.
 */
export function pushResolved(lista: readonly string[], paths: readonly string[], cwd: string | null | undefined, max: number = MAX_STRIP): readonly string[] {
  return paths.reduce((acc, p) => {
    const c = canonicalPath(p, cwd);
    return c !== p && acc.includes(c) ? acc : pushImage(acc, p, max);
  }, lista);
}

/** ¿Está ya la imagen en la tira? Compara por ruta canónica (una relativa se une al directorio de la terminal si se conoce). */
export function stripHas(lista: readonly string[], path: string, cwd: string | null | undefined): boolean {
  const c = canonicalPath(path, cwd);
  return lista.some((p) => p === path || canonicalPath(p, cwd) === c);
}

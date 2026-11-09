// Árbol de archivos cambiados de un lugar (checkout principal o worktree), al estilo del explorador de VSCode.
// Lógica pura: la vista (FileTree.tsx) solo la pinta.

export type TreeInput = { path: string; added: number | null; deleted: number | null };

export type FileNode<T extends TreeInput> = { kind: 'file'; name: string; path: string; file: T };
export type DirNode<T extends TreeInput> = {
  kind: 'dir';
  /** Nombre que se muestra: el de la carpeta o, si se compactó una cadena, `a/b/c`. */
  name: string;
  /** Ruta completa de la carpeta más profunda de la cadena: es su clave para plegarla. */
  path: string;
  children: TreeNode<T>[];
  /** Líneas añadidas y quitadas de todo lo que contiene. */
  added: number;
  deleted: number;
};
export type TreeNode<T extends TreeInput> = FileNode<T> | DirNode<T>;

export type TreeRow<T extends TreeInput> = { node: TreeNode<T>; depth: number };

type Builder<T extends TreeInput> = { dirs: Map<string, Builder<T>>; files: FileNode<T>[] };

// Orden natural sin distinguir mayúsculas, con la comparación de puntos de código como desempate.
const comparar = (a: string, b: string): number => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Árbol a partir de las rutas: carpetas antes que archivos, ambos por orden
 * alfabético; las cadenas de carpetas con una sola carpeta dentro y ningún archivo
 * se compactan en una fila (`src/lib`); cada carpeta suma las líneas de lo que
 * contiene (null cuenta como 0).
 */
export function buildTree<T extends TreeInput>(files: readonly T[]): TreeNode<T>[] {
  const raiz: Builder<T> = { dirs: new Map(), files: [] };
  for (const f of files) {
    const partes = f.path.split('/');
    let n = raiz;
    for (const dir of partes.slice(0, -1)) {
      let hijo = n.dirs.get(dir);
      if (!hijo) n.dirs.set(dir, (hijo = { dirs: new Map(), files: [] }));
      n = hijo;
    }
    n.files.push({ kind: 'file', name: partes[partes.length - 1]!, path: f.path, file: f });
  }
  const convertir = (b: Builder<T>, prefijo: string): TreeNode<T>[] => {
    const carpetas = [...b.dirs.keys()].sort(comparar).map((nombre): DirNode<T> => {
      let etiqueta = nombre;
      let ruta = prefijo + nombre;
      let d = b.dirs.get(nombre)!;
      while (d.files.length === 0 && d.dirs.size === 1) {
        const [k, hijo] = [...d.dirs][0]!;
        etiqueta += `/${k}`;
        ruta += `/${k}`;
        d = hijo;
      }
      const children = convertir(d, `${ruta}/`);
      let added = 0;
      let deleted = 0;
      for (const c of children) {
        if (c.kind === 'dir') {
          added += c.added;
          deleted += c.deleted;
        } else {
          added += c.file.added ?? 0;
          deleted += c.file.deleted ?? 0;
        }
      }
      return { kind: 'dir', name: etiqueta, path: ruta, children, added, deleted };
    });
    const archivos = [...b.files].sort((x, y) => comparar(x.name, y.name));
    return [...carpetas, ...archivos];
  };
  return convertir(raiz, '');
}

/** Filas visibles en orden (carpetas plegadas sin sus hijos) con su profundidad. */
export function flattenTree<T extends TreeInput>(nodes: readonly TreeNode<T>[], plegadas: ReadonlySet<string>, depth = 0, out: TreeRow<T>[] = []): TreeRow<T>[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.kind === 'dir' && !plegadas.has(node.path)) flattenTree(node.children, plegadas, depth + 1, out);
  }
  return out;
}

/** Claves de todas las carpetas (para «Plegar todo»). */
export function dirPaths<T extends TreeInput>(nodes: readonly TreeNode<T>[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'dir') {
      out.push(n.path);
      dirPaths(n.children, out);
    }
  }
  return out;
}

/** Ruta del primer archivo en el orden del árbol (el que se abre al entrar), o null si no hay archivos. */
export function firstFilePath<T extends TreeInput>(nodes: readonly TreeNode<T>[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'file') return n.path;
    const dentro = firstFilePath(n.children);
    if (dentro !== null) return dentro;
  }
  return null;
}

/** Líneas añadidas y quitadas de toda la lista (null cuenta como 0). */
export function totalLines(files: readonly TreeInput[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const f of files) {
    added += f.added ?? 0;
    deleted += f.deleted ?? 0;
  }
  return { added, deleted };
}

/** Claves de las carpetas que contienen la ruta, de fuera adentro (las que hay que desplegar para verla). */
export function ancestorDirs<T extends TreeInput>(nodes: readonly TreeNode<T>[], path: string): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'dir' && path.startsWith(`${n.path}/`)) out.push(n.path, ...ancestorDirs(n.children, path));
  }
  return out;
}

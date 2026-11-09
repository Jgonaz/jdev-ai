import { describe, expect, it } from 'vitest';
import { ancestorDirs, buildTree, dirPaths, firstFilePath, flattenTree, totalLines } from './fileTree.ts';
import type { TreeNode } from './fileTree.ts';

const f = (path: string, added: number | null = 1, deleted: number | null = 0) => ({ path, added, deleted });

// Forma compacta para comparar: «dir:nombre» / «file:nombre» con sus hijos.
type Forma = string | { [dir: string]: Forma[] };
const forma = (nodes: readonly TreeNode<ReturnType<typeof f>>[]): Forma[] =>
  nodes.map((n) => (n.kind === 'file' ? n.name : { [n.name]: forma(n.children) }));

describe('buildTree', () => {
  it('pone las carpetas antes que los archivos y ordena alfabéticamente', () => {
    const t = buildTree([f('z.md'), f('b/y.ts'), f('a.md'), f('b/x.ts'), f('A/q.ts')]);
    expect(forma(t)).toEqual([{ A: ['q.ts'] }, { b: ['x.ts', 'y.ts'] }, 'a.md', 'z.md']);
  });

  it('ordena los números de forma natural y sin distinguir mayúsculas', () => {
    expect(forma(buildTree([f('f10.ts'), f('f2.ts'), f('B.ts'), f('a.ts')]))).toEqual(['a.ts', 'B.ts', 'f2.ts', 'f10.ts']);
  });

  it('compacta las cadenas de carpetas con una sola carpeta y ningún archivo', () => {
    const t = buildTree([f('src/lib/a.ts'), f('src/lib/b.ts')]);
    expect(forma(t)).toEqual([{ 'src/lib': ['a.ts', 'b.ts'] }]);
    expect(t[0]).toMatchObject({ kind: 'dir', name: 'src/lib', path: 'src/lib' });
    // La cadena larga se compacta entera.
    expect(forma(buildTree([f('a/b/c/d.ts')]))).toEqual([{ 'a/b/c': ['d.ts'] }]);
  });

  it('no compacta si la carpeta tiene archivos propios o varias carpetas', () => {
    expect(forma(buildTree([f('src/a.ts'), f('src/lib/b.ts')]))).toEqual([{ src: [{ lib: ['b.ts'] }, 'a.ts'] }]);
    expect(forma(buildTree([f('src/lib/a.ts'), f('src/ui/b.ts')]))).toEqual([{ src: [{ lib: ['a.ts'] }, { ui: ['b.ts'] }] }]);
  });

  it('una carpeta compactada conserva la ruta completa de la más profunda como clave', () => {
    const t = buildTree([f('x/src/lib/a.ts'), f('x/src/lib/b.ts'), f('x/otra/c.ts')]);
    const x = t[0]!;
    expect(x).toMatchObject({ name: 'x', path: 'x' });
    expect((x as { children: TreeNode<ReturnType<typeof f>>[] }).children.map((c) => [c.name, c.path])).toEqual([
      ['otra', 'x/otra'],
      ['src/lib', 'x/src/lib'],
    ]);
  });

  it('suma las líneas añadidas y quitadas por carpeta, con null como 0', () => {
    const t = buildTree([f('src/a.ts', 5, 2), f('src/lib/b.ts', 3, 1), f('src/lib/img.png', null, null), f('README.md', 7, 7)]);
    const src = t[0]!;
    expect(src).toMatchObject({ kind: 'dir', name: 'src', added: 8, deleted: 3 });
    expect((src as { children: TreeNode<ReturnType<typeof f>>[] }).children[0]).toMatchObject({ name: 'lib', added: 3, deleted: 1 });
  });

  it('sin archivos no hay árbol', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('un archivo con espacios o Unicode conserva su ruta', () => {
    const t = buildTree([f('docs/guía rápida.md')]);
    expect(t[0]).toMatchObject({ name: 'docs', children: [{ kind: 'file', name: 'guía rápida.md', path: 'docs/guía rápida.md' }] });
  });
});

describe('flattenTree', () => {
  const t = buildTree([f('src/lib/a.ts'), f('src/lib/b.ts'), f('src/c.ts'), f('d.ts')]);
  const nombres = (r: ReturnType<typeof flattenTree<ReturnType<typeof f>>>) => r.map((x) => `${x.depth}:${x.node.name}`);

  it('recorre en orden con la profundidad', () => {
    expect(nombres(flattenTree(t, new Set()))).toEqual(['0:src', '1:lib', '2:a.ts', '2:b.ts', '1:c.ts', '0:d.ts']);
  });

  it('una carpeta plegada oculta lo que contiene', () => {
    expect(nombres(flattenTree(t, new Set(['src/lib'])))).toEqual(['0:src', '1:lib', '1:c.ts', '0:d.ts']);
    expect(nombres(flattenTree(t, new Set(['src'])))).toEqual(['0:src', '0:d.ts']);
  });
});

describe('utilidades', () => {
  const t = buildTree([f('src/lib/a.ts', 2, 1), f('docs/n.md', 4, 0), f('r.md', null, null)]);

  it('dirPaths lista las claves de todas las carpetas', () => {
    expect(dirPaths(t)).toEqual(['docs', 'src/lib']);
  });

  it('firstFilePath da el primer archivo en el orden del árbol', () => {
    expect(firstFilePath(t)).toBe('docs/n.md');
    expect(firstFilePath(buildTree([f('b.ts'), f('a.ts')]))).toBe('a.ts');
    expect(firstFilePath([])).toBeNull();
  });

  it('totalLines suma toda la lista', () => {
    expect(totalLines([f('a', 2, 1), f('b', null, null), f('c', 5, 5)])).toEqual({ added: 7, deleted: 6 });
  });

  it('ancestorDirs da las carpetas que hay que desplegar para ver un archivo', () => {
    const u = buildTree([f('a/b/x.ts'), f('a/c.ts'), f('a/b/y/z.ts')]);
    expect(ancestorDirs(u, 'a/b/y/z.ts')).toEqual(['a', 'a/b', 'a/b/y']);
    expect(ancestorDirs(u, 'a/c.ts')).toEqual(['a']);
    expect(ancestorDirs(u, 'otro.ts')).toEqual([]);
  });
});

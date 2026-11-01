import { describe, expect, it } from 'vitest';
import { canonicalProjectHref, historyHref, parseRoute, projectHref, resolveRoute } from './route.ts';

const base = { project: null, item: null, soon: null, normalize: false };

describe('resolveRoute', () => {
  it('conserva las rutas canónicas', () => {
    expect(resolveRoute('#/terminales')).toEqual({ ...base, route: 'terminales' });
    expect(resolveRoute('#/ajustes')).toEqual({ ...base, route: 'ajustes' });
    expect(resolveRoute('')).toEqual({ ...base, route: 'terminales' });
  });

  it('reconoce Proyectos con proyecto y elemento opcionales', () => {
    expect(resolveRoute('#/proyectos')).toEqual({ ...base, route: 'proyectos' });
    expect(resolveRoute('#/proyectos/balanz.io')).toEqual({ ...base, route: 'proyectos', project: 'balanz.io' });
    expect(resolveRoute('#/proyectos/balanz.io/BL-20261024-1145-typescript-7')).toEqual({
      ...base,
      route: 'proyectos',
      project: 'balanz.io',
      item: 'BL-20261024-1145-typescript-7',
    });
    expect(resolveRoute('#/proyectos/a%20b')).toEqual({ ...base, route: 'proyectos', project: 'a b' });
    // Codificación rota: se ignora el proyecto en lugar de fallar.
    expect(resolveRoute('#/proyectos/%E0%A4%A')).toEqual({ ...base, route: 'proyectos' });
  });

  it('reconoce Historial con una entrada opcional', () => {
    expect(resolveRoute('#/historial')).toEqual({ ...base, route: 'historial' });
    expect(resolveRoute('#/historial/')).toEqual({ ...base, route: 'historial' });
    expect(resolveRoute('#/historial/balanz.io/2026-10-31-0027-a%20b.md')).toEqual({
      ...base,
      route: 'historial',
      project: 'balanz.io',
      item: '2026-10-31-0027-a b.md',
    });
    // Sin archivo, o con codificación rota, se muestra la lista sola.
    expect(resolveRoute('#/historial/balanz.io')).toEqual({ ...base, route: 'historial' });
    expect(resolveRoute('#/historial/a/%E0%A4%A')).toEqual({ ...base, route: 'historial' });
    expect(resolveRoute('#/historial/a/b/c')).toEqual({ ...base, route: 'terminales', normalize: true });
  });

  it('historyHref codifica proyecto y archivo', () => {
    expect(historyHref()).toBe('#/historial');
    expect(historyHref('jdev-ai')).toBe('#/historial');
    expect(historyHref('a b', 'x y.md')).toBe('#/historial/a%20b/x%20y.md');
  });

  it('normaliza las secciones futuras y avisa de cuál era', () => {
    expect(resolveRoute('#/inicio')).toEqual({ ...base, route: 'terminales', soon: 'Inicio', normalize: true });
  });

  it('normaliza las rutas desconocidas sin aviso', () => {
    expect(resolveRoute('#/nada')).toEqual({ ...base, route: 'terminales', normalize: true });
    expect(resolveRoute('#/proyectos/a/b/c')).toEqual({ ...base, route: 'terminales', normalize: true });
  });

  it('parseRoute devuelve solo la pantalla', () => {
    expect(parseRoute('#/ajustes')).toBe('ajustes');
    expect(parseRoute('#/proyectos/x')).toBe('proyectos');
  });

  it('canonicalProjectHref corrige el proyecto y quita el elemento que no se muestra', () => {
    // Ya canónico.
    expect(canonicalProjectHref({ project: 'a', item: null }, 'a', true)).toBeNull();
    expect(canonicalProjectHref({ project: 'a', item: 'BL-1' }, 'a', true)).toBeNull();
    // Sin proyecto, inexistente u oculto: el mostrado, sin elemento.
    expect(canonicalProjectHref({ project: null, item: null }, 'a', true)).toBe('#/proyectos/a');
    expect(canonicalProjectHref({ project: 'oculto', item: 'BL-1' }, 'a', true)).toBe('#/proyectos/a');
    // Pestaña Worktrees o Guías, o elemento inexistente: se quita el elemento.
    expect(canonicalProjectHref({ project: 'a', item: 'BL-1' }, 'a', false)).toBe('#/proyectos/a');
    expect(canonicalProjectHref({ project: 'a', item: null }, 'a', false)).toBeNull();
    expect(canonicalProjectHref({ project: 'a b', item: null }, 'a b', true)).toBeNull();
  });

  it('projectHref codifica proyecto y elemento', () => {
    expect(projectHref()).toBe('#/proyectos');
    expect(projectHref('a b')).toBe('#/proyectos/a%20b');
    expect(projectHref('balanz.io', 'BL-1')).toBe('#/proyectos/balanz.io/BL-1');
  });
});

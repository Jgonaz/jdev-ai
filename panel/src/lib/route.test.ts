import { describe, expect, it } from 'vitest';
import { canonicalProjectHref, historyHref, isProjectScreen, parseRoute, projectHref, resolveRoute, routeHref } from './route.ts';

const base = { project: null, item: null, implicit: false, normalize: false, redirect: null };

describe('resolveRoute', () => {
  it('conserva las rutas canónicas', () => {
    expect(resolveRoute('#/terminales')).toEqual({ ...base, route: 'terminales' });
    expect(resolveRoute('#/ajustes')).toEqual({ ...base, route: 'ajustes' });
    expect(resolveRoute('#/inicio')).toEqual({ ...base, route: 'inicio' });
  });

  it('sin ruta muestra la pantalla al abrir', () => {
    expect(resolveRoute('')).toEqual({ ...base, route: 'inicio', implicit: true });
    expect(resolveRoute('#/')).toEqual({ ...base, route: 'inicio', implicit: true });
    expect(resolveRoute('', 'terminales')).toEqual({ ...base, route: 'terminales', implicit: true });
    // Una ruta explícita manda sobre el ajuste.
    expect(resolveRoute('#/inicio', 'terminales').route).toBe('inicio');
  });

  it('reconoce Backlog con proyecto y elemento opcionales', () => {
    expect(resolveRoute('#/backlog')).toEqual({ ...base, route: 'backlog' });
    expect(resolveRoute('#/backlog/balanz.io')).toEqual({ ...base, route: 'backlog', project: 'balanz.io' });
    expect(resolveRoute('#/backlog/balanz.io/BL-20261024-1145-typescript-7')).toEqual({
      ...base,
      route: 'backlog',
      project: 'balanz.io',
      item: 'BL-20261024-1145-typescript-7',
    });
    expect(resolveRoute('#/backlog/a%20b')).toEqual({ ...base, route: 'backlog', project: 'a b' });
    // Codificación rota: se ignora el proyecto en lugar de fallar.
    expect(resolveRoute('#/backlog/%E0%A4%A')).toEqual({ ...base, route: 'backlog' });
    // Un elemento con formato imposible (o mal codificado) se quita de la URL.
    for (const h of ['#/backlog/balanz.io/nope', '#/backlog/balanz.io/BL-1', '#/backlog/balanz.io/%E0%A4%A']) {
      expect(resolveRoute(h), h).toEqual({ ...base, route: 'backlog', project: 'balanz.io', redirect: '#/backlog/balanz.io' });
    }
    expect(resolveRoute('#/backlog/a/b/c')).toEqual({ ...base, route: 'inicio', implicit: true, normalize: true });
  });

  it('reconoce Worktrees con proyecto opcional y sin elemento', () => {
    expect(resolveRoute('#/worktrees')).toEqual({ ...base, route: 'worktrees' });
    expect(resolveRoute('#/worktrees/balanz.io')).toEqual({ ...base, route: 'worktrees', project: 'balanz.io' });
    expect(resolveRoute('#/worktrees/a%20b')).toEqual({ ...base, route: 'worktrees', project: 'a b' });
    expect(resolveRoute('#/worktrees/a/b')).toEqual({ ...base, route: 'inicio', implicit: true, normalize: true });
  });

  it('reconoce Guías con proyecto y ruta de guía opcionales (la ruta puede tener subcarpetas)', () => {
    expect(resolveRoute('#/guias')).toEqual({ ...base, route: 'guias' });
    expect(resolveRoute('#/guias/balanz.io')).toEqual({ ...base, route: 'guias', project: 'balanz.io' });
    expect(resolveRoute('#/guias/balanz.io/panel.md')).toEqual({ ...base, route: 'guias', project: 'balanz.io', item: 'panel.md' });
    expect(resolveRoute('#/guias/balanz.io/a%20b/c%20d.md')).toEqual({ ...base, route: 'guias', project: 'balanz.io', item: 'a b/c d.md' });
    // Una guía sin nombre o con codificación rota se quita de la URL.
    for (const h of ['#/guias/balanz.io/', '#/guias/balanz.io/%E0%A4%A', '#/guias/balanz.io/zzz%ZZ']) {
      expect(resolveRoute(h), h).toEqual({ ...base, route: 'guias', project: 'balanz.io', redirect: '#/guias/balanz.io' });
    }
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
    expect(resolveRoute('#/historial/a/b/c')).toEqual({ ...base, route: 'inicio', implicit: true, normalize: true });
  });

  it('historyHref codifica proyecto y archivo', () => {
    expect(historyHref()).toBe('#/historial');
    expect(historyHref('jdev-ai')).toBe('#/historial');
    expect(historyHref('a b', 'x y.md')).toBe('#/historial/a%20b/x%20y.md');
  });

  it('normaliza las rutas desconocidas a la pantalla al abrir', () => {
    expect(resolveRoute('#/nada')).toEqual({ ...base, route: 'inicio', implicit: true, normalize: true });
    expect(resolveRoute('#/proyectos/a/b/c/d', 'terminales')).toEqual({ ...base, route: 'terminales', implicit: true, normalize: true });
  });

  it('parseRoute devuelve solo la pantalla', () => {
    expect(parseRoute('#/ajustes')).toBe('ajustes');
    expect(parseRoute('#/backlog/x')).toBe('backlog');
    expect(parseRoute('#/worktrees/x')).toBe('worktrees');
    expect(parseRoute('#/guias/x')).toBe('guias');
  });

  it('traduce las rutas antiguas de Proyectos a las de cada pantalla', () => {
    const ruta = (hash: string) => {
      const r = resolveRoute(hash);
      return [r.route, r.project, r.item, r.redirect];
    };
    expect(ruta('#/proyectos')).toEqual(['backlog', null, null, '#/backlog']);
    expect(ruta('#/proyectos/balanz.io')).toEqual(['backlog', 'balanz.io', null, '#/backlog/balanz.io']);
    expect(ruta('#/proyectos/balanz.io/BL-1')).toEqual(['backlog', 'balanz.io', 'BL-1', '#/backlog/balanz.io/BL-1']);
    expect(ruta('#/proyectos/a%20b/backlog')).toEqual(['backlog', 'a b', null, '#/backlog/a%20b']);
    expect(ruta('#/proyectos/balanz.io/worktrees')).toEqual(['worktrees', 'balanz.io', null, '#/worktrees/balanz.io']);
    expect(ruta('#/proyectos/balanz.io/guias')).toEqual(['guias', 'balanz.io', null, '#/guias/balanz.io']);
    // Un identificador del backlog nunca se confunde con una pestaña, ni al revés.
    expect(ruta('#/proyectos/x/BL-20261024-1145-worktrees')).toEqual(['backlog', 'x', 'BL-20261024-1145-worktrees', '#/backlog/x/BL-20261024-1145-worktrees']);
    expect(ruta('#/proyectos/x/Worktrees')).toEqual(['backlog', 'x', 'Worktrees', '#/backlog/x/Worktrees']);
    // Pestaña y elemento no se combinaban: sigue siendo una ruta rota.
    expect(resolveRoute('#/proyectos/x/guias/BL-1')).toEqual({ ...base, route: 'inicio', implicit: true, normalize: true });
  });

  it('las rutas nuevas no se redirigen', () => {
    for (const h of ['#/backlog/x/BL-20261024-1145-typescript-7', '#/worktrees/x', '#/guias/x/a.md', '#/historial/x/y.md', '#/inicio', '']) {
      expect(resolveRoute(h).redirect).toBeNull();
    }
  });

  it('isProjectScreen distingue las tres pantallas de proyecto', () => {
    expect(['backlog', 'worktrees', 'guias'].every(isProjectScreen)).toBe(true);
    expect(['inicio', 'terminales', 'historial', 'ajustes', 'proyectos', null].some(isProjectScreen)).toBe(false);
    expect(routeHref('worktrees')).toBe('#/worktrees');
  });

  it('canonicalProjectHref corrige el proyecto y quita el elemento que no se muestra', () => {
    // La ruta ya es canónica.
    expect(canonicalProjectHref('backlog', { project: 'a', item: null }, 'a')).toBeNull();
    expect(canonicalProjectHref('backlog', { project: 'a', item: 'BL-1' }, 'a')).toBeNull();
    expect(canonicalProjectHref('guias', { project: 'a', item: 'x/y.md' }, 'a')).toBeNull();
    expect(canonicalProjectHref('worktrees', { project: 'a', item: null }, 'a')).toBeNull();
    // Sin proyecto, o con uno oculto o inexistente: el mostrado, sin elemento.
    expect(canonicalProjectHref('backlog', { project: null, item: null }, 'a')).toBe('#/backlog/a');
    expect(canonicalProjectHref('worktrees', { project: null, item: null }, 'a')).toBe('#/worktrees/a');
    expect(canonicalProjectHref('guias', { project: 'oculto', item: 'x.md' }, 'a')).toBe('#/guias/a');
    expect(canonicalProjectHref('backlog', { project: 'oculto', item: 'BL-1' }, 'a')).toBe('#/backlog/a');
    // Un elemento que no existe (withItem falso) se quita; sin elemento no hay nada que quitar.
    expect(canonicalProjectHref('backlog', { project: 'a', item: 'BL-1' }, 'a', false)).toBe('#/backlog/a');
    expect(canonicalProjectHref('backlog', { project: 'a', item: null }, 'a', false)).toBeNull();
    // Worktrees no lleva elemento.
    expect(canonicalProjectHref('worktrees', { project: 'a', item: 'BL-1' }, 'a')).toBe('#/worktrees/a');
    expect(canonicalProjectHref('backlog', { project: 'a b', item: null }, 'a b')).toBeNull();
  });

  it('projectHref escribe la ruta de cada pantalla y codifica proyecto y elemento', () => {
    expect(projectHref('backlog')).toBe('#/backlog');
    expect(projectHref('worktrees', null)).toBe('#/worktrees');
    expect(projectHref('guias', null, 'a.md')).toBe('#/guias');
    expect(projectHref('backlog', 'a b')).toBe('#/backlog/a%20b');
    expect(projectHref('backlog', 'balanz.io', 'BL-1')).toBe('#/backlog/balanz.io/BL-1');
    expect(projectHref('worktrees', 'a b')).toBe('#/worktrees/a%20b');
    expect(projectHref('worktrees', 'a', 'BL-1')).toBe('#/worktrees/a');
    expect(projectHref('guias', 'a')).toBe('#/guias/a');
    // La guía conserva las barras y codifica cada tramo.
    expect(projectHref('guias', 'a', 'sub carpeta/guía.md')).toBe('#/guias/a/sub%20carpeta/gu%C3%ADa.md');
  });

  it('projectHref y resolveRoute son inversos para la guía y el elemento', () => {
    const g = resolveRoute(projectHref('guias', 'a b', 'x y/z #1.md'));
    expect([g.route, g.project, g.item]).toEqual(['guias', 'a b', 'x y/z #1.md']);
    const b = resolveRoute(projectHref('backlog', 'a b', 'BL-20261024-1145-typescript-7'));
    expect([b.route, b.project, b.item]).toEqual(['backlog', 'a b', 'BL-20261024-1145-typescript-7']);
  });
});

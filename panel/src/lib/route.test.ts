import { describe, expect, it } from 'vitest';
import { cambiosItem, canonicalProjectHref, historyHref, isProjectScreen, parseCambiosItem, parseRoute, projectHref, resolveRoute, routeHref } from './route.ts';

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

  it('reconoce Cambios con proyecto, lugar y archivo opcionales (el archivo puede tener subcarpetas)', () => {
    expect(resolveRoute('#/cambios')).toEqual({ ...base, route: 'cambios' });
    expect(resolveRoute('#/cambios/balanz.io')).toEqual({ ...base, route: 'cambios', project: 'balanz.io' });
    expect(resolveRoute('#/cambios/a%20b')).toEqual({ ...base, route: 'cambios', project: 'a b' });
    expect(resolveRoute('#/cambios/balanz.io/main')).toEqual({ ...base, route: 'cambios', project: 'balanz.io', item: 'main' });
    expect(resolveRoute('#/cambios/balanz.io/main/src/a%20b.ts')).toEqual({ ...base, route: 'cambios', project: 'balanz.io', item: 'main/src/a b.ts' });
    expect(resolveRoute('#/cambios/balanz.io/wt/typescript-7')).toEqual({ ...base, route: 'cambios', project: 'balanz.io', item: 'wt/typescript-7' });
    expect(resolveRoute('#/cambios/balanz.io/wt/ts-7/src/lib/a%20b.ts')).toEqual({ ...base, route: 'cambios', project: 'balanz.io', item: 'wt/ts-7/src/lib/a b.ts' });
    // Un lugar sin forma de `main…` o `wt/<worktree>…`, o mal codificado, se quita de la URL.
    for (const h of ['#/cambios/a/typescript-7', '#/cambios/a/wt', '#/cambios/a/wt/', '#/cambios/a/%E0%A4%A', '#/cambios/a/wt/x/%E0%A4%A']) {
      expect(resolveRoute(h), h).toEqual({ ...base, route: 'cambios', project: 'a', redirect: '#/cambios/a' });
    }
  });

  it('redirige las rutas antiguas de Worktrees a Cambios', () => {
    const ruta = (h: string) => {
      const r = resolveRoute(h);
      return [r.route, r.redirect];
    };
    expect(ruta('#/worktrees')).toEqual(['cambios', '#/cambios']);
    expect(ruta('#/worktrees/balanz.io')).toEqual(['cambios', '#/cambios/balanz.io']);
    expect(ruta('#/worktrees/a%20b')).toEqual(['cambios', '#/cambios/a%20b']);
    expect(ruta('#/worktrees/balanz.io/typescript-7')).toEqual(['cambios', '#/cambios/balanz.io/wt/typescript-7']);
    expect(ruta('#/worktrees/balanz.io/ts-7/src/lib/a%20b.ts')).toEqual(['cambios', '#/cambios/balanz.io/wt/ts-7/src/lib/a%20b.ts']);
    expect(ruta('#/worktrees/a/%E0%A4%A')).toEqual(['cambios', '#/cambios/a']);
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
    expect(parseRoute('#/cambios/x')).toBe('cambios');
    expect(parseRoute('#/worktrees/x')).toBe('cambios');
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
    expect(ruta('#/proyectos/balanz.io/worktrees')).toEqual(['cambios', 'balanz.io', null, '#/cambios/balanz.io']);
    expect(ruta('#/proyectos/balanz.io/guias')).toEqual(['guias', 'balanz.io', null, '#/guias/balanz.io']);
    // Un identificador del backlog nunca se confunde con una pestaña, ni al revés.
    expect(ruta('#/proyectos/x/BL-20261024-1145-worktrees')).toEqual(['backlog', 'x', 'BL-20261024-1145-worktrees', '#/backlog/x/BL-20261024-1145-worktrees']);
    expect(ruta('#/proyectos/x/Worktrees')).toEqual(['backlog', 'x', 'Worktrees', '#/backlog/x/Worktrees']);
    // Pestaña y elemento no se combinaban: sigue siendo una ruta rota.
    expect(resolveRoute('#/proyectos/x/guias/BL-1')).toEqual({ ...base, route: 'inicio', implicit: true, normalize: true });
  });

  it('las rutas nuevas no se redirigen', () => {
    for (const h of ['#/backlog/x/BL-20261024-1145-typescript-7', '#/cambios/x', '#/cambios/x/wt/y/a.ts', '#/guias/x/a.md', '#/historial/x/y.md', '#/inicio', '']) {
      expect(resolveRoute(h).redirect).toBeNull();
    }
  });

  it('isProjectScreen distingue las tres pantallas de proyecto', () => {
    expect(['backlog', 'cambios', 'guias'].every(isProjectScreen)).toBe(true);
    expect(['inicio', 'terminales', 'historial', 'ajustes', 'proyectos', null].some(isProjectScreen)).toBe(false);
    expect(routeHref('cambios')).toBe('#/cambios');
    expect(isProjectScreen('worktrees')).toBe(false);
  });

  it('canonicalProjectHref corrige el proyecto y quita el elemento que no se muestra', () => {
    // La ruta ya es canónica.
    expect(canonicalProjectHref('backlog', { project: 'a', item: null }, 'a')).toBeNull();
    expect(canonicalProjectHref('backlog', { project: 'a', item: 'BL-1' }, 'a')).toBeNull();
    expect(canonicalProjectHref('guias', { project: 'a', item: 'x/y.md' }, 'a')).toBeNull();
    expect(canonicalProjectHref('cambios', { project: 'a', item: null }, 'a')).toBeNull();
    // Sin proyecto, o con uno oculto o inexistente: el mostrado, sin elemento.
    expect(canonicalProjectHref('backlog', { project: null, item: null }, 'a')).toBe('#/backlog/a');
    expect(canonicalProjectHref('cambios', { project: null, item: null }, 'a')).toBe('#/cambios/a');
    expect(canonicalProjectHref('guias', { project: 'oculto', item: 'x.md' }, 'a')).toBe('#/guias/a');
    expect(canonicalProjectHref('backlog', { project: 'oculto', item: 'BL-1' }, 'a')).toBe('#/backlog/a');
    // Un elemento que no existe (withItem falso) se quita; sin elemento no hay nada que quitar.
    expect(canonicalProjectHref('backlog', { project: 'a', item: 'BL-1' }, 'a', false)).toBe('#/backlog/a');
    expect(canonicalProjectHref('backlog', { project: 'a', item: null }, 'a', false)).toBeNull();
    // Cambios lleva el lugar y el archivo, y los conserva mientras existan.
    expect(canonicalProjectHref('cambios', { project: 'a', item: 'wt/ts/src/a.ts' }, 'a')).toBeNull();
    expect(canonicalProjectHref('cambios', { project: 'a', item: 'wt/ts/src/a.ts' }, 'a', false)).toBe('#/cambios/a');
    expect(canonicalProjectHref('cambios', { project: 'oculto', item: 'main/a.ts' }, 'a')).toBe('#/cambios/a');
    expect(canonicalProjectHref('backlog', { project: 'a b', item: null }, 'a b')).toBeNull();
  });

  it('projectHref escribe la ruta de cada pantalla y codifica proyecto y elemento', () => {
    expect(projectHref('backlog')).toBe('#/backlog');
    expect(projectHref('cambios', null)).toBe('#/cambios');
    expect(projectHref('guias', null, 'a.md')).toBe('#/guias');
    expect(projectHref('backlog', 'a b')).toBe('#/backlog/a%20b');
    expect(projectHref('backlog', 'balanz.io', 'BL-1')).toBe('#/backlog/balanz.io/BL-1');
    expect(projectHref('cambios', 'a b')).toBe('#/cambios/a%20b');
    expect(projectHref('cambios', 'a', 'wt/ts 7')).toBe('#/cambios/a/wt/ts%207');
    expect(projectHref('cambios', 'a', 'wt/ts-7/src/a b/c#.ts')).toBe('#/cambios/a/wt/ts-7/src/a%20b/c%23.ts');
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

describe('elemento de Cambios', () => {
  it('separa el lugar del archivo', () => {
    expect(parseCambiosItem(null)).toEqual({ place: { kind: 'main' }, file: null });
    expect(parseCambiosItem('main')).toEqual({ place: { kind: 'main' }, file: null });
    expect(parseCambiosItem('main/src/a.ts')).toEqual({ place: { kind: 'main' }, file: 'src/a.ts' });
    expect(parseCambiosItem('wt/ts-7')).toEqual({ place: { kind: 'wt', name: 'ts-7' }, file: null });
    expect(parseCambiosItem('wt/ts-7/src/a.ts')).toEqual({ place: { kind: 'wt', name: 'ts-7' }, file: 'src/a.ts' });
    // Un worktree que se llama como una carpeta (o como `main`) no se confunde con ella.
    expect(parseCambiosItem('wt/main/src/a.ts')).toEqual({ place: { kind: 'wt', name: 'main' }, file: 'src/a.ts' });
    expect(parseCambiosItem('wt/src')).toEqual({ place: { kind: 'wt', name: 'src' }, file: null });
    for (const malo of ['ts-7', 'wt', 'wt/', 'src/a.ts', 'mainx']) expect(parseCambiosItem(malo), malo).toBeNull();
  });

  it('los vuelve a unir; el checkout principal sin archivo es la ruta sin elemento', () => {
    expect(cambiosItem({ kind: 'main' })).toBeNull();
    expect(cambiosItem({ kind: 'main' }, 'src/a.ts')).toBe('main/src/a.ts');
    expect(cambiosItem({ kind: 'wt', name: 'ts-7' })).toBe('wt/ts-7');
    expect(cambiosItem({ kind: 'wt', name: 'ts-7' }, 'src/a.ts')).toBe('wt/ts-7/src/a.ts');
  });
});

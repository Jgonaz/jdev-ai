import { describe, expect, it } from 'vitest';
import { parseRoute, resolveRoute } from './route.ts';

describe('resolveRoute', () => {
  it('conserva las rutas canónicas', () => {
    expect(resolveRoute('#/terminales')).toEqual({ route: 'terminales', soon: null, normalize: false });
    expect(resolveRoute('#/ajustes')).toEqual({ route: 'ajustes', soon: null, normalize: false });
    expect(resolveRoute('')).toEqual({ route: 'terminales', soon: null, normalize: false });
  });

  it('normaliza las secciones futuras y avisa de cuál era', () => {
    expect(resolveRoute('#/proyectos')).toEqual({ route: 'terminales', soon: 'Proyectos', normalize: true });
    expect(resolveRoute('#/historial')).toEqual({ route: 'terminales', soon: 'Historial', normalize: true });
    expect(resolveRoute('#/inicio')).toEqual({ route: 'terminales', soon: 'Inicio', normalize: true });
  });

  it('normaliza las rutas desconocidas sin aviso', () => {
    expect(resolveRoute('#/nada')).toEqual({ route: 'terminales', soon: null, normalize: true });
    expect(resolveRoute('#/constructor')).toEqual({ route: 'terminales', soon: null, normalize: true });
  });

  it('parseRoute devuelve solo la pantalla', () => {
    expect(parseRoute('#/ajustes')).toBe('ajustes');
    expect(parseRoute('#/proyectos')).toBe('terminales');
  });
});

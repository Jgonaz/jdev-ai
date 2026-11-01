import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings-schema.ts';
import { applyPatch, mergePatches } from './settingsPatch.ts';

describe('applyPatch', () => {
  it('fusiona en profundidad sin mutar la base', () => {
    const r = applyPatch(DEFAULT_SETTINGS, { theme: { accent: 'menta' }, port: 5000 });
    expect(r.theme).toEqual({ name: 'grafito', followSystem: false, accent: 'menta' });
    expect(r.port).toBe(5000);
    expect(DEFAULT_SETTINGS.theme.accent).toBe('ambar');
  });

  it('overrides de proyecto: crea, actualiza y borra con null', () => {
    let s = applyPatch(DEFAULT_SETTINGS, { projects: { 'balanz.io': { mono: 'BZ', visible: false } } });
    expect(s.projects).toEqual({ 'balanz.io': { mono: 'BZ', visible: false } });
    s = applyPatch(s, { projects: { 'balanz.io': { mono: null } } });
    expect(s.projects).toEqual({ 'balanz.io': { visible: false } });
    s = applyPatch(s, { projects: { 'balanz.io': null } });
    expect(s.projects).toEqual({});
  });

  it('ignora claves peligrosas', () => {
    const r = applyPatch(DEFAULT_SETTINGS, JSON.parse('{"projects":{"__proto__":{"mono":"x"}}}'));
    expect(({} as Record<string, unknown>).mono).toBeUndefined();
    expect(Object.keys(r.projects)).toEqual([]);
  });
});

describe('mergePatches', () => {
  it('acumula cambios pendientes: el último gana y los grupos se combinan', () => {
    const r = mergePatches({ theme: { accent: 'menta' }, port: 5000 }, { theme: { name: 'papel' }, port: 5001 });
    expect(r).toEqual({ theme: { accent: 'menta', name: 'papel' }, port: 5001 });
  });

  it('conserva null para borrar overrides', () => {
    expect(mergePatches({ projects: { a: { mono: 'AB' } } }, { projects: { a: null } })).toEqual({ projects: { a: null } });
  });
});

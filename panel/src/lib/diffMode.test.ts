// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { DIFF_MODE_KEY, loadDiffMode, saveDiffMode } from './diffMode.ts';

describe('formato del diff recordado', () => {
  beforeEach(() => localStorage.clear());

  it('por defecto es lado a lado', () => {
    expect(loadDiffMode()).toBe('split');
  });

  it('recuerda la elección', () => {
    saveDiffMode('unified');
    expect(localStorage.getItem(DIFF_MODE_KEY)).toBe('unified');
    expect(loadDiffMode()).toBe('unified');
    saveDiffMode('split');
    expect(loadDiffMode()).toBe('split');
  });

  it('ignora un valor desconocido', () => {
    localStorage.setItem(DIFF_MODE_KEY, 'otro');
    expect(loadDiffMode()).toBe('split');
  });

  it('sigue funcionando si el almacenamiento lanza o no existe', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('lleno');
      },
    };
    expect(loadDiffMode(roto)).toBe('split');
    expect(() => saveDiffMode('unified', roto)).not.toThrow();
    expect(loadDiffMode(null)).toBe('split');
    expect(() => saveDiffMode('unified', null)).not.toThrow();
  });
});

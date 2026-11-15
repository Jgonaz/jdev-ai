import { describe, expect, it } from 'vitest';
import { isDesktop } from './desktop.ts';

describe('isDesktop', () => {
  it('es la app de escritorio si Tauri inyectó sus internals', () => {
    expect(isDesktop({ __TAURI_INTERNALS__: {} })).toBe(true);
  });

  it('en un navegador (o sin ventana) no lo es', () => {
    expect(isDesktop({})).toBe(false);
    expect(isDesktop(undefined)).toBe(false);
  });
});

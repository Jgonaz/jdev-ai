import { describe, expect, it } from 'vitest';
import { matchShortcut } from './useShortcuts.ts';

const tecla = (key: string, extra: Partial<Parameters<typeof matchShortcut>[0]> = {}) => ({
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  key,
  ...extra,
});

describe('matchShortcut', () => {
  it('reconoce los atajos con Ctrl+Alt', () => {
    expect(matchShortcut(tecla('ArrowLeft'))).toBe('prev');
    expect(matchShortcut(tecla('ArrowRight'))).toBe('next');
    expect(matchShortcut(tecla('n'))).toBe('newSession');
    expect(matchShortcut(tecla('L'))).toBe('cycleLayout');
  });

  it('Ctrl+Alt+Escape saca el foco de la terminal hacia la pestaña activa', () => {
    expect(matchShortcut(tecla('Escape'))).toBe('focusTabs');
  });

  it('ignora Escape sin Ctrl+Alt y las combinaciones con Mayús o Meta', () => {
    expect(matchShortcut(tecla('Escape', { ctrlKey: false }))).toBeNull();
    expect(matchShortcut(tecla('Escape', { shiftKey: true }))).toBeNull();
    expect(matchShortcut(tecla('n', { metaKey: true }))).toBeNull();
  });
});

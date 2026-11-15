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

  it('Ctrl+Alt+W no es un atajo: la «x» y el clic central cierran las pestañas', () => {
    expect(matchShortcut(tecla('w'))).toBeNull();
  });

  it('Ctrl+Alt+Escape saca el foco de la terminal hacia la pestaña activa', () => {
    expect(matchShortcut(tecla('Escape'))).toBe('focusTabs');
  });

  it('Ctrl+Alt+T vuelve a la última sesión en segundo plano, en el navegador y en el escritorio', () => {
    expect(matchShortcut(tecla('t'))).toBe('lastBackground');
    expect(matchShortcut(tecla('T'), true)).toBe('lastBackground');
  });

  it('ignora Escape sin Ctrl+Alt y las combinaciones con Mayús o Meta', () => {
    expect(matchShortcut(tecla('Escape', { ctrlKey: false }))).toBeNull();
    expect(matchShortcut(tecla('Escape', { shiftKey: true }))).toBeNull();
    expect(matchShortcut(tecla('n', { metaKey: true }))).toBeNull();
  });
});

describe('matchShortcut en la app de escritorio', () => {
  const ctrl = (key: string, extra: Partial<Parameters<typeof matchShortcut>[0]> = {}) => tecla(key, { altKey: false, ...extra });

  it('Ctrl+Tab y Ctrl+Mayús+Tab cambian de terminal', () => {
    expect(matchShortcut(ctrl('Tab'), true)).toBe('next');
    expect(matchShortcut(ctrl('Tab', { shiftKey: true }), true)).toBe('prev');
  });

  it('Ctrl+W cierra la pestaña, Ctrl+N abre el diálogo y Ctrl+T crea la sesión rápida', () => {
    expect(matchShortcut(ctrl('w'), true)).toBe('closeTab');
    expect(matchShortcut(ctrl('W'), true)).toBe('closeTab');
    expect(matchShortcut(ctrl('n'), true)).toBe('newSession');
    expect(matchShortcut(ctrl('t'), true)).toBe('quickSession');
  });

  it('en el navegador no se activan (Chrome no deja capturarlos)', () => {
    for (const k of ['Tab', 'w', 'n', 't']) expect(matchShortcut(ctrl(k))).toBeNull();
    expect(matchShortcut(ctrl('Tab', { shiftKey: true }), false)).toBeNull();
  });

  it('los Ctrl+Alt de siempre siguen funcionando en el escritorio', () => {
    expect(matchShortcut(tecla('ArrowLeft'), true)).toBe('prev');
    expect(matchShortcut(tecla('n'), true)).toBe('newSession');
    expect(matchShortcut(tecla('w'), true)).toBeNull();
  });

  it('no toca las combinaciones del navegador con Mayús (Ctrl+Mayús+T/N/W), ni con Meta, ni sin Ctrl', () => {
    for (const k of ['w', 'n', 't']) {
      expect(matchShortcut(ctrl(k, { shiftKey: true }), true)).toBeNull();
      expect(matchShortcut(ctrl(k, { metaKey: true }), true)).toBeNull();
      expect(matchShortcut(ctrl(k, { ctrlKey: false }), true)).toBeNull();
    }
    expect(matchShortcut(ctrl('Tab', { ctrlKey: false }), true)).toBeNull();
  });
});

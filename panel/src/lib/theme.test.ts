// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings-schema.ts';
import { THEMES } from '../../shared/settings-schema.ts';
import { THEME_CARDS, THEME_SCHEME, appearanceAttrs, applyAppearance, resolveTheme } from './theme.ts';
import { matchShortcut } from './useShortcuts.ts';

describe('resolveTheme', () => {
  it('sin seguir el sistema manda el tema elegido', () => {
    expect(resolveTheme({ name: 'fosforo', followSystem: false, accent: 'ambar' }, true)).toBe('fosforo');
  });
  it('siguiendo el sistema: Papel de día y el elegido de noche', () => {
    const t = { name: 'contraste', followSystem: true, accent: 'ambar' } as const;
    expect(resolveTheme(t, true)).toBe('papel');
    expect(resolveTheme(t, false)).toBe('contraste');
  });
});

describe('temas', () => {
  it('Carbón es el tema por defecto y los seis temas tienen esquema y tarjeta en Ajustes', () => {
    expect(DEFAULT_SETTINGS.theme.name).toBe('carbon');
    expect([...THEMES].sort()).toEqual(['carbon', 'contraste', 'fosforo', 'grafito', 'papel', 'pizarra']);
    for (const t of THEMES) {
      expect(THEME_SCHEME[t], t).toMatch(/^(dark|light)$/);
      expect(THEME_CARDS.filter((c) => c.id === t), t).toHaveLength(1);
    }
    expect(THEME_CARDS.find((c) => c.id === 'carbon')!.hint).toContain('por defecto');
    expect(THEME_CARDS.find((c) => c.id === 'grafito')!.hint).not.toContain('por defecto');
  });
});

describe('appearanceAttrs / applyAppearance', () => {
  it('Papel es esquema claro y los demás oscuro', () => {
    const papel = { ...DEFAULT_SETTINGS, theme: { ...DEFAULT_SETTINGS.theme, name: 'papel' as const } };
    expect(appearanceAttrs(papel, false)['data-scheme']).toBe('light');
    expect(appearanceAttrs(DEFAULT_SETTINGS, false)['data-scheme']).toBe('dark');
  });

  it('escribe atributos y variables en el elemento raíz', () => {
    const s = {
      ...DEFAULT_SETTINGS,
      theme: { name: 'fosforo' as const, followSystem: false, accent: 'coral' as const },
      personality: { ...DEFAULT_SETTINGS.personality, lights: false },
      sizes: { ...DEFAULT_SETTINGS.sizes, ui: 16, terminal: 13.5 },
    };
    applyAppearance(document.documentElement, s, false);
    const raiz = document.documentElement;
    expect(raiz.getAttribute('data-theme')).toBe('fosforo');
    expect(raiz.getAttribute('data-accent')).toBe('coral');
    expect(raiz.getAttribute('data-lights')).toBe('off');
    expect(raiz.getAttribute('data-cursor')).toBe('on');
    expect(raiz.style.getPropertyValue('--fs-ui')).toBe('16');
    expect(raiz.style.getPropertyValue('--fs-term')).toBe('13.5');
    expect(raiz.style.getPropertyValue('--font-term')).toContain('JetBrains Mono');
  });
});

describe('matchShortcut', () => {
  const tecla = (key: string, extra: Partial<KeyboardEvent> = {}) =>
    matchShortcut({ key, ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, ...extra });

  it('reconoce los atajos con Ctrl+Alt', () => {
    expect(tecla('ArrowLeft')).toBe('prev');
    expect(tecla('ArrowRight')).toBe('next');
    expect(tecla('n')).toBe('newSession');
    expect(tecla('L')).toBe('cycleLayout');
  });

  it('no secuestra teclas sueltas, combinaciones del navegador ni dígitos (AltGr)', () => {
    expect(tecla('n', { ctrlKey: false })).toBeNull();
    expect(tecla('n', { altKey: false })).toBeNull();
    expect(tecla('w')).toBeNull();
    expect(tecla('2')).toBeNull();
    expect(tecla('ArrowLeft', { shiftKey: true })).toBeNull();
  });
});

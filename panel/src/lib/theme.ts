import type { Settings } from '../types.ts';

export type ThemeName = Settings['theme']['name'];
export type Scheme = 'dark' | 'light';

export const THEME_SCHEME: Record<ThemeName, Scheme> = {
  carbon: 'dark',
  grafito: 'dark',
  pizarra: 'dark',
  fosforo: 'dark',
  papel: 'light',
  contraste: 'dark',
};

export type ThemeCard = {
  id: ThemeName;
  name: string;
  hint: string;
  /** Colores de la miniatura: fondo, panel, terminal y texto. */
  bg: string;
  panel: string;
  term: string;
  text: string;
};

// Valores del «themeList» del diseño aprobado (Config).
export const THEME_CARDS: readonly ThemeCard[] = [
  { id: 'carbon', name: 'Carbón', hint: 'Casi negro y neutro, por defecto', bg: '#09090a', panel: '#0e0e10', term: '#0e0e10', text: '#ececee' },
  { id: 'grafito', name: 'Grafito', hint: 'Oscuro neutro, con un punto de azul', bg: '#0f1113', panel: '#131619', term: '#0b0d0f', text: '#e8e6e1' },
  { id: 'pizarra', name: 'Pizarra', hint: 'Gris azulado, más claro que Grafito', bg: '#161a21', panel: '#191e26', term: '#12161c', text: '#e6e9ee' },
  { id: 'fosforo', name: 'Fósforo', hint: 'Oscuro cálido, papel y tinta', bg: '#12110e', panel: '#181612', term: '#0d0c0a', text: '#efe8da' },
  { id: 'papel', name: 'Papel', hint: 'Claro, tinta sobre crema', bg: '#f6f1e6', panel: '#ebe4d4', term: '#fffdf8', text: '#1f2328' },
  { id: 'contraste', name: 'Alto contraste', hint: 'Negro puro, bordes marcados', bg: '#000000', panel: '#0a0a0a', term: '#000000', text: '#ffffff' },
];

export const ACCENT_CARDS: readonly { id: Settings['theme']['accent']; name: string; color: string }[] = [
  { id: 'ambar', name: 'Ámbar', color: '#f0b25a' },
  { id: 'menta', name: 'Menta', color: '#6cc3b5' },
  { id: 'lavanda', name: 'Lavanda', color: '#b9a6ff' },
  { id: 'coral', name: 'Coral', color: '#ff8a6b' },
  { id: 'cian', name: 'Cian', color: '#6fd3e6' },
];

/**
 * Tema efectivo: con «seguir el tema del sistema», Papel de día (el sistema
 * pide esquema claro) y el elegido de noche.
 */
export function resolveTheme(theme: Settings['theme'], sistemaClaro: boolean): ThemeName {
  return theme.followSystem && sistemaClaro ? 'papel' : theme.name;
}

export type AppearanceAttrs = {
  'data-theme': ThemeName;
  'data-scheme': Scheme;
  'data-accent': Settings['theme']['accent'];
  'data-cursor': 'on' | 'off';
  'data-lights': 'on' | 'off';
  'data-grid': 'on' | 'off';
};

/** Atributos de <html> que activan las variables CSS de tema, acento y personalidad. */
export function appearanceAttrs(s: Settings, sistemaClaro: boolean): AppearanceAttrs {
  const theme = resolveTheme(s.theme, sistemaClaro);
  const onOff = (v: boolean) => (v ? 'on' : 'off');
  return {
    'data-theme': theme,
    'data-scheme': THEME_SCHEME[theme],
    'data-accent': s.theme.accent,
    'data-cursor': onOff(s.personality.cursor),
    'data-lights': onOff(s.personality.lights),
    'data-grid': onOff(s.personality.grid),
  };
}

/** Variables CSS dinámicas que salen de los ajustes (fuentes y tamaños). */
export function fontVars(s: Settings): Record<string, string> {
  return {
    '--font-ui': s.fonts.ui,
    '--font-title': s.fonts.title,
    '--font-term': s.fonts.terminal,
    '--fs-ui': String(s.sizes.ui),
    '--fs-term': String(s.sizes.terminal),
  };
}

export function applyAppearance(root: HTMLElement, s: Settings, sistemaClaro: boolean): void {
  for (const [k, v] of Object.entries(appearanceAttrs(s, sistemaClaro))) root.setAttribute(k, v);
  for (const [k, v] of Object.entries(fontVars(s))) root.style.setProperty(k, v);
}

// Opciones de fuente de Ajustes → valor guardado (lista CSS de familias).
export type FontOption = { label: string; value: string };

export const UI_FONTS: readonly FontOption[] = [
  { label: 'Instrument Sans', value: "'Instrument Sans', system-ui, sans-serif" },
  { label: 'IBM Plex Sans', value: "'IBM Plex Sans', system-ui, sans-serif" },
  { label: 'Inter', value: "Inter, system-ui, sans-serif" },
  { label: 'Fuente del sistema', value: 'system-ui, sans-serif' },
];

export const TITLE_FONTS: readonly FontOption[] = [
  { label: 'Martian Mono', value: "'Martian Mono', ui-monospace, monospace" },
  { label: 'Space Mono', value: "'Space Mono', ui-monospace, monospace" },
  { label: 'Igual que la interfaz', value: 'inherit' },
];

export const TERMINAL_FONTS: readonly FontOption[] = [
  { label: 'JetBrains Mono', value: "'JetBrains Mono', ui-monospace, monospace" },
  { label: 'Fira Code', value: "'Fira Code', ui-monospace, monospace" },
  { label: 'Cascadia Code (si está instalada)', value: "'Cascadia Code', ui-monospace, monospace" },
  { label: 'IBM Plex Mono', value: "'IBM Plex Mono', ui-monospace, monospace" },
];

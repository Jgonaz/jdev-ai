import type { ITheme } from '@xterm/xterm';

// Colores ANSI en el orden de xterm; cada uno sale de una variable CSS --ansi-*.
const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const;

const CLAVES_ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

/**
 * Tema de xterm.js derivado de las variables CSS del tema activo, para que las
 * terminales cambien con el resto del panel. `leer` devuelve el valor de una
 * variable (con o sin el prefijo `--`); las ausentes se omiten y xterm usa su
 * valor por defecto.
 */
export function buildXtermTheme(leer: (variable: string) => string): ITheme {
  const v = (nombre: string): string | undefined => {
    const valor = leer(`--${nombre}`).trim();
    return valor === '' ? undefined : valor;
  };
  const tema: Record<string, string | undefined> = {
    background: v('term-bg'),
    foreground: v('term-text'),
    cursor: v('term-cursor'),
    cursorAccent: v('term-bg'),
    selectionBackground: v('term-selection'),
  };
  CLAVES_ANSI.forEach((clave, i) => {
    tema[clave] = v(`ansi-${ANSI[i]}`);
  });
  return Object.fromEntries(Object.entries(tema).filter(([, valor]) => valor !== undefined)) as ITheme;
}

/** Lee las variables del elemento raíz del documento. */
export function readXtermTheme(root: HTMLElement = document.documentElement): ITheme {
  const estilo = getComputedStyle(root);
  return buildXtermTheme((nombre) => estilo.getPropertyValue(nombre));
}

export const CURSOR_STYLES = { bloque: 'block', barra: 'bar', subrayado: 'underline' } as const;

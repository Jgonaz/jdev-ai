import { describe, expect, it } from 'vitest';
import { buildXtermTheme } from './xtermTheme.ts';

describe('buildXtermTheme', () => {
  const variables: Record<string, string> = {
    '--term-bg': ' #0b0d0f ',
    '--term-text': '#d6d3cc',
    '--term-cursor': '#f0b25a',
    '--term-selection': 'rgba(138, 180, 248, 0.3)',
    '--ansi-red': '#ff7b6b',
    '--ansi-bright-cyan': '#9be3f0',
  };
  const leer = (nombre: string) => variables[nombre] ?? '';

  it('deriva fondo, texto, cursor y selección de las variables del tema', () => {
    const tema = buildXtermTheme(leer);
    expect(tema.background).toBe('#0b0d0f');
    expect(tema.foreground).toBe('#d6d3cc');
    expect(tema.cursor).toBe('#f0b25a');
    expect(tema.cursorAccent).toBe('#0b0d0f');
    expect(tema.selectionBackground).toBe('rgba(138, 180, 248, 0.3)');
  });

  it('mapea los colores ANSI por nombre', () => {
    const tema = buildXtermTheme(leer);
    expect(tema.red).toBe('#ff7b6b');
    expect(tema.brightCyan).toBe('#9be3f0');
  });

  it('omite lo que el tema no define para que xterm use su valor por defecto', () => {
    const tema = buildXtermTheme(leer);
    expect('green' in tema).toBe(false);
    expect(Object.keys(buildXtermTheme(() => ''))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { RUN_COMMAND_MAX, isValidRunCommand } from '../shared/settings-schema.ts';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts';

const con = (run: unknown, base = DEFAULT_SETTINGS) => mergeSettings(base, { projects: { app: { run } } });

describe('comando de arranque por proyecto (projects[id].run)', () => {
  it('acepta una línea de hasta 500 caracteres', () => {
    expect(con('pnpm exec nuxt dev --port 3037').projects.app).toEqual({ run: 'pnpm exec nuxt dev --port 3037' });
    expect(con('x'.repeat(RUN_COMMAND_MAX)).projects.app?.run).toHaveLength(RUN_COMMAND_MAX);
    expect(con('echo "ñ" 😀 | cat').projects.app?.run).toBe('echo "ñ" 😀 | cat');
  });

  it('rechaza lo largo, lo multilínea, los caracteres de control y lo que no es texto', () => {
    for (const malo of ['x'.repeat(RUN_COMMAND_MAX + 1), 'a\nb', 'a\r', 'a\tb', 'a\u0000b', 'a b', 7, true, {}, ['pnpm dev']]) {
      expect(con(malo).projects).toEqual({});
      expect(isValidRunCommand(malo)).toBe(false);
    }
  });

  it('cuenta puntos de código, no unidades UTF-16', () => {
    expect(isValidRunCommand('😀'.repeat(RUN_COMMAND_MAX))).toBe(true);
    expect(isValidRunCommand('😀'.repeat(RUN_COMMAND_MAX + 1))).toBe(false);
  });

  it('una cadena vacía o null borra el comando y vuelve a la detección', () => {
    const base = con('make dev', mergeSettings(DEFAULT_SETTINGS, { projects: { app: { mono: 'AP' } } }));
    expect(base.projects.app).toEqual({ mono: 'AP', run: 'make dev' });
    expect(con('', base).projects.app).toEqual({ mono: 'AP' });
    expect(con('   ', base).projects.app).toEqual({ mono: 'AP' });
    expect(con(null, base).projects.app).toEqual({ mono: 'AP' });
    // Un valor no válido conserva el anterior.
    expect(con('a\nb', base).projects.app).toEqual({ mono: 'AP', run: 'make dev' });
    // Sin más campos, el proyecto desaparece.
    expect(con(null, con('make dev')).projects).toEqual({});
  });
});

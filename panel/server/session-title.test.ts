import { describe, expect, it } from 'vitest';
import { SESSION_TITLE_MAX, checkSessionTitle } from '../shared/session-title.ts';

describe('checkSessionTitle', () => {
  it('recorta los extremos y acepta texto normal, acentos y emojis', () => {
    expect(checkSessionTitle('  Revisar el login ñ 😀  ')).toEqual({ ok: true, title: 'Revisar el login ñ 😀' });
  });

  it('cuenta puntos de código, no unidades UTF-16', () => {
    expect(checkSessionTitle('😀'.repeat(SESSION_TITLE_MAX)).ok).toBe(true);
    expect(checkSessionTitle('😀'.repeat(SESSION_TITLE_MAX + 1)).ok).toBe(false);
    expect(checkSessionTitle('a'.repeat(SESSION_TITLE_MAX + 1)).ok).toBe(false);
  });

  it('rechaza lo que no es texto, lo vacío y los caracteres de control', () => {
    for (const malo of [undefined, null, 3, {}, '', '  ', 'a\nb', 'a\tb', 'a\0b', 'a\u0085b', 'a b', 'a b']) {
      expect(checkSessionTitle(malo).ok, JSON.stringify(malo)).toBe(false);
    }
  });

  it('rechaza la marca «[Closed]», que gestiona el panel', () => {
    expect(checkSessionTitle('[Closed] Algo').ok).toBe(false);
    expect(checkSessionTitle('Algo [Closed]').ok).toBe(true);
  });
});

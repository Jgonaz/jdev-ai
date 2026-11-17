import { describe, expect, it } from 'vitest';
import { RUN_PLACE_KEY, saveRunPlace, suggestRunPlace } from './runPlace.ts';

function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
}

const proyecto = { id: 'web', worktrees: [{ name: 'login', path: '/p/web.worktrees/login', branch: 'feat/login' }] };

describe('lugar de arranque recordado', () => {
  it('propone el checkout principal sin nada recordado o con datos corruptos', () => {
    expect(suggestRunPlace(proyecto, almacen())).toBe('');
    expect(suggestRunPlace(proyecto, almacen({ [RUN_PLACE_KEY]: '{roto' }))).toBe('');
    expect(suggestRunPlace(proyecto, almacen({ [RUN_PLACE_KEY]: '[]' }))).toBe('');
    expect(suggestRunPlace(proyecto, null)).toBe('');
  });

  it('recuerda el último lugar por proyecto mientras el worktree siga abierto', () => {
    const s = almacen();
    saveRunPlace('web', 'login', s);
    saveRunPlace('otro', '', s);
    expect(suggestRunPlace(proyecto, s)).toBe('login');
    expect(suggestRunPlace({ ...proyecto, worktrees: [] }, s)).toBe('');
    saveRunPlace('web', '', s);
    expect(suggestRunPlace(proyecto, s)).toBe('');
  });
});

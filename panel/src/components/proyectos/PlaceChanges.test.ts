// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaceRef } from '../../lib/route.ts';
import type { ChangedFile, FileDiff, PlaceChanges as Changes, PlaceInfo, ProjectInfo, SessionInfo, WorktreeInfo } from '../../types.ts';

const api = vi.hoisted(() => ({ placeChanges: vi.fn(), placeDiff: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));

import { PlaceChanges } from './PlaceChanges.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contenedor: HTMLElement;
beforeEach(() => {
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  api.placeChanges.mockReset();
  api.placeDiff.mockReset();
  api.placeDiff.mockImplementation(
    async (_p: string, _l: PlaceRef, ruta: string): Promise<FileDiff> => ({ path: ruta, oldPath: null, status: 'M', binary: false, tooLarge: false, patch: '@@ -1 +1 @@\n-a\n+b\n' }),
  );
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

const f = (path: string, status: ChangedFile['status'] = 'M'): ChangedFile => ({ path, oldPath: null, status, added: 2, deleted: 1, binary: false });
const lista = (files: ChangedFile[], extra: Partial<Changes> = {}): Changes => ({
  base: 'main',
  mergeBase: 'a1b2c3d4e5f6',
  upstream: null,
  files,
  truncated: false,
  total: files.length,
  ...extra,
});
const project = { id: 'balanz.io', name: 'balanz.io', harness: false } as unknown as ProjectInfo;
const wtInfo: WorktreeInfo = { name: 'typescript-7', branch: 'feat/typescript-7', ahead: 3, behind: 1, dirty: true, changes: 2, sessions: [] };
const mainInfo: PlaceInfo = { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, dirty: true, changes: 2, sessions: [] };
const WT: PlaceRef = { kind: 'wt', name: 'typescript-7' };
const MAIN: PlaceRef = { kind: 'main' };

type Props = Parameters<typeof PlaceChanges>[0];
const monta = async (file: string | null, extra: Partial<Props> = {}) => {
  const manejadores = { onSelectFile: vi.fn(), onDropFile: vi.fn(), onOpenSession: vi.fn(), onNewSession: vi.fn() };
  await act(async () => {
    raiz.render(createElement(PlaceChanges, { project, place: WT, info: wtInfo, base: 'main', file, sessions: [], tabId: 't', ...manejadores, ...extra }));
  });
  return manejadores;
};
const boton = (texto: string) => [...contenedor.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === texto)!;

describe('PlaceChanges de un worktree', () => {
  it('barra con rama, base, punto de partida, adelantados, cambios sin commit y totales', async () => {
    api.placeChanges.mockResolvedValue(lista([f('src/a.ts'), f('b.md', 'U')]));
    await monta('src/a.ts');
    const t = contenedor.querySelector('.wchg__bar')!.textContent!;
    expect(t).toContain('feat/typescript-7');
    expect(t).toContain('frente a main desde a1b2c3d');
    expect(t).toContain('↑3 ↓1');
    expect(t).toContain('cambios sin commit');
    expect(t).toContain('Nueva sesión aquí');
    expect(t).toContain('2 archivos');
    expect(t).toContain('+4');
    expect(t).toContain('−2');
    expect(contenedor.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe('t');
    expect(api.placeChanges).toHaveBeenCalledWith('balanz.io', WT, expect.any(AbortSignal));
    expect(api.placeDiff).toHaveBeenCalledWith('balanz.io', WT, 'src/a.ts', expect.any(AbortSignal));
    expect(contenedor.querySelector('.diffpanel')).not.toBeNull();
    expect(contenedor.querySelector('.wchg__note')).toBeNull();
  });

  it('sin archivo en la dirección muestra el primero del árbol sin tocar la dirección', async () => {
    api.placeChanges.mockResolvedValue(lista([f('z.md'), f('src/lib/a.ts'), f('src/b.ts')]));
    const { onDropFile } = await monta(null);
    // Las carpetas van antes que los archivos, también dentro de `src`: el primero es el de `src/lib`.
    expect(api.placeDiff).toHaveBeenCalledWith('balanz.io', WT, 'src/lib/a.ts', expect.any(AbortSignal));
    expect(contenedor.querySelector('[aria-selected=true] .ftree__name')!.textContent).toBe('a.ts');
    expect(onDropFile).not.toHaveBeenCalled();
    expect(contenedor.querySelector('.wchg__notice')).toBeNull();
  });

  it('un archivo que ya no está entre los cambios avisa, se quita de la dirección y se muestra el primero', async () => {
    api.placeChanges.mockResolvedValue(lista([f('a.ts'), f('b.ts')]));
    const { onDropFile } = await monta('src/old.ts');
    expect(onDropFile).toHaveBeenCalledTimes(1);
    expect(api.placeDiff).toHaveBeenCalledWith('balanz.io', WT, 'a.ts', expect.any(AbortSignal));
    expect(api.placeDiff).not.toHaveBeenCalledWith('balanz.io', WT, 'src/old.ts', expect.anything());
    expect(contenedor.querySelector('.wchg__notice')!.textContent).toContain('src/old.ts ya no tiene cambios: se muestra el primer archivo de la lista.');
    await act(async () => contenedor.querySelector<HTMLButtonElement>('.wchg__notice button')!.click());
    expect(contenedor.querySelector('.wchg__notice')).toBeNull();
  });

  it('sin cambios lo dice, con el texto del worktree, y no pide ningún diff', async () => {
    api.placeChanges.mockResolvedValue(lista([]));
    const { onDropFile } = await monta(null);
    expect(contenedor.textContent).toContain('Sin cambios');
    expect(contenedor.textContent).toContain('La rama feat/typescript-7 aún no tiene commits propios ni cambios sin commit.');
    expect(onDropFile).not.toHaveBeenCalled();
    expect(api.placeDiff).not.toHaveBeenCalled();
  });

  it('con la ruta de un archivo y sin cambios, quita el archivo de la dirección', async () => {
    api.placeChanges.mockResolvedValue(lista([]));
    const { onDropFile } = await monta('a.ts');
    expect(onDropFile).toHaveBeenCalled();
  });

  it('error al cargar la lista, con «Reintentar» que la vuelve a pedir', async () => {
    api.placeChanges.mockRejectedValueOnce(new Error('La rama del worktree no comparte historia.'));
    api.placeChanges.mockResolvedValue(lista([f('a.ts')]));
    await monta('a.ts');
    expect(contenedor.querySelector('[role=alert]')!.textContent).toContain('No se pudieron calcular los cambios');
    expect(contenedor.querySelector('[role=alert]')!.textContent).toContain('no comparte historia');
    await act(async () => boton('Reintentar').click());
    expect(api.placeChanges).toHaveBeenCalledTimes(2);
    expect(contenedor.querySelector('[role=tree]')).not.toBeNull();
  });

  it('«Actualizar» vuelve a pedir la lista', async () => {
    api.placeChanges.mockResolvedValue(lista([f('a.ts')]));
    await monta('a.ts');
    await act(async () => boton('Actualizar').click());
    expect(api.placeChanges).toHaveBeenCalledTimes(2);
  });

  it('al recargar con el mismo archivo y las mismas cifras no pide otra vez el diff, pero sí si cambian', async () => {
    api.placeChanges.mockResolvedValue(lista([f('a.ts')]));
    await monta('a.ts');
    await act(async () => boton('Actualizar').click());
    expect(api.placeDiff).toHaveBeenCalledTimes(1);
    api.placeChanges.mockResolvedValue(lista([{ ...f('a.ts'), added: 5 }]));
    await act(async () => boton('Actualizar').click());
    expect(api.placeDiff).toHaveBeenCalledTimes(2);
  });

  it('ignora la respuesta de un diff que ya no es el del archivo abierto', async () => {
    api.placeChanges.mockResolvedValue(lista([f('a.ts'), f('b.ts')]));
    let resolverA!: (d: FileDiff) => void;
    api.placeDiff.mockImplementationOnce(() => new Promise<FileDiff>((r) => (resolverA = r)));
    const m = await monta('a.ts');
    await act(async () => {
      raiz.render(createElement(PlaceChanges, { project, place: WT, info: wtInfo, base: 'main', file: 'b.ts', sessions: [], tabId: 't', ...m }));
    });
    await act(async () => resolverA({ path: 'a.ts', oldPath: null, status: 'M', binary: false, tooLarge: false, patch: '@@ -1 +1 @@\n-VIEJO\n+VIEJO2\n' }));
    expect(contenedor.textContent).not.toContain('VIEJO');
  });

  it('«Nueva sesión aquí» y las sesiones del lugar con acceso a su terminal', async () => {
    api.placeChanges.mockResolvedValue(lista([f('a.ts')]));
    const sesion = { name: 'jdev-1', title: 'Migración a TS 7', state: 'working', project: 'balanz.io', worktree: 'typescript-7' } as unknown as SessionInfo;
    const m = await monta('a.ts', { info: { ...wtInfo, sessions: ['jdev-1'] }, sessions: [sesion] });
    await act(async () => boton('Nueva sesión aquí').click());
    expect(m.onNewSession).toHaveBeenCalledTimes(1);
    const pildora = contenedor.querySelector<HTMLButtonElement>('.wt__session')!;
    expect(pildora.textContent).toContain('Migración a TS 7');
    await act(async () => pildora.click());
    expect(m.onOpenSession).toHaveBeenCalledWith('jdev-1');
  });
});

describe('PlaceChanges del checkout principal', () => {
  it('con rama remota: commits sin subir frente a ella, y no pide comparar con una rama principal', async () => {
    api.placeChanges.mockResolvedValue(lista([f('README.md')], { base: 'origin/main', upstream: 'origin/main' }));
    await monta(null, { place: MAIN, info: mainInfo });
    const t = contenedor.querySelector('.wchg__bar')!.textContent!;
    expect(t).toContain('main');
    expect(t).toContain('↑1 sin subir frente a origin/main');
    expect(t).not.toContain('frente a main desde');
    expect(contenedor.querySelector('.wchg__note')).toBeNull();
    expect(api.placeChanges).toHaveBeenCalledWith('balanz.io', MAIN, expect.any(AbortSignal));
    expect(contenedor.querySelector('[role=columnheader]')!.textContent).toBe('Antes · origin/main a1b2c3d');
    expect([...contenedor.querySelectorAll('[role=columnheader]')][1]!.textContent).toBe('Después · checkout principal');
  });

  it('con todo subido y con commits por bajar', async () => {
    api.placeChanges.mockResolvedValue(lista([f('README.md')], { base: 'origin/main', upstream: 'origin/main' }));
    await monta(null, { place: MAIN, info: { ...mainInfo, ahead: 0, behind: 2 } });
    const t = contenedor.querySelector('.wchg__bar')!.textContent!;
    expect(t).toContain('todo subido a origin/main');
    expect(t).toContain('↓2');
  });

  it('sin rama remota lo dice y avisa de qué se muestra', async () => {
    api.placeChanges.mockResolvedValue(lista([f('README.md')], { base: 'main', upstream: null }));
    await monta(null, { place: MAIN, info: { ...mainInfo, upstream: null, ahead: null, behind: null } });
    expect(contenedor.querySelector('.wchg__bar')!.textContent).toContain('sin rama remota');
    expect(contenedor.querySelector('.wchg__note')!.textContent).toContain('Sin rama remota no se puede saber qué falta por subir');
  });

  it('sin cambios, con el texto propio del checkout principal', async () => {
    api.placeChanges.mockResolvedValue(lista([], { base: 'origin/main', upstream: 'origin/main' }));
    await monta(null, { place: MAIN, info: { ...mainInfo, dirty: false, changes: 0, ahead: 0 } });
    expect(contenedor.textContent).toContain('Todo está subido a origin/main y no hay cambios sin commit.');
    expect(contenedor.querySelector('.wt__dirty')).toBeNull();
  });

  it('sin cambios y sin rama remota', async () => {
    api.placeChanges.mockResolvedValue(lista([], { base: 'main', upstream: null }));
    await monta(null, { place: MAIN, info: { ...mainInfo, upstream: null, dirty: false, changes: 0 } });
    expect(contenedor.textContent).toContain('No hay cambios sin commit ni archivos nuevos.');
  });
});

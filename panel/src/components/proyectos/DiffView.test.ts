// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIFF_MODE_KEY } from '../../lib/diffMode.ts';
import type { ChangedFile, FileDiff } from '../../types.ts';
import { DiffView, MIN_SPLIT_WIDTH } from './DiffView.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contenedor: HTMLElement;
let ancho = 1000;
beforeEach(() => {
  localStorage.clear();
  ancho = 1000;
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  // happy-dom no maqueta: el ancho del panel lo fija la prueba.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: ancho, height: 400, x: 0, y: 0, top: 0, left: 0, right: ancho, bottom: 400, toJSON: () => ({}) }));
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  vi.restoreAllMocks();
});

const FILE: ChangedFile = { path: 'src/lib/dates.ts', oldPath: null, status: 'M', added: 2, deleted: 1, binary: false };
const PATCH = ['diff --git a/x b/x', '@@ -1,3 +1,3 @@', ' uno', '-dos', '+DOS', ' tres', ''].join('\n');
const diff = (parcial: Partial<FileDiff> = {}): FileDiff => ({ path: FILE.path, oldPath: null, status: 'M', binary: false, tooLarge: false, patch: PATCH, ...parcial });

const monta = (props: Partial<Parameters<typeof DiffView>[0]> = {}) => {
  const onRetry = vi.fn();
  act(() => {
    raiz.render(createElement(DiffView, { file: FILE, diff: diff(), loading: false, error: null, onRetry, baseLabel: 'main', mergeShort: 'a1b2c3d', afterLabel: 'Después · worktree', terminalHint: 'git diff main...', ...props }));
  });
  return onRetry;
};
const botones = () => [...contenedor.querySelectorAll<HTMLButtonElement>('.diffsw__btn')];

describe('DiffView', () => {
  it('muestra lado a lado por defecto, con cabeceras de columna, números y signos', () => {
    monta();
    expect(contenedor.querySelector('[aria-label="Diff lado a lado"]')).not.toBeNull();
    expect(contenedor.querySelector('[aria-label="Diff unificado"]')).toBeNull();
    expect([...contenedor.querySelectorAll('[role=columnheader]')].map((c) => c.textContent)).toEqual(['Antes · main a1b2c3d', 'Después · worktree']);
    expect(contenedor.querySelector('.diff__hunkrow')!.textContent).toBe('@@ -1,3 +1,3 @@');
    const filas = [...contenedor.querySelectorAll('.diffs__row')].map((r) => r.textContent);
    expect(filas).toEqual(['1 uno1 uno', '2−dos2+DOS', '3 tres3 tres']);
    expect(botones().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(contenedor.querySelector('.diffpanel__badge')!.textContent).toBe('M · Modificado');
  });

  it('el conmutador cambia a unificado y lo recuerda', () => {
    monta();
    act(() => botones()[1]!.click());
    expect(contenedor.querySelector('[aria-label="Diff unificado"]')).not.toBeNull();
    expect(contenedor.querySelector('[aria-label="Diff lado a lado"]')).toBeNull();
    expect(botones().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(localStorage.getItem(DIFF_MODE_KEY)).toBe('unified');
    const filas = [...contenedor.querySelectorAll('.diffu__row')].map((r) => [r.getAttribute('data-kind'), r.textContent]);
    expect(filas).toEqual([['ctx', '11 uno'], ['del', '2−dos'], ['add', '2+DOS'], ['ctx', '33 tres']]);
  });

  it('arranca en unificado si es lo que se eligió', () => {
    localStorage.setItem(DIFF_MODE_KEY, 'unified');
    monta();
    expect(contenedor.querySelector('[aria-label="Diff unificado"]')).not.toBeNull();
  });

  it('por debajo del ancho mínimo fuerza unificado y oculta el conmutador, sin olvidar la elección', () => {
    ancho = MIN_SPLIT_WIDTH - 1;
    monta();
    expect(contenedor.querySelector('[aria-label="Diff unificado"]')).not.toBeNull();
    expect(contenedor.querySelector('.diffsw')).toBeNull();
    expect(localStorage.getItem(DIFF_MODE_KEY)).toBeNull();
  });

  it('un renombrado con cambios muestra la ruta anterior en la cabecera y en la columna «antes»', () => {
    monta({ file: { ...FILE, status: 'R', oldPath: 'src/utils/dates.ts' }, diff: diff({ status: 'R', oldPath: 'src/utils/dates.ts' }) });
    expect(contenedor.querySelector('.diffpanel__old')!.textContent).toBe('desde src/utils/dates.ts');
    expect(contenedor.querySelector('[role=columnheader]')!.textContent).toBe('Antes · main a1b2c3d · src/utils/dates.ts');
  });

  it('un renombrado sin cambios de contenido lo dice', () => {
    monta({ file: { ...FILE, status: 'R', oldPath: 'src/utils/format.ts' }, diff: diff({ patch: 'diff --git a/x b/y\nsimilarity index 100%\n' }) });
    expect(contenedor.textContent).toContain('Renombrado sin cambios');
    expect(contenedor.textContent).toContain('Movido desde src/utils/format.ts sin cambios en su contenido.');
  });

  it('binario y demasiado grande se indican en lugar del diff', () => {
    monta({ diff: diff({ binary: true, patch: null }) });
    expect(contenedor.textContent).toContain('Archivo binario');
    expect(contenedor.querySelector('.diffs')).toBeNull();
    monta({ diff: diff({ tooLarge: true, patch: null }) });
    expect(contenedor.textContent).toContain('Diff demasiado grande');
    expect(contenedor.textContent).toContain('git diff main...');
  });

  it('un archivo borrado deja huecos rayados en la columna nueva', () => {
    monta({ file: { ...FILE, status: 'D' }, diff: diff({ status: 'D', patch: '@@ -1,2 +0,0 @@\n-a\n-b\n' }) });
    expect(contenedor.querySelectorAll('.diffs__code--gap')).toHaveLength(2);
    expect(contenedor.querySelector('.diffpanel__badge')!.getAttribute('data-status')).toBe('D');
  });

  it('carga y error con «Reintentar»', () => {
    monta({ diff: null, loading: true });
    expect(contenedor.querySelector('[role=status]')!.textContent).toContain('Cargando');
    const onRetry = monta({ diff: null, loading: false, error: 'git falló' });
    expect(contenedor.querySelector('[role=alert]')!.textContent).toContain('git falló');
    act(() => [...contenedor.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reintentar')!.click());
    expect(onRetry).toHaveBeenCalled();
  });

  it('las líneas sin salto de línea final llevan su aviso', () => {
    monta({ diff: diff({ patch: '@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n' }) });
    expect(contenedor.querySelectorAll('.diff__noeol')).toHaveLength(1);
  });
});

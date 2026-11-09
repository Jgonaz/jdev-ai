// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangedFile } from '../../types.ts';
import { FileTree } from './FileTree.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contenedor: HTMLElement;
beforeEach(() => {
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

const f = (path: string, status: ChangedFile['status'] = 'M', added: number | null = 1, deleted: number | null = 0, binary = false): ChangedFile => ({
  path,
  oldPath: null,
  status,
  added,
  deleted,
  binary,
});
const ARCHIVOS = [f('src/lib/a.ts', 'M', 6, 4), f('src/lib/b.ts', 'D', 0, 7), f('README.md', 'U', 9, 0), f('logo.png', 'M', null, null, true)];

const monta = (props: Partial<Parameters<typeof FileTree>[0]> = {}) => {
  const onSelect = vi.fn();
  act(() => {
    raiz.render(createElement(FileTree, { files: ARCHIVOS, selected: null, onSelect, total: ARCHIVOS.length, truncated: false, ...props }));
  });
  return onSelect;
};
const filas = () => [...contenedor.querySelectorAll<HTMLElement>('[role=treeitem]')];
const nombres = () => filas().map((r) => r.querySelector('.ftree__name')!.textContent);
const tecla = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('FileTree', () => {
  it('es un árbol con carpetas compactadas, estado y líneas de cada archivo', () => {
    monta({ selected: 'README.md' });
    expect(contenedor.querySelector('[role=tree]')).not.toBeNull();
    expect(nombres()).toEqual(['src/lib', 'a.ts', 'b.ts', 'logo.png', 'README.md']);
    const [dir, a, b, logo, readme] = filas();
    expect(dir!.getAttribute('aria-expanded')).toBe('true');
    expect(dir!.getAttribute('aria-level')).toBe('1');
    expect(a!.getAttribute('aria-level')).toBe('2');
    expect(a!.textContent).toContain('+6');
    expect(a!.textContent).toContain('−4');
    expect(a!.querySelector('.ftree__st')!.textContent).toBe('M');
    expect(a!.querySelector('.sr-only')!.textContent).toBe('Modificado');
    expect(b!.getAttribute('data-status')).toBe('D');
    expect(logo!.textContent).toContain('bin');
    expect(readme!.getAttribute('aria-selected')).toBe('true');
    expect(a!.getAttribute('aria-selected')).toBe('false');
    // Una sola parada de tabulador: la fila seleccionada.
    expect(filas().filter((r) => r.tabIndex === 0)).toEqual([readme]);
  });

  it('pulsar un archivo lo abre y pulsar una carpeta la pliega', () => {
    const onSelect = monta();
    act(() => filas()[1]!.click());
    expect(onSelect).toHaveBeenCalledWith('src/lib/a.ts');
    act(() => filas()[0]!.click());
    expect(nombres()).toEqual(['src/lib', 'logo.png', 'README.md']);
    expect(filas()[0]!.getAttribute('aria-expanded')).toBe('false');
  });

  it('las flechas, Inicio y Fin mueven el foco; Enter abre el archivo', () => {
    const onSelect = monta();
    const [dir, a, b, logo, readme] = filas();
    act(() => dir!.focus());
    tecla(dir!, 'ArrowDown');
    expect(document.activeElement).toBe(a);
    tecla(a!, 'ArrowDown');
    expect(document.activeElement).toBe(b);
    tecla(b!, 'End');
    expect(document.activeElement).toBe(readme);
    tecla(readme!, 'ArrowUp');
    expect(document.activeElement).toBe(logo);
    tecla(logo!, 'Home');
    expect(document.activeElement).toBe(dir);
    tecla(a!, 'Enter');
    expect(onSelect).toHaveBeenCalledWith('src/lib/a.ts');
    // Los extremos no se pasan.
    tecla(dir!, 'ArrowUp');
    expect(document.activeElement).toBe(dir);
  });

  it('derecha e izquierda despliegan, plegan y van al hijo o al padre', () => {
    monta();
    const dir = filas()[0]!;
    act(() => dir.focus());
    tecla(dir, 'ArrowLeft');
    expect(nombres()).toEqual(['src/lib', 'logo.png', 'README.md']);
    tecla(filas()[0]!, 'ArrowRight');
    expect(nombres()).toHaveLength(5);
    tecla(filas()[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(filas()[1]);
    tecla(filas()[1]!, 'ArrowLeft');
    expect(document.activeElement).toBe(filas()[0]);
  });

  it('Espacio alterna una carpeta', () => {
    monta();
    const dir = filas()[0]!;
    act(() => dir.focus());
    tecla(dir, ' ');
    expect(filas()).toHaveLength(3);
    tecla(filas()[0]!, ' ');
    expect(filas()).toHaveLength(5);
  });

  it('«Plegar todas las carpetas» pliega todas', () => {
    monta();
    act(() => contenedor.querySelector<HTMLButtonElement>('[aria-label="Plegar todas las carpetas"]')!.click());
    expect(nombres()).toEqual(['src/lib', 'logo.png', 'README.md']);
  });

  it('abrir un archivo oculto por una carpeta plegada la despliega', () => {
    monta();
    act(() => filas()[0]!.click());
    expect(filas()).toHaveLength(3);
    monta({ selected: 'src/lib/b.ts' });
    expect(filas()).toHaveLength(5);
  });

  it('avisa si la lista está recortada', () => {
    monta({ truncated: true, total: 34120 });
    expect(contenedor.querySelector('.ftree__more')!.textContent).toBe('Se muestran 4 de 34.120 archivos.');
  });
});

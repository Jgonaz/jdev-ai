// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFocusTrap } from './useFocusTrap.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contenedor: HTMLElement;
beforeEach(() => {
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  // happy-dom no maqueta: todo elemento conectado cuenta como visible.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  delete (HTMLElement.prototype as { offsetParent?: unknown }).offsetParent;
});

function Trampa(props: { id: string; hijos?: ReactNode; opciones?: Parameters<typeof useFocusTrap>[3]; botones?: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, () => undefined, undefined, props.opciones);
  return createElement(
    'div',
    { ref, id: props.id, tabIndex: -1 },
    ...(props.botones ?? ['a', 'b']).map((n) => createElement('button', { key: n, id: `${props.id}-${n}` }, n)),
    props.hijos,
  );
}

const PANEL = { moveFocus: false, closeOnEscape: false, restoreFocus: false };

const tab = (shiftKey = false) => {
  const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};
const activo = () => document.activeElement?.id;

describe('useFocusTrap', () => {
  it('Tab en el último elemento vuelve al primero y Mayús+Tab en el primero va al último', () => {
    act(() => raiz.render(createElement(Trampa, { id: 'm' })));
    expect(activo()).toBe('m-a');
    (document.getElementById('m-b') as HTMLElement).focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(activo()).toBe('m-a');
    expect(tab(true).defaultPrevented).toBe(true);
    expect(activo()).toBe('m-b');
  });

  it('con una trampa debajo de otra, solo atiende Tab la de arriba (no se pelean por el foco)', () => {
    // Un detalle superpuesto (trampa de panel) bajo un diálogo: el diálogo se monta después.
    const panel = createElement(Trampa, { id: 'panel', opciones: PANEL });
    act(() => raiz.render(createElement('div', null, panel)));
    act(() => raiz.render(createElement('div', null, panel, createElement(Trampa, { id: 'dialogo', botones: ['x', 'y', 'z'] }))));
    expect(activo()).toBe('dialogo-x');
    (document.getElementById('dialogo-y') as HTMLElement).focus();
    tab();
    // Sin pila, la trampa del panel habría llevado el foco a su primer botón y la del diálogo lo habría devuelto a «x».
    expect(activo()).toBe('dialogo-y');
    (document.getElementById('dialogo-z') as HTMLElement).focus();
    tab();
    expect(activo()).toBe('dialogo-x');
  });

  it('al cerrarse la trampa de arriba, la de abajo vuelve a atender el teclado', () => {
    const panel = createElement(Trampa, { id: 'panel', opciones: PANEL });
    act(() => raiz.render(createElement('div', null, panel, createElement(Trampa, { id: 'dialogo' }))));
    act(() => raiz.render(createElement('div', null, panel)));
    (document.getElementById('panel-b') as HTMLElement).focus();
    tab();
    expect(activo()).toBe('panel-a');
  });

  it('los elementos con tabindex -1 no cuentan como primero ni último', () => {
    act(() => raiz.render(createElement(Trampa, { id: 'm', botones: ['a', 'b'], hijos: createElement('button', { id: 'm-fuera', tabIndex: -1 }, 'fuera') })));
    (document.getElementById('m-b') as HTMLElement).focus();
    tab();
    expect(activo()).toBe('m-a');
  });
});

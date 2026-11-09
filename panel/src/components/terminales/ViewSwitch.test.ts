// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitch } from './ViewSwitch.tsx';

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

const monta = (chat: { available: boolean; reason: string | null }, onView = vi.fn()) =>
  act(async () => {
    raiz.render(createElement(ViewSwitch, { view: 'terminal', onView, chat, full: false }));
  });

const botonChat = () => contenedor.querySelectorAll<HTMLButtonElement>('.viewsw__btn')[1]!;
const tip = () => contenedor.querySelector<HTMLElement>('.viewsw__tip')!;
const pulsaEsc = () =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });

describe('ViewSwitch: «Chat» no disponible', () => {
  it('sigue siendo un botón enfocable con el motivo como descripción y no cambia de vista', async () => {
    const onView = vi.fn();
    await monta({ available: false, reason: 'Solo en sesiones de Claude.' }, onView);
    expect(botonChat().getAttribute('aria-disabled')).toBe('true');
    expect(botonChat().getAttribute('aria-describedby')).toBe(tip().id);
    expect(tip().textContent).toBe('Solo en sesiones de Claude.');
    await act(async () => botonChat().click());
    expect(onView).not.toHaveBeenCalled();
  });

  it('Esc cierra el tooltip sin mover el foco y no llega a quien tenga el foco', async () => {
    await monta({ available: false, reason: 'Motivo' });
    await act(async () => botonChat().focus());
    expect(document.activeElement).toBe(botonChat());
    expect(tip().hasAttribute('data-dismissed')).toBe(false);
    const alcanzado = vi.fn();
    window.addEventListener('keydown', alcanzado);
    await pulsaEsc();
    window.removeEventListener('keydown', alcanzado);
    expect(tip().getAttribute('data-dismissed')).toBe('true');
    expect(document.activeElement).toBe(botonChat());
    expect(alcanzado).not.toHaveBeenCalled();
    // Con el tooltip ya cerrado, Esc vuelve a llegar a los demás.
    const otra = vi.fn();
    window.addEventListener('keydown', otra);
    await pulsaEsc();
    window.removeEventListener('keydown', otra);
    expect(otra).toHaveBeenCalled();
  });

  it('también se cierra con el ratón encima y vuelve a salir al volver a entrar', async () => {
    await monta({ available: false, reason: 'Motivo' });
    await act(async () => botonChat().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await pulsaEsc();
    expect(tip().getAttribute('data-dismissed')).toBe('true');
    await act(async () => botonChat().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    expect(tip().hasAttribute('data-dismissed')).toBe(false);
  });

  it('con «Chat» disponible no hay tooltip ni escucha de Esc', async () => {
    const onView = vi.fn();
    await monta({ available: true, reason: null }, onView);
    expect(tip()).toBeNull();
    expect(botonChat().hasAttribute('aria-disabled')).toBe(false);
    await act(async () => botonChat().click());
    expect(onView).toHaveBeenCalledWith('chat');
  });
});

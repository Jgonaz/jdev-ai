// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChangesOverview, ProjectInfo, SessionInfo } from '../../types.ts';
import { PlaceTabs, placeTabId } from './PlaceTabs.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contenedor: HTMLElement;
beforeEach(() => {
  window.location.hash = '';
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
});

const project = (extra: object = {}) => ({ id: 'balanz.io', name: 'balanz.io', harness: false, worktrees: [{ name: 'typescript-7', path: '/x', branch: 'feat/ts' }], ...extra }) as unknown as ProjectInfo;
const overview: ChangesOverview = {
  base: 'main',
  main: { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, dirty: true, changes: 1, sessions: [] },
  worktrees: [
    { name: 'typescript-7', branch: 'feat/typescript-7', ahead: 3, behind: 1, dirty: true, changes: 10, sessions: ['s1'] },
    { name: 'login', branch: 'feat/login', ahead: 0, behind: 2, dirty: false, changes: 0, sessions: [] },
  ],
};
const trabajando = { name: 's1', project: 'balanz.io', worktree: 'typescript-7', state: 'working', title: 'x', tracked: true, alive: true, done: null } as unknown as SessionInfo;

const monta = (props: Partial<Parameters<typeof PlaceTabs>[0]> = {}) =>
  act(() => {
    raiz.render(createElement(PlaceTabs, { project: project(), overview, place: { kind: 'main' }, sessions: [], ...props }));
  });
const pestañas = () => [...contenedor.querySelectorAll<HTMLAnchorElement>('[role=tab]')];

describe('PlaceTabs', () => {
  it('main primero y un worktree por pestaña, con su número y la elegida marcada', () => {
    monta();
    expect(contenedor.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Dónde mirar los cambios');
    expect(pestañas().map((t) => t.querySelector('span')!.textContent)).toEqual(['main', 'typescript-7', 'login']);
    expect(pestañas().map((t) => t.querySelector('.ptabs__count')!.firstChild!.textContent)).toEqual(['1', '10', '0']);
    expect(pestañas().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(pestañas().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(pestañas().map((t) => t.getAttribute('href'))).toEqual(['#/cambios/balanz.io', '#/cambios/balanz.io/wt/typescript-7', '#/cambios/balanz.io/wt/login']);
    expect(pestañas()[0]!.id).toBe(placeTabId({ kind: 'main' }));
    expect(contenedor.querySelector('.ptabs__note')).toBeNull();
  });

  it('marca la pestaña del worktree elegido', () => {
    monta({ place: { kind: 'wt', name: 'login' } });
    expect(pestañas().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
  });

  it('un punto en la pestaña con una sesión trabajando', () => {
    monta({ sessions: [trabajando] });
    expect(pestañas().map((t) => t.querySelector('.ptabs__work') !== null)).toEqual([false, true, false]);
    monta({ sessions: [{ ...trabajando, state: 'idle' } as unknown as SessionInfo] });
    expect(contenedor.querySelector('.ptabs__work')).toBeNull();
  });

  it('el harness solo tiene la pestaña main y la nota', () => {
    monta({ project: project({ harness: true, worktrees: [] }), overview: { ...overview, worktrees: [] } });
    expect(pestañas()).toHaveLength(1);
    expect(contenedor.querySelector('.ptabs__note')!.textContent).toBe('El harness no usa worktrees.');
  });

  it('antes de tener la lista de lugares, las pestañas salen de los worktrees del proyecto y sin número', () => {
    monta({ overview: null });
    expect(pestañas().map((t) => t.querySelector('span')!.textContent)).toEqual(['main', 'typescript-7']);
    expect(pestañas().map((t) => t.querySelector('.ptabs__count')!.firstChild!.textContent)).toEqual(['–', '–']);
  });

  it('las flechas, Inicio y Fin cambian de pestaña navegando a su dirección', () => {
    monta();
    const tecla = (el: Element, key: string) =>
      act(() => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    tecla(pestañas()[0]!, 'ArrowRight');
    expect(window.location.hash).toBe('#/cambios/balanz.io/wt/typescript-7');
    monta({ place: { kind: 'wt', name: 'typescript-7' } });
    tecla(pestañas()[1]!, 'End');
    expect(window.location.hash).toBe('#/cambios/balanz.io/wt/login');
    monta({ place: { kind: 'wt', name: 'login' } });
    tecla(pestañas()[2]!, 'ArrowRight');
    expect(window.location.hash).toBe('#/cambios/balanz.io');
    tecla(pestañas()[2]!, 'Home');
    expect(window.location.hash).toBe('#/cambios/balanz.io');
  });
});

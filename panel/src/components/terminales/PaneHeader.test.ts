// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, SessionInfo } from '../../types.ts';
import { PaneHeader } from './PaneHeader.tsx';

// El menú «⋯» necesita el contexto del espacio de trabajo y aquí no se prueba.
vi.mock('./MoreMenu.tsx', () => ({ MoreMenu: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ahora = Date.UTC(2026, 10, 9, 12, 0);
const sesion = { name: 'jdev-x-1', project: 'p', agent: 'claude', worktree: '', branch: 'main', state: 'working', tracked: true, title: 'Vista chat', done: null, alive: true, updatedAt: ahora, created: ahora - 60_000, notice: '', usage: null, activity: null, archived: false, run: null, chat: { available: true, reason: null } } as unknown as SessionInfo;
const proyecto = { id: 'p', name: 'jdev-ai', color: '#fff' } as ProjectInfo;

let raiz: Root;
let contenedor: HTMLElement;
let ancho = 700;

beforeEach(() => {
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  // happy-dom no tiene layout: el ancho del pane se simula.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: ancho, height: 100, top: 0, left: 0, right: ancho, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }));
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  vi.restoreAllMocks();
});

const monta = (view: 'terminal' | 'chat') =>
  act(async () => {
    raiz.render(createElement(PaneHeader, { session: sesion, project: proyecto, view, onView: () => undefined, searching: false, onSearch: () => undefined }));
  });

describe('PaneHeader: estado en un pane estrecho', () => {
  it('en vista chat y estrecho, el chip pasa a un punto con el estado como nombre accesible y título', async () => {
    ancho = 400;
    await monta('chat');
    expect(contenedor.querySelector('.chip')).toBeNull();
    const punto = contenedor.querySelector('.pane__statedot')!;
    expect(punto.getAttribute('role')).toBe('img');
    expect(punto.getAttribute('aria-label')).toMatch(/^Trabajando/);
    expect(punto.getAttribute('title')).toBe(punto.getAttribute('aria-label'));
    expect(punto.textContent).toBe('');
  });

  it('la vista terminal estrecha conserva el chip de siempre', async () => {
    ancho = 400;
    await monta('terminal');
    expect(contenedor.querySelector('.pane__statedot')).toBeNull();
    expect(contenedor.querySelector('.chip')?.textContent).toMatch(/^Trabajando/);
  });

  it('la vista chat ancha conserva el chip', async () => {
    ancho = 900;
    await monta('chat');
    expect(contenedor.querySelector('.pane__statedot')).toBeNull();
    expect(contenedor.querySelector('.chip')).not.toBeNull();
  });
});

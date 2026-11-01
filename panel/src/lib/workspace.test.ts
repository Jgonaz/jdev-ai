// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_WORKSPACE,
  STORAGE_KEY,
  loadUiPrefs,
  loadWorkspace,
  parseWorkspace,
  saveUiPrefs,
  saveWorkspace,
  visibleTabs,
  workspaceReducer,
} from './workspace.ts';
import type { Workspace, WorkspaceAction } from './workspace.ts';

const aplicar = (w: Workspace, ...acciones: WorkspaceAction[]) => acciones.reduce(workspaceReducer, w);
const abrir = (...nombres: string[]): WorkspaceAction[] => nombres.map((name) => ({ type: 'open', name }));

describe('espacio de trabajo', () => {
  it('abrir añade al final y activa; abrir una abierta solo la activa', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b'));
    expect(w).toMatchObject({ tabs: ['a', 'b'], active: 'b' });
    w = aplicar(w, { type: 'open', name: 'a' });
    expect(w).toMatchObject({ tabs: ['a', 'b'], active: 'a' });
  });

  it('abrir junto a la activa inserta a su derecha y sube la distribución a dos', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b', 'c'), { type: 'activate', name: 'a' });
    w = aplicar(w, { type: 'open', name: 'n', nextToActive: true, minLayout: 2 });
    expect(w.tabs).toEqual(['a', 'n', 'b', 'c']);
    expect(w.active).toBe('n');
    expect(w.layout).toBe(2);
    // La vieja activa y la nueva se ven juntas.
    expect(visibleTabs(w)).toEqual(['a', 'n']);
  });

  it('no baja la distribución al abrir junto a la activa', () => {
    const w = aplicar({ ...EMPTY_WORKSPACE, layout: 4 }, ...abrir('a'), { type: 'open', name: 'b', nextToActive: true, minLayout: 2 });
    expect(w.layout).toBe(4);
  });

  it('la ventana visible sigue a la pestaña activa', () => {
    let w = aplicar({ ...EMPTY_WORKSPACE, layout: 2 }, ...abrir('a', 'b', 'c', 'd'));
    expect(visibleTabs(w)).toEqual(['c', 'd']);
    w = aplicar(w, { type: 'activate', name: 'a' });
    expect(visibleTabs(w)).toEqual(['a', 'b']);
    w = aplicar(w, { type: 'move', delta: 1 }, { type: 'move', delta: 1 });
    expect(w.active).toBe('c');
    expect(visibleTabs(w)).toEqual(['b', 'c']);
  });

  it('cambiar de terminal es circular', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b'));
    w = aplicar(w, { type: 'move', delta: 1 });
    expect(w.active).toBe('a');
    w = aplicar(w, { type: 'move', delta: -1 });
    expect(w.active).toBe('b');
  });

  it('con cuatro huecos y menos pestañas se ven todas', () => {
    const w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b'), { type: 'layout', layout: 4 });
    expect(visibleTabs(w)).toEqual(['a', 'b']);
  });

  it('cerrar la activa activa la vecina; cerrar la última deja el espacio vacío', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b', 'c'), { type: 'activate', name: 'b' });
    w = aplicar(w, { type: 'close', name: 'b' });
    expect(w).toMatchObject({ tabs: ['a', 'c'], active: 'c' });
    w = aplicar(w, { type: 'close', name: 'c' }, { type: 'close', name: 'a' });
    expect(w).toMatchObject({ tabs: [], active: null, start: 0 });
  });

  it('cicla la distribución 1 → 2 → 4 → 1', () => {
    let w = EMPTY_WORKSPACE;
    const vistas = [0, 1, 2, 3].map(() => (w = aplicar(w, { type: 'cycleLayout' })).layout);
    expect(vistas).toEqual([2, 4, 1, 2]);
  });

  it('prune retira las pestañas de sesiones que ya no existen', () => {
    const w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b', 'c'), { type: 'prune', alive: new Set(['a', 'c']) });
    expect(w).toMatchObject({ tabs: ['a', 'c'], active: 'c' });
    const intacto = aplicar(w, { type: 'prune', alive: new Set(['a', 'c', 'z']) });
    expect(intacto).toBe(w);
  });
});

describe('persistencia', () => {
  beforeEach(() => localStorage.clear());

  it('guarda y recupera pestañas, activa y distribución', () => {
    const w = aplicar({ ...EMPTY_WORKSPACE, layout: 2 }, ...abrir('a', 'b', 'c'));
    saveWorkspace(w);
    expect(loadWorkspace()).toEqual(w);
  });

  it('un valor corrupto o con tipos erróneos no rompe la carga', () => {
    expect(parseWorkspace('{no es json')).toBeNull();
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace('{"tabs":"x"}')).toBeNull();
    const w = parseWorkspace('{"tabs":["a",3,"a","b"],"active":"zzz","layout":3,"start":-4}');
    expect(w).toEqual({ tabs: ['a', 'b'], active: 'a', layout: 1, start: 0 });
  });

  it('si localStorage lanza (modo privado o bloqueado), no falla', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadWorkspace(roto)).toBeNull();
    expect(() => saveWorkspace(EMPTY_WORKSPACE, roto)).not.toThrow();
    expect(loadUiPrefs(roto)).toEqual({ contextOpen: true, hideClosed: false });
  });

  it('preferencias de interfaz', () => {
    saveUiPrefs({ contextOpen: false, hideClosed: true });
    expect(loadUiPrefs()).toEqual({ contextOpen: false, hideClosed: true });
    localStorage.setItem('jdev-panel:ui', '{"contextOpen":"sí"}');
    expect(loadUiPrefs()).toEqual({ contextOpen: true, hideClosed: false });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

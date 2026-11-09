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
  viewOf,
  visibleTabs,
  workspaceReducer,
} from './workspace.ts';
import type { Workspace, WorkspaceAction } from './workspace.ts';
import { followKey } from './follow.ts';

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

  it('reordenar lleva la pestaña a la posición pedida y mantiene la activa a la vista', () => {
    let w = aplicar({ ...EMPTY_WORKSPACE, layout: 2 }, ...abrir('a', 'b', 'c', 'd'), { type: 'activate', name: 'a' });
    w = aplicar(w, { type: 'reorder', name: 'a', to: 2 });
    expect(w.tabs).toEqual(['b', 'c', 'a', 'd']);
    expect(visibleTabs(w)).toContain('a');
    w = aplicar(w, { type: 'reorder', name: 'd', to: -3 });
    expect(w.tabs).toEqual(['d', 'b', 'c', 'a']);
    w = aplicar(w, { type: 'reorder', name: 'b', to: 99 });
    expect(w.tabs).toEqual(['d', 'c', 'a', 'b']);
    // Sin cambio o con una pestaña que no existe, el estado es el mismo objeto.
    expect(aplicar(w, { type: 'reorder', name: 'd', to: 0 })).toBe(w);
    expect(aplicar(w, { type: 'reorder', name: 'x', to: 1 })).toBe(w);
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

  it('cerrar una pestaña (la «x») pasa la activa a la siguiente, o a la anterior si era la última', () => {
    const w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b', 'c'), { type: 'activate', name: 'a' });
    // Primera: la siguiente ocupa su sitio.
    expect(aplicar(w, { type: 'close', name: 'a' })).toMatchObject({ tabs: ['b', 'c'], active: 'b' });
    // Última activa: pasa a la anterior.
    expect(aplicar(w, { type: 'activate', name: 'c' }, { type: 'close', name: 'c' })).toMatchObject({ tabs: ['a', 'b'], active: 'b' });
    // Cerrar otra pestaña no cambia la activa.
    expect(aplicar(w, { type: 'close', name: 'c' })).toMatchObject({ tabs: ['a', 'b'], active: 'a' });
    expect(aplicar(w, { type: 'close', name: 'b' })).toMatchObject({ tabs: ['a', 'c'], active: 'a' });
    // Una pestaña que no existe no cambia nada.
    expect(aplicar(w, { type: 'close', name: 'z' })).toBe(w);
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

describe('pestañas de seguimiento', () => {
  const agente = followKey('jdev-foo-1', 'agent', 'a0c02c');
  const shell = followKey('jdev-foo-1', 'shell', 'bx1');

  it('se abren junto a la última pestaña de su sesión, en orden, y quedan activas', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('jdev-foo-1', 'jdev-bar-2'), { type: 'openFollow', key: agente }, { type: 'openFollow', key: shell });
    expect(w.tabs).toEqual(['jdev-foo-1', agente, shell, 'jdev-bar-2']);
    expect(w.active).toBe(shell);
    // Abrir una ya abierta solo la activa.
    w = aplicar(w, { type: 'openFollow', key: agente });
    expect(w).toMatchObject({ tabs: ['jdev-foo-1', agente, shell, 'jdev-bar-2'], active: agente });
  });

  it('sin la pestaña de su sesión se añaden al final', () => {
    const w = aplicar(EMPTY_WORKSPACE, ...abrir('jdev-bar-2'), { type: 'openFollow', key: agente });
    expect(w.tabs).toEqual(['jdev-bar-2', agente]);
  });

  it('se cierran como las demás y ocupan hueco en las distribuciones de 1, 2 y 4', () => {
    let w = aplicar({ ...EMPTY_WORKSPACE, layout: 2 }, ...abrir('jdev-foo-1'), { type: 'openFollow', key: agente });
    expect(visibleTabs(w)).toEqual(['jdev-foo-1', agente]);
    w = aplicar(w, { type: 'layout', layout: 1 });
    expect(visibleTabs(w)).toEqual([agente]);
    w = aplicar(w, { type: 'layout', layout: 4 }, { type: 'close', name: agente });
    expect(w).toMatchObject({ tabs: ['jdev-foo-1'], active: 'jdev-foo-1' });
  });

  it('prune las conserva mientras viva su sesión y las retira con ella', () => {
    const w = aplicar(EMPTY_WORKSPACE, ...abrir('jdev-foo-1'), { type: 'openFollow', key: agente });
    expect(aplicar(w, { type: 'prune', alive: new Set(['jdev-foo-1']) })).toBe(w);
    expect(aplicar(w, { type: 'prune', alive: new Set(['jdev-otra-3']) }).tabs).toEqual([]);
  });

  it('al cargar se descartan las claves de seguimiento mal formadas y se recuerdan las buenas', () => {
    const w = parseWorkspace(JSON.stringify({ tabs: ['jdev-foo-1', agente, 'follow:../x:agent:y', 'follow:jdev-foo-1:otro:a'], active: agente, layout: 2, start: 0 }));
    expect(w?.tabs).toEqual(['jdev-foo-1', agente]);
    expect(w?.active).toBe(agente);
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
    expect(loadUiPrefs(roto)).toEqual({ contextOpen: true, hideDone: false });
  });

  it('preferencias de interfaz', () => {
    saveUiPrefs({ contextOpen: false, hideDone: true });
    expect(loadUiPrefs()).toEqual({ contextOpen: false, hideDone: true });
    localStorage.setItem('jdev-panel:ui', '{"contextOpen":"sí"}');
    expect(loadUiPrefs()).toEqual({ contextOpen: true, hideDone: false });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('migra la preferencia anterior hideClosed a hideDone', () => {
    localStorage.setItem('jdev-panel:ui', '{"contextOpen":false,"hideClosed":true}');
    expect(loadUiPrefs()).toEqual({ contextOpen: false, hideDone: true });
    // La nueva manda si conviven.
    localStorage.setItem('jdev-panel:ui', '{"contextOpen":true,"hideClosed":true,"hideDone":false}');
    expect(loadUiPrefs()).toEqual({ contextOpen: true, hideDone: false });
    // Al guardar desaparece el nombre anterior.
    saveUiPrefs(loadUiPrefs());
    expect(localStorage.getItem('jdev-panel:ui')).toBe('{"contextOpen":true,"hideDone":false}');
  });
});

describe('vista de cada pestaña (terminal o chat)', () => {
  it('por defecto todas se ven como terminal y se puede cambiar por pestaña', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b'));
    expect(viewOf(w, 'a')).toBe('terminal');
    w = workspaceReducer(w, { type: 'view', name: 'a', view: 'chat' });
    expect(viewOf(w, 'a')).toBe('chat');
    expect(viewOf(w, 'b')).toBe('terminal');
    w = workspaceReducer(w, { type: 'view', name: 'a', view: 'terminal' });
    expect(viewOf(w, 'a')).toBe('terminal');
    // Sin ninguna en chat, el campo desaparece: el estado queda igual que antes de existir.
    expect('chatTabs' in w).toBe(false);
  });

  it('ignora pestañas que no están abiertas y olvida la vista al cerrar o podar', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b'));
    expect(workspaceReducer(w, { type: 'view', name: 'zzz', view: 'chat' })).toBe(w);
    w = workspaceReducer(workspaceReducer(w, { type: 'view', name: 'a', view: 'chat' }), { type: 'view', name: 'b', view: 'chat' });
    expect(w.chatTabs).toEqual(['a', 'b']);
    w = workspaceReducer(w, { type: 'close', name: 'a' });
    expect(w.chatTabs).toEqual(['b']);
    w = workspaceReducer(w, { type: 'prune', alive: new Set<string>() });
    expect(w.chatTabs).toBeUndefined();
  });

  it('sobrevive a guardar y recargar; el estado viejo sin el campo se ve como terminal', () => {
    let w = aplicar(EMPTY_WORKSPACE, ...abrir('a', 'b'));
    w = workspaceReducer(w, { type: 'view', name: 'b', view: 'chat' });
    const vuelto = parseWorkspace(JSON.stringify(w))!;
    expect(viewOf(vuelto, 'b')).toBe('chat');
    expect(viewOf(vuelto, 'a')).toBe('terminal');
    const viejo = parseWorkspace(JSON.stringify({ tabs: ['a', 'b'], active: 'a', layout: 2, start: 0 }))!;
    expect(viewOf(viejo, 'a')).toBe('terminal');
    expect(viejo.chatTabs).toBeUndefined();
    // Basura y pestañas que ya no están se descartan.
    const raro = parseWorkspace(JSON.stringify({ tabs: ['a'], active: 'a', layout: 1, start: 0, chatTabs: ['a', 'x', 3, 'a'] }))!;
    expect(raro.chatTabs).toEqual(['a']);
  });
});

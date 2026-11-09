// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { isSlashCommand, parseBtw } from '../../shared/chat.ts';
import { addBtw, btwOutcome, forgetBtw, groupBtwByAnchor, removeBtw, updateBtw, useBtwBlocks } from './btw.ts';
import type { BtwBlock } from './btw.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const S = 'jdev-x-1';
afterEach(() => forgetBtw(S));

/** Lo último que ve un componente que usa el hook. */
function observa(): { ultimo: () => readonly BtwBlock[]; fin: () => void } {
  let visto: readonly BtwBlock[] = [];
  const Comp = () => {
    visto = useBtwBlocks(S);
    return null;
  };
  const el = document.createElement('div');
  const raiz = createRoot(el);
  act(() => raiz.render(createElement(Comp)));
  return { ultimo: () => visto, fin: () => act(() => raiz.unmount()) };
}

describe('btwOutcome', () => {
  it('con respuesta: hecho, y conserva si puede estar incompleta', () => {
    expect(btwOutcome({ sent: true, btw: { question: 'q', answer: 'a', truncated: true } })).toEqual({ state: 'done', answer: 'a', truncated: true });
  });
  it('sin respuesta: pendiente si la ventana sigue abierta, vacío si no', () => {
    expect(btwOutcome({ sent: true, btw: null, pending: true }).state).toBe('pending');
    expect(btwOutcome({ sent: true, btw: null }).state).toBe('empty');
    expect(btwOutcome({ sent: true }).state).toBe('empty');
  });
});

describe('bloques de /btw por sesión', () => {
  it('añade esperando, se actualiza con la respuesta y se quita', () => {
    const o = observa();
    act(() => void addBtw(S, { question: '¿q?', sessionId: 's1', anchor: 3 }));
    expect(o.ultimo()).toHaveLength(1);
    expect(o.ultimo()[0]).toMatchObject({ question: '¿q?', anchor: 3, state: 'waiting', answer: '' });
    act(() => updateBtw(S, o.ultimo()[0]!.id, { state: 'done', answer: 'respuesta' }));
    expect(o.ultimo()[0]).toMatchObject({ state: 'done', answer: 'respuesta' });
    act(() => removeBtw(S, o.ultimo()[0]!.id));
    expect(o.ultimo()).toHaveLength(0);
    o.fin();
  });

  it('actualizar o quitar uno que no existe no cambia nada; olvidar la sesión los borra', () => {
    const o = observa();
    act(() => void addBtw(S, { question: 'a', sessionId: null, anchor: 0 }));
    const antes = o.ultimo();
    act(() => updateBtw(S, 'nada', { state: 'done' }));
    act(() => removeBtw(S, 'nada'));
    expect(o.ultimo()).toBe(antes);
    act(() => forgetBtw(S));
    expect(o.ultimo()).toHaveLength(0);
    o.fin();
  });

  it('guarda como mucho los últimos 20', () => {
    const o = observa();
    act(() => {
      for (let i = 0; i < 25; i++) addBtw(S, { question: `q${i}`, sessionId: null, anchor: i });
    });
    expect(o.ultimo()).toHaveLength(20);
    expect(o.ultimo()[0]!.question).toBe('q5');
    o.fin();
  });
});

describe('groupBtwByAnchor', () => {
  const b = (id: string, anchor: number, sessionId: string | null): BtwBlock => ({ id, question: id, sessionId, anchor, state: 'done', answer: '', truncated: false });
  it('agrupa por punto, acota al total y oculta los de otra sesión de Claude', () => {
    const g = groupBtwByAnchor([b('a', 2, 's1'), b('b', 2, 's1'), b('c', 9, 's1'), b('d', 1, 's0')], 's1', 5);
    expect([...g.entries()].map(([k, v]) => [k, v.map((x) => x.id)])).toEqual([
      [2, ['a', 'b']],
      [5, ['c']],
    ]);
  });
});

describe('parseBtw e isSlashCommand', () => {
  it('reconoce /btw con pregunta, solo, con espacios y con varias líneas; no /btwx ni otros comandos', () => {
    expect(parseBtw('/btw ¿qué es esto?')).toEqual({ question: '¿qué es esto?' });
    expect(parseBtw('  /btw   hola  \n')).toEqual({ question: 'hola' });
    expect(parseBtw('/btw línea 1\nlínea 2')).toEqual({ question: 'línea 1\nlínea 2' });
    expect(parseBtw('/btw')).toEqual({ question: '' });
    expect(parseBtw('/btwx hola')).toBeNull();
    expect(parseBtw('hola /btw que')).toBeNull();
    expect(parseBtw('/goal close')).toBeNull();
  });

  it('un comando es /nombre con o sin argumentos, no una ruta', () => {
    for (const c of ['/goal close', '/compact', '/mcp__srv__x a', '/plugin:skill args', '  /clear  ']) expect(isSlashCommand(c), c).toBe(true);
    for (const c of ['/home/u/archivo.ts falla', '/', '//x', 'hola /goal', '/1abc']) expect(isSlashCommand(c), c).toBe(false);
  });
});

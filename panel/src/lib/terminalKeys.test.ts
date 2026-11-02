import { describe, expect, it } from 'vitest';
import { DELETE_WORD_BACK, DELETE_WORD_FORWARD, translateTerminalKey } from './terminalKeys.ts';

const tecla = (key: string, m: Record<string, unknown> = {}) => ({
  type: 'keydown',
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...m,
});

describe('translateTerminalKey', () => {
  it('Ctrl+Retroceso borra la palabra anterior (Ctrl+W)', () => {
    expect(translateTerminalKey(tecla('Backspace', { ctrlKey: true }))).toEqual({ send: DELETE_WORD_BACK });
    expect(DELETE_WORD_BACK).toBe('\x17');
  });

  it('Ctrl+Supr borra la palabra siguiente (Alt+D)', () => {
    expect(translateTerminalKey(tecla('Delete', { ctrlKey: true }))).toEqual({ send: DELETE_WORD_FORWARD });
    expect(DELETE_WORD_FORWARD).toBe('\x1bd');
  });

  it('Mayús+RePág y Mayús+AvPág llegan a tmux como S-PPage y S-NPage', () => {
    expect(translateTerminalKey(tecla('PageUp', { shiftKey: true }))).toEqual({ send: '\x1b[5;2~', scroll: true });
    expect(translateTerminalKey(tecla('PageDown', { shiftKey: true }))).toEqual({ send: '\x1b[6;2~', scroll: true });
  });

  it('no toca Retroceso, Supr ni RePág/AvPág sin modificadores', () => {
    for (const k of ['Backspace', 'Delete', 'PageUp', 'PageDown', 'a', 'Enter']) expect(translateTerminalKey(tecla(k))).toBeNull();
  });

  it('con Alt o Meta no actúa (Alt+Retroceso, Ctrl+Alt+Retroceso, Cmd+Retroceso)', () => {
    expect(translateTerminalKey(tecla('Backspace', { altKey: true }))).toBeNull();
    expect(translateTerminalKey(tecla('Backspace', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(translateTerminalKey(tecla('Delete', { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(translateTerminalKey(tecla('Backspace', { metaKey: true }))).toBeNull();
  });

  it('no afecta a AltGr aunque el navegador lo notifique como Ctrl+Alt', () => {
    expect(translateTerminalKey(tecla('Backspace', { ctrlKey: true, getModifierState: (k: string) => k === 'AltGraph' }))).toBeNull();
  });

  it('solo actúa en keydown y fuera de una composición', () => {
    expect(translateTerminalKey(tecla('Backspace', { ctrlKey: true, type: 'keyup' }))).toBeNull();
    expect(translateTerminalKey(tecla('Backspace', { ctrlKey: true, type: 'keypress' }))).toBeNull();
    expect(translateTerminalKey(tecla('Backspace', { ctrlKey: true, isComposing: true }))).toBeNull();
  });

  it('no mezcla otras teclas con Ctrl o Mayús', () => {
    expect(translateTerminalKey(tecla('a', { ctrlKey: true }))).toBeNull();
    expect(translateTerminalKey(tecla('Home', { shiftKey: true }))).toBeNull();
    expect(translateTerminalKey(tecla('PageUp', { shiftKey: true, ctrlKey: true }))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { nextRadioIndex } from './radio.ts';

describe('nextRadioIndex', () => {
  const libres = [false, false, false];

  it('avanza y retrocede con vuelta al principio', () => {
    expect(nextRadioIndex('ArrowRight', 0, libres)).toBe(1);
    expect(nextRadioIndex('ArrowDown', 2, libres)).toBe(0);
    expect(nextRadioIndex('ArrowLeft', 0, libres)).toBe(2);
    expect(nextRadioIndex('ArrowUp', 1, libres)).toBe(0);
  });

  it('salta los deshabilitados', () => {
    expect(nextRadioIndex('ArrowRight', 0, [false, true, false])).toBe(2);
    expect(nextRadioIndex('ArrowLeft', 2, [false, true, false])).toBe(0);
  });

  it('Inicio y Fin van al primero y último habilitados', () => {
    expect(nextRadioIndex('Home', 2, [true, false, false])).toBe(1);
    expect(nextRadioIndex('End', 0, [false, false, true])).toBe(1);
  });

  it('ignora otras teclas y no navega si no hay otro destino', () => {
    expect(nextRadioIndex('a', 0, libres)).toBeNull();
    expect(nextRadioIndex('Enter', 0, libres)).toBeNull();
    expect(nextRadioIndex('ArrowRight', 0, [false, true, true])).toBe(0);
    expect(nextRadioIndex('ArrowRight', 0, [true, true, true])).toBeNull();
  });
});

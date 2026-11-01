import { describe, expect, it } from 'vitest';
import { integerError } from './validation.ts';

describe('integerError', () => {
  it('acepta enteros dentro del rango, extremos incluidos', () => {
    expect(integerError('100', 100, 100000)).toBeNull();
    expect(integerError('100000', 100, 100000)).toBeNull();
    expect(integerError('5000', 100, 100000)).toBeNull();
  });

  it('rechaza vacíos, decimales, negativos y valores fuera de rango con el rango en el mensaje', () => {
    for (const malo of ['', 'abc', '12,5', '-5', '99', '100001', '1e3']) {
      expect(integerError(malo, 100, 100000)).toBe('Escribe un número entero entre 100 y 100000.');
    }
  });
});

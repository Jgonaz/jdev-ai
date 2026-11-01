import { describe, expect, it } from 'vitest';
import { formatRelative, greeting } from './time.ts';

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const AHORA = 1_000_000_000_000;

describe('formatRelative', () => {
  it.each([
    [0, 'ahora'],
    [30_000, 'ahora'],
    [45_000, '1 min'],
    [3 * MIN, '3 min'],
    [59 * MIN, '59 min'],
    [2 * H, '2 h'],
    [23 * H, '23 h'],
    [D, 'ayer'],
    [2 * D, '2 d'],
    [29 * D, '29 d'],
    [45 * D, '1 mes'],
    [400 * D, '1 a'],
  ])('hace %i ms → %s', (dif, esperado) => {
    expect(formatRelative(AHORA - dif, AHORA)).toBe(esperado);
  });

  it('una fecha futura (reloj desajustado) cuenta como ahora', () => {
    expect(formatRelative(AHORA + 5 * MIN, AHORA)).toBe('ahora');
  });
});

describe('greeting', () => {
  it.each([
    [7, 'Buenos días'],
    [12, 'Buenos días'],
    [15, 'Buenas tardes'],
    [22, 'Buenas noches'],
    [3, 'Buenas noches'],
  ])('a las %i h', (hora, esperado) => {
    expect(greeting(new Date(2026, 10, 1, hora))).toBe(esperado);
  });
});

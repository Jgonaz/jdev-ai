import { describe, expect, it } from 'vitest';
import { dropIndex } from './tabDrag.ts';

describe('dropIndex', () => {
  it('cuenta los centros que quedan a la izquierda del puntero', () => {
    expect(dropIndex(5, [50, 150, 250])).toBe(0);
    expect(dropIndex(100, [50, 150, 250])).toBe(1);
    expect(dropIndex(300, [50, 150, 250])).toBe(3);
    expect(dropIndex(10, [])).toBe(0);
  });
});

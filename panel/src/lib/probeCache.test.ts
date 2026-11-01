import { describe, expect, it } from 'vitest';
import { createProbeCache } from './probeCache.ts';

describe('createProbeCache', () => {
  it('reutiliza la promesa de la misma clave mientras no caduca', async () => {
    let t = 0;
    let llamadas = 0;
    const c = createProbeCache<number>({ ttlMs: 100, now: () => t });
    const cargar = () => Promise.resolve(++llamadas);
    expect(await c.get('a', cargar)).toBe(1);
    expect(await c.get('a', cargar)).toBe(1);
    t = 150;
    expect(await c.get('a', cargar)).toBe(2);
  });

  it('no recuerda los errores', async () => {
    const c = createProbeCache<number>();
    await expect(c.get('a', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await new Promise((r) => setTimeout(r, 0));
    expect(await c.get('a', () => Promise.resolve(7))).toBe(7);
  });

  it('descarta las más antiguas al pasar el máximo', async () => {
    let llamadas = 0;
    const c = createProbeCache<number>({ max: 2 });
    const cargar = () => Promise.resolve(++llamadas);
    await c.get('a', cargar);
    await c.get('b', cargar);
    await c.get('c', cargar);
    expect(await c.get('a', cargar)).toBe(4);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { noteServerTime, serverNow } from './serverClock.ts';

describe('serverClock', () => {
  afterEach(() => noteServerTime(String(Date.now()), Date.now(), Date.now()));

  it('aplica el desfase del servidor respecto al navegador (WSL adelantado 94 s)', () => {
    const t = Date.now();
    noteServerTime(String(t + 94_000), t - 10, t + 10);
    expect(serverNow() - Date.now()).toBeGreaterThan(93_000);
    expect(serverNow() - Date.now()).toBeLessThan(95_000);
  });

  it('ignora desfases menores de un segundo y cabeceras ausentes o inválidas', () => {
    const t = Date.now();
    noteServerTime(String(t + 300), t, t);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(50);
    noteServerTime(String(t - 60_000), t, t);
    noteServerTime(null, t, t);
    noteServerTime('abc', t, t);
    expect(Date.now() - serverNow()).toBeGreaterThan(59_000);
  });
});

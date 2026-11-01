import { describe, expect, it } from 'vitest';
import { NewImageDetector, SEEN_TTL_MS, scanRange } from './newImages.ts';

const nunca = () => false;

describe('scanRange', () => {
  it('revisa la pantalla más las líneas que han entrado desde la última vez', () => {
    expect(scanRange(1000, 30, 0)).toEqual({ from: 970, to: 1000 });
    expect(scanRange(1000, 30, 12)).toEqual({ from: 958, to: 1000 });
  });
  it('no pasa del principio del búfer ni del tope', () => {
    expect(scanRange(20, 30, 5)).toEqual({ from: 0, to: 20 });
    expect(scanRange(100000, 30, 90000, 400)).toEqual({ from: 99600, to: 100000 });
  });
  it('en la pantalla alternativa (sin historial) revisa toda la pantalla', () => {
    expect(scanRange(30, 30, 0)).toEqual({ from: 0, to: 30 });
  });
});

describe('NewImageDetector', () => {
  it('anuncia las rutas nuevas en orden y sin repetir', () => {
    const d = new NewImageDetector();
    expect(d.detect(['/tmp/a.png', '/tmp/b.png', '/tmp/a.png'], 0, nunca)).toEqual(['/tmp/a.png', '/tmp/b.png']);
  });

  it('ignora el contenido inicial (búfer base)', () => {
    const d = new NewImageDetector();
    d.baseline(['/tmp/vieja.png', '/tmp/../tmp/otra.png']);
    expect(d.detect(['/tmp/vieja.png', '/tmp/otra.png', '/tmp/nueva.png'], 10, nunca)).toEqual(['/tmp/nueva.png']);
    // El contenido inicial no caduca.
    expect(d.detect(['/tmp/vieja.png'], 10 * SEEN_TTL_MS, nunca)).toEqual([]);
  });

  it('un redibujado que reimprime las mismas rutas no las vuelve a anunciar, y lo refresca', () => {
    const d = new NewImageDetector();
    expect(d.detect(['/tmp/a.png'], 0, nunca)).toEqual(['/tmp/a.png']);
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += SEEN_TTL_MS - 1000;
      expect(d.detect(['/tmp/a.png'], t, nunca)).toEqual([]);
    }
  });

  it('pasada la ventana sin verla, una ruta que no está en la tira vuelve a ser nueva', () => {
    const d = new NewImageDetector();
    d.detect(['/tmp/a.png'], 0, nunca);
    expect(d.detect(['/tmp/a.png'], SEEN_TTL_MS + 1, nunca)).toEqual(['/tmp/a.png']);
  });

  it('no anuncia lo que ya está en la tira', () => {
    const d = new NewImageDetector();
    expect(d.detect(['/tmp/a.png', '/tmp/b.png'], 0, (p) => p === '/tmp/a.png')).toEqual(['/tmp/b.png']);
  });

  it('dedupe por ruta resuelta: la relativa y la absoluta del mismo archivo cuentan una vez', () => {
    const d = new NewImageDetector();
    const nuevas = d.detect(['shots/a.png', '/work/shots/a.png'], 0, nunca);
    expect(nuevas).toEqual(['shots/a.png', '/work/shots/a.png']);
    const reclamadas = [d.claimResolved('shots/a.png', '/work/shots/a.png', 1, nunca), d.claimResolved('/work/shots/a.png', '/work/shots/a.png', 1, nunca)];
    expect(reclamadas.filter(Boolean)).toHaveLength(1);
  });

  it('una relativa que resuelve a una imagen ya vista o ya en la tira no se anuncia', () => {
    const d = new NewImageDetector();
    d.detect(['/work/a.png'], 0, nunca);
    expect(d.claimResolved('a.png', '/work/a.png', 1, nunca)).toBe(false);
    expect(d.claimResolved('b.png', '/work/b.png', 1, (p) => p === '/work/b.png')).toBe(false);
    expect(d.claimResolved('c.png', '/work/c.png', 1, nunca)).toBe(true);
  });

  it('una ruta del contenido inicial no se reclama al resolverla', () => {
    const d = new NewImageDetector();
    d.baseline(['/work/a.png']);
    expect(d.claimResolved('a.png', '/work/a.png', 1, nunca)).toBe(false);
  });
});

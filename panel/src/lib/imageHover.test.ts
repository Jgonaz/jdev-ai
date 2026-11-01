import { describe, expect, it } from 'vitest';
import { CARD_MAX, placeCard, rowBounds, thumbBox } from './imageHover.ts';

describe('thumbBox', () => {
  it('reduce la imagen para que quepa en 280 × 200 conservando la proporción', () => {
    expect(thumbBox({ width: 1280, height: 800 })).toEqual({ width: 280, height: 175 });
    expect(thumbBox({ width: 400, height: 800 })).toEqual({ width: 100, height: 200 });
  });
  it('no agranda las imágenes pequeñas', () => {
    expect(thumbBox({ width: 64, height: 32 })).toEqual({ width: 64, height: 32 });
  });
  it('reserva una caja mientras no se conocen las dimensiones', () => {
    const caja = thumbBox(null);
    expect(caja.width).toBe(CARD_MAX.width);
    expect(caja.height).toBeLessThanOrEqual(CARD_MAX.height);
    expect(thumbBox({ width: 0, height: 10 })).toEqual(caja);
  });
});

describe('placeCard', () => {
  const bounds = { width: 800, height: 500 };
  const card = { width: 300, height: 240 };

  it('prefiere debajo de la fila del enlace', () => {
    const p = placeCard({ left: 100, top: 40, bottom: 58 }, card, bounds);
    expect(p).toEqual({ left: 100, top: 64, side: 'below' });
  });

  it('pasa encima si debajo no cabe', () => {
    const p = placeCard({ left: 100, top: 440, bottom: 458 }, card, bounds);
    expect(p.side).toBe('above');
    expect(p.top).toBe(440 - 6 - 240);
  });

  it('ajusta a los bordes derecho e izquierdo', () => {
    expect(placeCard({ left: 700, top: 40, bottom: 58 }, card, bounds).left).toBe(800 - 300 - 4);
    expect(placeCard({ left: -20, top: 40, bottom: 58 }, card, bounds).left).toBe(4);
  });

  it('si no cabe en ningún lado, elige el de más sitio y no se sale del contenedor', () => {
    const baja = { width: 800, height: 260 };
    const p = placeCard({ left: 10, top: 150, bottom: 168 }, card, baja);
    expect(p.top).toBeGreaterThanOrEqual(4);
    expect(p.top + card.height).toBeLessThanOrEqual(baja.height - 4);
    expect(p.side).toBe('above');
  });

  it('con una tarjeta más ancha que el contenedor queda pegada al margen', () => {
    expect(placeCard({ left: 50, top: 40, bottom: 58 }, { width: 900, height: 50 }, bounds).left).toBe(4);
  });
});

describe('rowBounds', () => {
  it('da los límites de la fila bajo el puntero', () => {
    // 10 filas de 20 px desde y = 100.
    expect(rowBounds(100, 200, 10, 145)).toEqual({ top: 140, bottom: 160 });
    expect(rowBounds(100, 200, 10, 100)).toEqual({ top: 100, bottom: 120 });
  });
  it('limita la fila a la pantalla', () => {
    expect(rowBounds(100, 200, 10, 999)).toEqual({ top: 280, bottom: 300 });
    expect(rowBounds(100, 200, 10, 0)).toEqual({ top: 100, bottom: 120 });
  });
  it('sin medidas devuelve la posición del puntero', () => {
    expect(rowBounds(0, 0, 0, 33)).toEqual({ top: 33, bottom: 33 });
  });
});

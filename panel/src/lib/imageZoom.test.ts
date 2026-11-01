import { describe, expect, it } from 'vitest';
import { AREA_PADDING, MAX_SCALE, MIN_SCALE, clampScale, scrollAfterZoom, describeMeta, fitScale, formatBytes, parseImageHeaders, percent, stepScale, wheelScale } from './imageZoom.ts';

describe('fitScale', () => {
  it('reduce una imagen grande para que quepa', () => {
    expect(fitScale({ width: 1179, height: 2556 }, { width: 488, height: 512 })).toBeCloseTo(512 / 2556, 5);
    expect(fitScale({ width: 2000, height: 500 }, { width: 400, height: 400 })).toBeCloseTo(0.2, 5);
  });
  it('no agranda las pequeñas', () => {
    expect(fitScale({ width: 100, height: 80 }, { width: 400, height: 400 })).toBe(1);
  });
  it('con medidas desconocidas o nulas usa el 100 %', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
  it('nunca baja del mínimo', () => {
    expect(fitScale({ width: 100000, height: 100000 }, { width: 10, height: 10 })).toBe(MIN_SCALE);
  });
});

describe('stepScale', () => {
  it('acerca y aleja por escalones', () => {
    expect(stepScale(1, 1)).toBe(1.5);
    expect(stepScale(1, -1)).toBe(0.75);
    expect(stepScale(0.32, 1)).toBe(0.33);
    expect(stepScale(0.32, -1)).toBe(0.25);
  });
  it('un valor ya en un escalón pasa al siguiente aunque tenga error de redondeo', () => {
    expect(stepScale(0.3300001, 1)).toBe(0.5);
    expect(stepScale(0.5, -1)).toBe(0.33);
  });
  it('se detiene en los extremos', () => {
    expect(stepScale(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(stepScale(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });
});

describe('wheelScale', () => {
  it('girar hacia arriba acerca y hacia abajo aleja', () => {
    expect(wheelScale(1, -100)).toBeGreaterThan(1);
    expect(wheelScale(1, 100)).toBeLessThan(1);
    expect(wheelScale(1, 0)).toBe(1);
  });
  it('se acota', () => {
    expect(wheelScale(7, -4000)).toBe(MAX_SCALE);
    expect(wheelScale(0.06, 4000)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
  });
});

describe('formatos', () => {
  it('porcentaje y tamaños', () => {
    expect(percent(0.3204)).toBe('32 %');
    expect(percent(1)).toBe('100 %');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(412 * 1024)).toBe('412 KB');
    expect(formatBytes(1.25 * 1048576)).toBe('1,3 MB');
  });
  it('lee las cabeceras de HEAD y compone la línea de la cabecera del visor', () => {
    const h = new Headers({ 'X-Image-Size': '421888', 'X-Image-Width': '1179', 'X-Image-Height': '2556' });
    const meta = parseImageHeaders(h);
    expect(meta).toEqual({ size: 421888, width: 1179, height: 2556, path: null });
    expect(describeMeta(meta)).toBe('1179 × 2556 · 412 KB');
  });
  it('decodifica la ruta real de X-Image-Path y rechaza lo que no sea absoluto o esté mal codificado', () => {
    const real = '/tmp/captura ñandú ✓.png';
    expect(parseImageHeaders(new Headers({ 'X-Image-Path': encodeURIComponent(real) })).path).toBe(real);
    expect(parseImageHeaders(new Headers({ 'X-Image-Path': 'relativa.png' })).path).toBeNull();
    expect(parseImageHeaders(new Headers({ 'X-Image-Path': '%E0%A4%A' })).path).toBeNull();
  });
  it('sin dimensiones (SVG) usa las naturales y sin nada solo el tamaño', () => {
    const meta = parseImageHeaders(new Headers({ 'Content-Length': '2048' }));
    expect(meta).toEqual({ size: 2048, width: null, height: null, path: null });
    expect(describeMeta(meta)).toBe('2 KB');
    expect(describeMeta(meta, { width: 300, height: 150 })).toBe('300 × 150 · 2 KB');
    expect(describeMeta(null)).toBe('');
  });
});

describe('scrollAfterZoom', () => {
  const P = AREA_PADDING;
  // Área de 400 px: 368 útiles.
  it('de una imagen que cabe a otra mayor la deja centrada', () => {
    // 200 px centrada (scroll 0) pasa a 1000 px: el centro de la imagen queda en el centro de la vista.
    const scroll = scrollAfterZoom(0, 400, 200, 1000);
    expect(scroll).toBeCloseTo(P + 500 - 200, 5);
  });
  it('mantiene el punto central cuando ya hay desplazamiento', () => {
    // Imagen de 1000 px, vista en el 30 % (scroll tal que el centro cae en P + 300).
    const scroll = scrollAfterZoom(P + 300 - 200, 400, 1000, 2000);
    expect(scroll + 200).toBeCloseTo(P + 600, 5);
  });
  it('al alejar hasta que cabe, el desplazamiento es 0 (la imagen se centra sola)', () => {
    expect(scrollAfterZoom(300, 400, 1000, 200)).toBe(0);
  });
  it('entre dos tamaños que caben no se desplaza', () => {
    expect(scrollAfterZoom(0, 400, 100, 300)).toBe(0);
  });
  it('un zoom que desborda en un eje y cabe en el otro funciona por ejes', () => {
    expect(scrollAfterZoom(0, 400, 368, 368)).toBe(0);
    expect(scrollAfterZoom(0, 400, 368, 736)).toBeCloseTo(P + 368 - 200, 5);
  });
  it('con medidas inválidas no se mueve', () => {
    expect(scrollAfterZoom(50, 400, 0, 100)).toBe(50);
    expect(scrollAfterZoom(50, 0, 100, 200)).toBe(50);
  });
});

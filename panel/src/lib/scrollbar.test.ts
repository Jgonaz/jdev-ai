import { describe, expect, it } from 'vitest';
import { MIN_THUMB_PX, appScroll, appTrackClickAction, barVisible, isShiftPage, positionFromThumbTop, shouldPoll, thumbGeometry, topLine, trackClickAction } from './scrollbar.ts';
import type { ScrollState } from './scrollbar.ts';

const estado = (p: Partial<ScrollState> = {}): ScrollState => ({ inMode: true, position: 0, history: 976, height: 24, alternate: false, ...p });

describe('thumbGeometry', () => {
  it('abajo del todo el pulgar toca el final de la pista y su tamaño es la fracción visible', () => {
    const t = thumbGeometry(estado({ inMode: false, position: 0 }), 500);
    expect(t.size).toBe(MIN_THUMB_PX); // 24 / 1000 * 500 = 12, por debajo del mínimo
    expect(t.top + t.size).toBe(500);
    const grande = thumbGeometry(estado({ history: 76, position: 0 }), 500);
    expect(grande.size).toBe(120); // 24 / 100 * 500
    expect(grande.top + grande.size).toBe(500);
  });

  it('arriba del todo el pulgar está en 0', () => {
    expect(thumbGeometry(estado({ position: 976 }), 500).top).toBe(0);
  });

  it('respeta el tamaño mínimo y nunca se sale de la pista', () => {
    const t = thumbGeometry(estado({ history: 100000, position: 50000 }), 300);
    expect(t.size).toBe(MIN_THUMB_PX);
    expect(t.top).toBeGreaterThanOrEqual(0);
    expect(t.top + t.size).toBeLessThanOrEqual(300);
    expect(thumbGeometry(estado(), 10).size).toBe(10); // pista menor que el mínimo
  });

  it('sin historial o sin pista, el pulgar ocupa la pista entera', () => {
    expect(thumbGeometry(estado({ history: 0 }), 200)).toEqual({ top: 0, size: 200 });
    expect(thumbGeometry(estado(), 0)).toEqual({ top: 0, size: 0 });
  });

  it('acota una posición mayor que el historial', () => {
    expect(thumbGeometry(estado({ position: 99999 }), 500).top).toBe(0);
  });
});

describe('positionFromThumbTop', () => {
  it('es la inversa de thumbGeometry (con el redondeo de píxeles)', () => {
    for (const position of [0, 1, 100, 488, 975, 976]) {
      const s = estado({ position });
      const t = thumbGeometry(s, 500);
      const vuelta = positionFromThumbTop(t.top, t.size, 500, s.history);
      // Un píxel de la pista equivale a unas 976 / (500 - 24) ≈ 2 líneas.
      expect(Math.abs(vuelta - position), `position ${position}`).toBeLessThanOrEqual(Math.ceil(s.history / (500 - t.size)));
    }
  });

  it('arriba del todo es el historial entero y abajo del todo es 0', () => {
    expect(positionFromThumbTop(0, 24, 500, 976)).toBe(976);
    expect(positionFromThumbTop(476, 24, 500, 976)).toBe(0);
  });

  it('acota arrastres fuera de la pista', () => {
    expect(positionFromThumbTop(-50, 24, 500, 976)).toBe(976);
    expect(positionFromThumbTop(9999, 24, 500, 976)).toBe(0);
  });

  it('sin recorrido o sin historial devuelve 0', () => {
    expect(positionFromThumbTop(10, 500, 500, 976)).toBe(0);
    expect(positionFromThumbTop(10, 24, 500, 0)).toBe(0);
  });
});

describe('topLine', () => {
  it('cuenta desde la línea más antigua y se acota', () => {
    expect(topLine({ history: 100, position: 100 })).toBe(0);
    expect(topLine({ history: 100, position: 0 })).toBe(100);
    expect(topLine({ history: 100, position: 400 })).toBe(0);
    expect(topLine({ history: 100, position: -3 })).toBe(100);
  });
});

describe('trackClickAction', () => {
  const t = { top: 100, size: 40 };
  it('página arriba por encima del pulgar, abajo por debajo y nada sobre él', () => {
    expect(trackClickAction(50, t)).toBe('page-up');
    expect(trackClickAction(99, t)).toBe('page-up');
    expect(trackClickAction(100, t)).toBeNull();
    expect(trackClickAction(140, t)).toBeNull();
    expect(trackClickAction(141, t)).toBe('page-down');
  });
});

describe('shouldPoll y barVisible', () => {
  it('no sondea en reposo ni con la terminal oculta', () => {
    expect(shouldPoll({ inMode: false, hovering: false, dragging: false, visible: true })).toBe(false);
    expect(shouldPoll({ inMode: true, hovering: false, dragging: false, visible: true })).toBe(true);
    expect(shouldPoll({ inMode: false, hovering: true, dragging: false, visible: true })).toBe(true);
    expect(shouldPoll({ inMode: false, hovering: false, dragging: true, visible: true })).toBe(true);
    expect(shouldPoll({ inMode: true, hovering: true, dragging: true, visible: false })).toBe(false);
  });

  it('la barra se oculta sin historial', () => {
    expect(barVisible(null)).toBe(false);
    expect(barVisible(estado({ history: 0 }))).toBe(false);
    expect(barVisible(estado({ history: 1 }))).toBe(true);
  });

  it('en pantalla alternativa se muestra aunque tmux no tenga historial', () => {
    expect(barVisible(estado({ history: 0, alternate: true, inMode: false }))).toBe(true);
  });
});

describe('scroll de la aplicación (pantalla alternativa)', () => {
  it('solo manda teclas a la aplicación si tmux no está en copy-mode', () => {
    expect(appScroll(null)).toBe(false);
    expect(appScroll(estado({ alternate: true, inMode: false }))).toBe(true);
    expect(appScroll(estado({ alternate: true, inMode: true }))).toBe(false);
    expect(appScroll(estado({ alternate: false, inMode: false }))).toBe(false);
  });

  it('la mitad de arriba de la pista pagina hacia arriba y la de abajo hacia abajo', () => {
    expect(appTrackClickAction(10, 200)).toBe('page-up');
    expect(appTrackClickAction(150, 200)).toBe('page-down');
  });
});

describe('isShiftPage', () => {
  const tecla = (key: string, m: Partial<KeyboardEvent> = {}) => ({ key, shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, ...m });
  it('reconoce Mayús+RePág y Mayús+AvPág y nada más', () => {
    expect(isShiftPage(tecla('PageUp'))).toBe(true);
    expect(isShiftPage(tecla('PageDown'))).toBe(true);
    expect(isShiftPage(tecla('PageUp', { shiftKey: false }))).toBe(false);
    expect(isShiftPage(tecla('PageUp', { ctrlKey: true }))).toBe(false);
    expect(isShiftPage(tecla('Home'))).toBe(false);
  });
});

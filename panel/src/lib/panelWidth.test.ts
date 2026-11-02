import { describe, expect, it } from 'vitest';
import {
  CENTER_MIN,
  PANEL_WIDTHS_KEY,
  clampWidth,
  dragWidth,
  effectiveMax,
  keyboardWidth,
  loadPanelWidth,
  parsePanelWidths,
  savePanelWidth,
} from './panelWidth.ts';
import type { PanelLimits } from './panelWidth.ts';

const limites: PanelLimits = { min: 200, max: 480, default: 280 };

const almacen = (inicial: Record<string, string> = {}) => {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k: string) => datos[k] ?? null,
    setItem: (k: string, v: string) => {
      datos[k] = v;
    },
  };
};

describe('clampWidth', () => {
  it('acota a los límites y redondea', () => {
    expect(clampWidth(100, 200, 480)).toBe(200);
    expect(clampWidth(900, 200, 480)).toBe(480);
    expect(clampWidth(300.6, 200, 480)).toBe(301);
  });
  it('un valor no numérico da el mínimo y un máximo menor que el mínimo no lo rompe', () => {
    expect(clampWidth(Number.NaN, 200, 480)).toBe(200);
    expect(clampWidth(Number.POSITIVE_INFINITY, 200, 480)).toBe(200);
    expect(clampWidth(300, 200, 100)).toBe(200);
  });
});

describe('effectiveMax', () => {
  it('deja al centro al menos su mínimo, descontando los otros paneles', () => {
    expect(effectiveMax(480, 200, 1400, 0)).toBe(480);
    expect(effectiveMax(480, 200, 800, 0)).toBe(800 - CENTER_MIN);
    expect(effectiveMax(720, 280, 1100, 320)).toBe(1100 - 320 - CENTER_MIN);
  });
  it('nunca baja del mínimo del panel, ni sin medida del contenedor', () => {
    expect(effectiveMax(480, 200, 500, 300)).toBe(200);
    expect(effectiveMax(480, 200, 0, 0)).toBe(480);
  });
});

describe('dragWidth', () => {
  it('un panel izquierdo crece al arrastrar a la derecha; uno derecho, al arrastrar a la izquierda', () => {
    expect(dragWidth(280, 40, 'left', 200, 480)).toBe(320);
    expect(dragWidth(280, -40, 'left', 200, 480)).toBe(240);
    expect(dragWidth(320, -40, 'right', 280, 720)).toBe(360);
    expect(dragWidth(320, 40, 'right', 280, 720)).toBe(280);
  });
  it('respeta mínimo y máximo', () => {
    expect(dragWidth(280, 1000, 'left', 200, 480)).toBe(480);
    expect(dragWidth(280, -1000, 'left', 200, 480)).toBe(200);
    expect(dragWidth(320, -1000, 'right', 280, 720)).toBe(720);
  });
});

describe('keyboardWidth', () => {
  it('las flechas mueven 16 px y Mayús 64 px, en la dirección del tirador', () => {
    expect(keyboardWidth('ArrowRight', false, 280, 'left', 200, 480)).toBe(296);
    expect(keyboardWidth('ArrowLeft', false, 280, 'left', 200, 480)).toBe(264);
    expect(keyboardWidth('ArrowRight', true, 280, 'left', 200, 480)).toBe(344);
    // En un panel derecho, → lo estrecha y ← lo ensancha.
    expect(keyboardWidth('ArrowRight', false, 320, 'right', 280, 720)).toBe(304);
    expect(keyboardWidth('ArrowLeft', true, 320, 'right', 280, 720)).toBe(384);
  });
  it('Inicio y Fin van al mínimo y al máximo; las flechas se detienen en los límites', () => {
    expect(keyboardWidth('Home', false, 300, 'left', 200, 480)).toBe(200);
    expect(keyboardWidth('End', false, 300, 'left', 200, 480)).toBe(480);
    expect(keyboardWidth('ArrowLeft', true, 210, 'left', 200, 480)).toBe(200);
    expect(keyboardWidth('ArrowRight', true, 470, 'left', 200, 480)).toBe(480);
  });
  it('ignora otras teclas', () => {
    expect(keyboardWidth('a', false, 300, 'left', 200, 480)).toBeNull();
    expect(keyboardWidth('ArrowUp', false, 300, 'left', 200, 480)).toBeNull();
  });
});

describe('persistencia de anchos', () => {
  it('guarda y recupera el ancho de cada panel por separado', () => {
    const s = almacen();
    savePanelWidth('terminales-izquierdo', 333, s);
    savePanelWidth('terminales-derecho', 410.4, s);
    expect(loadPanelWidth('terminales-izquierdo', limites, s)).toBe(333);
    expect(loadPanelWidth('terminales-derecho', { min: 280, max: 720, default: 320 }, s)).toBe(410);
    expect(loadPanelWidth('otro', limites, s)).toBeNull();
  });
  it('acota lo recordado a los límites actuales', () => {
    const s = almacen({ [PANEL_WIDTHS_KEY]: JSON.stringify({ a: 9999, b: 5 }) });
    expect(loadPanelWidth('a', limites, s)).toBe(480);
    expect(loadPanelWidth('b', limites, s)).toBe(200);
  });
  it('restablecer borra solo el recuerdo de ese panel', () => {
    const s = almacen();
    savePanelWidth('a', 300, s);
    savePanelWidth('b', 310, s);
    savePanelWidth('a', null, s);
    expect(loadPanelWidth('a', limites, s)).toBeNull();
    expect(loadPanelWidth('b', limites, s)).toBe(310);
  });
  it('un valor corrupto o con tipos erróneos se descarta', () => {
    expect(parsePanelWidths(null)).toEqual({});
    expect(parsePanelWidths('{no es json')).toEqual({});
    expect(parsePanelWidths('[1,2]')).toEqual({});
    expect(parsePanelWidths(JSON.stringify({ a: 'x', b: -3, c: 0, d: null, e: 250 }))).toEqual({ e: 250 });
  });
  it('si el almacenamiento lanza (modo privado) o no existe, no falla', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadPanelWidth('a', limites, roto)).toBeNull();
    expect(() => savePanelWidth('a', 300, roto)).not.toThrow();
    expect(loadPanelWidth('a', limites, null)).toBeNull();
    expect(() => savePanelWidth('a', 300, null)).not.toThrow();
  });
});

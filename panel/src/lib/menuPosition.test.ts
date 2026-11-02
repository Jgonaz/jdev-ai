import { describe, expect, it } from 'vitest';
import { clampMenu } from './menuPosition.ts';

const ventana = { width: 1000, height: 700 };

describe('clampMenu', () => {
  it('respeta el punto cuando el menú cabe', () => {
    expect(clampMenu(100, 120, 240, 180, ventana)).toEqual({ left: 100, top: 120 });
  });
  it('lo desplaza hacia dentro cuando se sale por la derecha o por abajo', () => {
    expect(clampMenu(950, 650, 240, 180, ventana)).toEqual({ left: 752, top: 512 });
  });
  it('no se sale por la izquierda ni por arriba', () => {
    expect(clampMenu(-20, -5, 240, 180, ventana)).toEqual({ left: 8, top: 8 });
  });
  it('si es mayor que la ventana, se pega al margen superior izquierdo', () => {
    expect(clampMenu(300, 300, 2000, 900, ventana)).toEqual({ left: 8, top: 8 });
  });
});

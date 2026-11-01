// Miniatura flotante al pasar el ratón por un enlace de imagen: tamaño de la
// imagen en la tarjeta y posición de la tarjeta. Funciones puras.

import type { Size } from './imageZoom.ts';

/** Tamaño máximo de la imagen dentro de la tarjeta. */
export const CARD_MAX: Size = { width: 280, height: 200 };
/** Espera con el ratón quieto sobre el enlace antes de mostrar la miniatura. */
export const HOVER_DELAY_MS = 250;
/** Alto reservado mientras no se conocen las dimensiones de la imagen. */
const PLACEHOLDER_HEIGHT = 120;

/** Caja de la imagen en la tarjeta: cabe en `max` sin agrandarse por encima de su tamaño natural. */
export function thumbBox(natural: Size | null, max: Size = CARD_MAX): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0) return { width: max.width, height: Math.min(max.height, PLACEHOLDER_HEIGHT) };
  const escala = Math.min(1, max.width / natural.width, max.height / natural.height);
  return { width: Math.max(1, Math.round(natural.width * escala)), height: Math.max(1, Math.round(natural.height * escala)) };
}

/** Punto de anclaje en el contenedor: x del puntero y límites verticales de la fila del enlace. */
export type Anchor = { left: number; top: number; bottom: number };

export type CardPlacement = { left: number; top: number; side: 'above' | 'below' };

/**
 * Posición de la tarjeta junto a la fila del enlace, sin salirse del contenedor.
 * Prefiere debajo; si no cabe, encima; si no cabe en ningún lado, donde haya más
 * sitio y ajustada a los bordes. Las coordenadas son relativas al contenedor.
 */
export function placeCard(anchor: Anchor, card: Size, bounds: Size, gap = 6, margin = 4): CardPlacement {
  const limite = (valor: number, tamano: number, total: number) => Math.max(margin, Math.min(valor, total - tamano - margin));
  const left = limite(anchor.left, card.width, bounds.width);
  const debajo = bounds.height - anchor.bottom - gap - margin;
  const encima = anchor.top - gap - margin;
  let side: 'above' | 'below';
  if (card.height <= debajo) side = 'below';
  else if (card.height <= encima) side = 'above';
  else side = debajo >= encima ? 'below' : 'above';
  const top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - card.height;
  return { left, top: limite(top, card.height, bounds.height), side };
}

/** Límites verticales (en el mismo sistema de coordenadas que `screenTop`) de la fila de terminal bajo `clientY`. */
export function rowBounds(screenTop: number, screenHeight: number, rows: number, clientY: number): { top: number; bottom: number } {
  if (rows <= 0 || screenHeight <= 0) return { top: clientY, bottom: clientY };
  const alto = screenHeight / rows;
  const fila = Math.min(rows - 1, Math.max(0, Math.floor((clientY - screenTop) / alto)));
  return { top: screenTop + fila * alto, bottom: screenTop + (fila + 1) * alto };
}

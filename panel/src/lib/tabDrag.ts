// Reordenar pestañas arrastrando con el ratón.

/** Píxeles que hay que mover el ratón con el botón pulsado para que el clic pase a ser un arrastre. */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Posición de destino de la pestaña arrastrada: cuántas de las demás tienen su
 * centro a la izquierda del puntero. Se mide con los centros de las otras
 * pestañas (no con la arrastrada), así que tras moverla el resultado no cambia
 * hasta que el puntero cruza otro centro: no oscila con pestañas de anchos
 * distintos.
 */
export function dropIndex(pointerX: number, otherCenters: readonly number[]): number {
  return otherCenters.filter((c) => c < pointerX).length;
}

/** Separación mínima entre un menú flotante y el borde de la ventana. */
export const MENU_MARGIN = 8;

/**
 * Esquina superior izquierda de un menú flotante de `ancho` × `alto` que se abre
 * en (x, y): se queda en el punto indicado y, si no cabe, se desplaza hacia
 * dentro de la ventana (sin pasar de MENU_MARGIN del borde; si es más grande
 * que la ventana, se pega al margen superior/izquierdo).
 */
export function clampMenu(
  x: number,
  y: number,
  ancho: number,
  alto: number,
  ventana: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.max(MENU_MARGIN, Math.min(x, ventana.width - ancho - MENU_MARGIN));
  const top = Math.max(MENU_MARGIN, Math.min(y, ventana.height - alto - MENU_MARGIN));
  return { left, top };
}

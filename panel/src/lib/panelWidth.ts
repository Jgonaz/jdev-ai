import { safeStorage } from './workspace.ts';

// Lógica pura de los paneles laterales redimensionables: límites, ajuste de
// anchos, teclado y persistencia. Sin React ni DOM, para poder probarla.

export type PanelLimits = { min: number; max: number; default: number };

/** Ancho mínimo que debe conservar el área central, sea cual sea el ancho de los paneles. */
export const CENTER_MIN = 360;
/** Paso de las flechas y con Mayús. */
export const KEY_STEP = 16;
export const KEY_STEP_BIG = 64;

/** Lado en el que está el panel: el tirador se arrastra hacia el centro. */
export type PanelSide = 'left' | 'right';

/** Acota a [min, max] y redondea a píxeles enteros; un valor no numérico da el mínimo. */
export function clampWidth(w: number, min: number, max: number): number {
  const tope = Math.max(min, max);
  if (!Number.isFinite(w)) return min;
  return Math.min(tope, Math.max(min, Math.round(w)));
}

/**
 * Máximo efectivo de un panel: su máximo propio, pero sin dejar al área
 * central por debajo de `centerMin` (descontando los otros paneles en línea,
 * `reserved`). Nunca baja del mínimo del panel.
 */
export function effectiveMax(max: number, min: number, container: number, reserved = 0, centerMin = CENTER_MIN): number {
  if (!Number.isFinite(container) || container <= 0) return Math.max(min, max);
  return Math.max(min, Math.min(max, container - reserved - centerMin));
}

/** Ancho tras arrastrar `delta` px a la derecha: el panel izquierdo crece; el derecho, mengua. */
export function dragWidth(start: number, delta: number, side: PanelSide, min: number, max: number): number {
  return clampWidth(side === 'left' ? start + delta : start - delta, min, max);
}

/**
 * Ancho que pide una tecla sobre el tirador, o null si la tecla no cuenta. Las
 * flechas mueven el tirador (→ ensancha un panel izquierdo y estrecha uno
 * derecho); Mayús multiplica el paso; Inicio y Fin van al mínimo y al máximo.
 */
export function keyboardWidth(key: string, shift: boolean, width: number, side: PanelSide, min: number, max: number): number | null {
  const paso = shift ? KEY_STEP_BIG : KEY_STEP;
  switch (key) {
    case 'ArrowRight':
      return clampWidth(side === 'left' ? width + paso : width - paso, min, max);
    case 'ArrowLeft':
      return clampWidth(side === 'left' ? width - paso : width + paso, min, max);
    case 'Home':
      return clampWidth(min, min, max);
    case 'End':
      return clampWidth(max, min, max);
    default:
      return null;
  }
}

// ---------------------------------------------------------------- Persistencia

export const PANEL_WIDTHS_KEY = 'jdev-panel:panel-widths';

/** Anchos guardados por panel; descarta lo que no sea un número finito positivo. */
export function parsePanelWidths(crudo: string | null): Record<string, number> {
  if (crudo === null) return {};
  try {
    const v = JSON.parse(crudo) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const salida: Record<string, number> = {};
    for (const [id, w] of Object.entries(v)) {
      if (typeof w === 'number' && Number.isFinite(w) && w > 0) salida[id] = w;
    }
    return salida;
  } catch {
    return {};
  }
}

/** Ancho recordado del panel, acotado a sus límites, o null si no hay (se usa el de por defecto). */
export function loadPanelWidth(id: string, limits: PanelLimits, storage: Pick<Storage, 'getItem'> | null = safeStorage()): number | null {
  try {
    const w = parsePanelWidths(storage?.getItem(PANEL_WIDTHS_KEY) ?? null)[id];
    return w === undefined ? null : clampWidth(w, limits.min, limits.max);
  } catch {
    return null;
  }
}

/** Recuerda el ancho del panel; con null borra el recuerdo y vuelve el ancho por defecto. */
export function savePanelWidth(
  id: string,
  width: number | null,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage(),
): void {
  try {
    if (!storage) return;
    const todos = parsePanelWidths(storage.getItem(PANEL_WIDTHS_KEY));
    if (width === null) delete todos[id];
    else todos[id] = Math.round(width);
    storage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(todos));
  } catch {
    // Almacenamiento bloqueado o lleno: el panel funciona igual, sin recordar.
  }
}

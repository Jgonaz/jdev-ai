// Lógica pura de la barra de scroll de las terminales. El historial lo tiene
// tmux; la barra solo traduce entre su posición («position»: líneas por encima
// del final, como el scroll_position de tmux) y píxeles de la pista.

export type ScrollState = {
  /** El panel está en copy-mode (se ha subido por el historial). */
  inMode: boolean;
  /** Líneas por encima del final que se están viendo (0 = abajo). */
  position: number;
  /** Líneas guardadas en el historial, sin contar las visibles. */
  history: number;
  /** Alto visible, en líneas. */
  height: number;
  /** La aplicación usa la pantalla alternativa: el historial es suyo y la barra le manda teclas. */
  alternate: boolean;
};

/** Alto mínimo del pulgar, para que se pueda agarrar con historiales enormes. */
export const MIN_THUMB_PX = 24;
/** Sondeo mientras el panel está en copy-mode o el ratón está sobre la barra. */
export const POLL_MS = 300;

export type Thumb = { top: number; size: number };

/** Contenido total en líneas: historial más pantalla visible. */
const total = (s: ScrollState) => s.history + Math.max(1, s.height);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Primera línea visible contando desde la más antigua (0 = la de arriba). Es el valor del scrollbar accesible. */
export function topLine(s: Pick<ScrollState, 'history' | 'position'>): number {
  return clamp(s.history - s.position, 0, s.history);
}

/** Posición y tamaño del pulgar dentro de una pista de `track` píxeles. */
export function thumbGeometry(s: ScrollState, track: number): Thumb {
  if (track <= 0 || s.history <= 0) return { top: 0, size: Math.max(0, track) };
  const size = clamp(Math.round((Math.max(1, s.height) / total(s)) * track), Math.min(MIN_THUMB_PX, track), track);
  const libre = track - size;
  const top = Math.round((topLine(s) / s.history) * libre);
  return { top: clamp(top, 0, libre), size };
}

/**
 * Posición de scroll (líneas sobre el final) que corresponde a poner el borde
 * superior del pulgar en `thumbTop` píxeles. Inversa de thumbGeometry.
 */
export function positionFromThumbTop(thumbTop: number, thumbSize: number, track: number, history: number): number {
  const libre = track - thumbSize;
  if (libre <= 0 || history <= 0) return 0;
  const fraccion = clamp(thumbTop / libre, 0, 1);
  return clamp(history - Math.round(fraccion * history), 0, history);
}

/**
 * Qué hacer con un clic en la pista: página hacia arriba si cae por encima del
 * pulgar, hacia abajo si cae por debajo, nada si cae sobre él.
 */
export function trackClickAction(y: number, thumb: Thumb): 'page-up' | 'page-down' | null {
  if (y < thumb.top) return 'page-up';
  if (y > thumb.top + thumb.size) return 'page-down';
  return null;
}

/** ¿Hay que sondear? Solo en copy-mode, con el ratón sobre la barra o arrastrando, y con la terminal a la vista. */
export function shouldPoll(o: { inMode: boolean; hovering: boolean; dragging: boolean; visible: boolean }): boolean {
  return o.visible && (o.inMode || o.hovering || o.dragging);
}

/** La barra solo se muestra si hay historial por el que moverse: el de tmux o el de la aplicación. */
export function barVisible(s: ScrollState | null): s is ScrollState {
  return s !== null && (s.history > 0 || s.alternate);
}

/**
 * ¿Controla la barra el scroll de la aplicación? Pasa en pantalla alternativa
 * (Claude Code a pantalla completa) mientras tmux no esté en copy-mode. No se
 * conoce la posición: no hay pulgar y la pista solo pagina.
 */
export function appScroll(s: ScrollState | null): boolean {
  return s !== null && s.alternate && !s.inMode;
}

/** Clic en la pista sin pulgar: la mitad de arriba pagina hacia arriba y la de abajo hacia abajo. */
export function appTrackClickAction(y: number, track: number): 'page-up' | 'page-down' {
  return y < track / 2 ? 'page-up' : 'page-down';
}

/** Mayús+RePág / Mayús+AvPág: tmux los trata (S-PPage / S-NPage); el navegador no los usa para nada más. */
export function isShiftPage(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
  return e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'PageUp' || e.key === 'PageDown');
}

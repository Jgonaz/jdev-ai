// Detección de rutas de imagen nuevas en una terminal para abrir el visor solo.
// Lógica pura: qué filas revisar y qué rutas cuentan como nuevas.

import { normalizePath } from './imageStrip.ts';

/** Pausa tras la última escritura antes de revisar las líneas cambiadas. */
export const SCAN_DEBOUNCE_MS = 400;
/** Tras conectar, el contenido que llega (repintado de tmux) es antiguo: no abre nada. */
export const INITIAL_QUIET_MS = 1500;
/** Una ruta vista hace menos de esto (y refrescada en cada redibujado) no vuelve a ser nueva. */
export const SEEN_TTL_MS = 60_000;
/** Tope de filas nuevas que se revisan de una vez. */
export const MAX_SCAN_ROWS = 400;
/** Tope de rutas nuevas que se comprueban por revisión. */
export const MAX_NEW_PER_SCAN = 5;

/**
 * Filas del búfer (desde, hasta exclusivo) que hay que revisar: la pantalla
 * visible más las líneas que han entrado desde la última revisión, que pueden
 * haber salido ya por arriba. No se reescanea el historial entero.
 */
export function scanRange(length: number, rows: number, linesAdded: number, max: number = MAX_SCAN_ROWS): { from: number; to: number } {
  const filas = Math.min(max, Math.max(rows, 0) + Math.max(linesAdded, 0));
  return { from: Math.max(0, length - filas), to: length };
}

/**
 * Decide qué rutas son nuevas. Una ruta no es nueva si estaba en el contenido
 * inicial (`baseline`), si ya figura en la tira de la terminal o si se vio hace
 * poco (las pantallas de Claude Code se redibujan y repiten las mismas rutas;
 * también evita volver a comprobar una ruta rechazada en cada redibujado).
 */
export class NewImageDetector {
  private readonly base = new Set<string>();
  private readonly vistas = new Map<string, number>();
  private readonly reclamadas = new Map<string, number>();

  constructor(private readonly ttlMs: number = SEEN_TTL_MS) {}

  /** Registra el contenido que ya estaba en la terminal: nunca se anuncia. */
  baseline(paths: readonly string[]): void {
    for (const p of paths) this.base.add(normalizePath(p));
  }

  /** Rutas nuevas entre `paths` (de la más antigua a la más reciente, sin repetir). */
  detect(paths: readonly string[], now: number, isKnown: (path: string) => boolean): string[] {
    for (const mapa of [this.vistas, this.reclamadas]) for (const [clave, t] of mapa) if (now - t >= this.ttlMs) mapa.delete(clave);
    const nuevas: string[] = [];
    for (const p of paths) {
      const clave = normalizePath(p);
      if (this.base.has(clave)) continue;
      const antes = this.vistas.get(clave);
      this.vistas.set(clave, now);
      if (antes !== undefined) continue;
      if (isKnown(p)) continue;
      nuevas.push(p);
    }
    return nuevas;
  }

  /**
   * Tras comprobarla en el servidor: ¿es la ruta real de `original` una imagen
   * que aún no conocíamos? Una ruta relativa puede ser un archivo ya visto con
   * su ruta absoluta, y dos rutas distintas pueden ser el mismo archivo.
   */
  claimResolved(original: string, resuelta: string, now: number, isKnown: (path: string) => boolean): boolean {
    const clave = normalizePath(resuelta);
    if (this.base.has(clave)) return false;
    const reclamada = this.reclamadas.get(clave);
    if (reclamada !== undefined && now - reclamada < this.ttlMs) return false;
    if (clave !== normalizePath(original) && (this.vistas.has(clave) || isKnown(resuelta))) return false;
    this.reclamadas.set(clave, now);
    return true;
  }
}

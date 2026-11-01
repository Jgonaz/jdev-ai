import type { SessionInfo, VisualState } from '../types.ts';
import { visualState } from './sessions.ts';

export type AlertKind = 'waiting' | 'finished';
export type AlertEvent = { name: string; kind: AlertKind };

export function stateMap(sessions: readonly SessionInfo[]): Map<string, VisualState> {
  return new Map(sessions.map((s) => [s.name, visualState(s)]));
}

/**
 * Transiciones que merecen un aviso entre dos instantáneas: una sesión que pasa
 * a «te espera» y una que deja de trabajar y queda en reposo. Sin instantánea
 * previa (primera carga) no hay avisos, para no avisar de lo que ya existía.
 */
export function detectAlerts(previo: ReadonlyMap<string, VisualState> | null, actual: readonly SessionInfo[]): AlertEvent[] {
  if (previo === null) return [];
  const eventos: AlertEvent[] = [];
  for (const s of actual) {
    const ahora = visualState(s);
    const antes = previo.get(s.name);
    if (antes === undefined) continue;
    if (ahora === 'waiting' && antes !== 'waiting') eventos.push({ name: s.name, kind: 'waiting' });
    else if (ahora === 'idle' && antes === 'working') eventos.push({ name: s.name, kind: 'finished' });
  }
  return eventos;
}

/** Título de la pestaña del navegador: «(N) jdev-ai» con las sesiones que esperan. */
export function documentTitle(esperan: number, contador: boolean): string {
  return contador && esperan > 0 ? `(${esperan}) jdev-ai` : 'jdev-ai';
}

/** Pitido corto estilo teletipo con Web Audio, sin archivos de audio. */
export function playTick(): void {
  try {
    const Contexto =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const ctx = new Contexto();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    void ctx.resume();
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
    osc.onended = () => void ctx.close();
  } catch {
    // Sin audio disponible o bloqueado hasta que haya un gesto de la persona.
  }
}

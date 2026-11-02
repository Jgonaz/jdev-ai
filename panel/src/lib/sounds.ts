// Sonidos de aviso sintetizados con Web Audio: sin archivos de audio que servir
// ni licencias. Cada sonido es una lista de notas (frecuencia, inicio, duración,
// forma de onda y volumen) con un ataque corto y una caída exponencial.
import { SOUNDS } from '../../shared/settings-schema.ts';
import type { SoundId } from '../../shared/settings-schema.ts';

export { SOUNDS };
export type { SoundId };
/** Sonido sintetizado en el navegador (los del catálogo). */
export type SynthSound = (typeof SOUNDS)[number];

/** Prefijo de los sonidos de Windows: «win:» y el nombre del .wav en C:\Windows\Media. */
export const WINDOWS_PREFIX = 'win:';
export const windowsSoundId = (archivo: string): SoundId => `win:${archivo}`;
/** Nombre del .wav de un sonido de Windows, o null si es sintetizado. */
export function windowsSoundFile(id: SoundId): string | null {
  return id.startsWith(WINDOWS_PREFIX) ? id.slice(WINDOWS_PREFIX.length) : null;
}
/** Nombre legible de un .wav de Windows: sin extensión ni el prefijo «Windows ». */
export function windowsSoundLabel(archivo: string): string {
  return archivo.replace(/\.wav$/i, '').replace(/^Windows /, '');
}
/** Volumen de los .wav de Windows: suenan más fuerte que los sintetizados. */
const WINDOWS_VOLUME = 0.6;

export type Note = {
  /** Frecuencia inicial, en Hz. */
  freq: number;
  /** Frecuencia final, si la nota se desliza (gota, radar). */
  to?: number;
  /** Inicio y duración, en segundos. */
  at: number;
  dur: number;
  wave: OscillatorType;
  /** Volumen máximo (0–1). Bajo a propósito: es un aviso, no una alarma. */
  gain: number;
};

export const SOUND_LABELS: Record<SynthSound, string> = {
  teletipo: '«Tic» de teletipo',
  campanilla: 'Campanilla',
  'dos-tonos': 'Dos tonos ascendentes',
  gota: 'Gota',
  pulso: 'Pulso suave',
  acorde: 'Acorde',
  marimba: 'Marimba',
  radar: 'Radar',
};

export const SOUND_OPTIONS: readonly { value: SynthSound; label: string }[] = SOUNDS.map((id) => ({ value: id, label: SOUND_LABELS[id] }));

/** Partitura de cada sonido. Ninguno pasa de un segundo. */
export function soundNotes(id: SynthSound): Note[] {
  switch (id) {
    case 'teletipo':
      return [{ freq: 1800, at: 0, dur: 0.05, wave: 'square', gain: 0.08 }];
    case 'campanilla':
      return [
        { freq: 1320, at: 0, dur: 0.7, wave: 'sine', gain: 0.18 },
        { freq: 2640, at: 0, dur: 0.35, wave: 'sine', gain: 0.06 },
        { freq: 3960, at: 0, dur: 0.18, wave: 'sine', gain: 0.03 },
      ];
    case 'dos-tonos':
      return [
        { freq: 660, at: 0, dur: 0.14, wave: 'sine', gain: 0.16 },
        { freq: 990, at: 0.13, dur: 0.22, wave: 'sine', gain: 0.16 },
      ];
    case 'gota':
      return [{ freq: 1400, to: 480, at: 0, dur: 0.16, wave: 'sine', gain: 0.2 }];
    case 'pulso':
      return [
        { freq: 440, at: 0, dur: 0.12, wave: 'triangle', gain: 0.16 },
        { freq: 440, at: 0.18, dur: 0.12, wave: 'triangle', gain: 0.16 },
      ];
    case 'acorde':
      return [
        { freq: 523.25, at: 0, dur: 0.5, wave: 'triangle', gain: 0.1 },
        { freq: 659.25, at: 0.07, dur: 0.45, wave: 'triangle', gain: 0.1 },
        { freq: 783.99, at: 0.14, dur: 0.4, wave: 'triangle', gain: 0.1 },
      ];
    case 'marimba':
      return [
        { freq: 880, at: 0, dur: 0.18, wave: 'sine', gain: 0.2 },
        { freq: 3520, at: 0, dur: 0.04, wave: 'sine', gain: 0.05 },
        { freq: 1174.66, at: 0.12, dur: 0.22, wave: 'sine', gain: 0.18 },
        { freq: 4698.64, at: 0.12, dur: 0.04, wave: 'sine', gain: 0.04 },
      ];
    case 'radar':
      return [
        { freq: 700, to: 1100, at: 0, dur: 0.12, wave: 'sine', gain: 0.14 },
        { freq: 700, to: 1100, at: 0.25, dur: 0.12, wave: 'sine', gain: 0.09 },
      ];
  }
}

/**
 * Reproduce un sonido. Sin audio disponible (o bloqueado hasta un gesto de la persona) no hace nada.
 * Si un .wav de Windows no se puede cargar o reproducir, avisa con `alFallar` (lo usa «Probar»).
 */
export function playSound(id: SoundId, alFallar?: () => void): void {
  const archivo = windowsSoundFile(id);
  if (archivo !== null) {
    try {
      const audio = new Audio(`/api/sounds/windows/${encodeURIComponent(archivo)}`);
      audio.volume = WINDOWS_VOLUME;
      audio.addEventListener('error', () => alFallar?.());
      // Bloqueado hasta un gesto de la persona no es un fallo del archivo.
      void audio.play().catch((e: unknown) => {
        if ((e as { name?: string } | null)?.name !== 'NotAllowedError') alFallar?.();
      });
    } catch {
      alFallar?.();
    }
    return;
  }
  const sintetizado = id as SynthSound;
  if (!(SOUNDS as readonly string[]).includes(sintetizado)) return;
  try {
    const Contexto =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Contexto) return;
    const ctx = new Contexto();
    const notas = soundNotes(sintetizado);
    const t0 = ctx.currentTime + 0.01;
    let fin = 0;
    for (const n of notas) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.wave;
      const inicio = t0 + n.at;
      const final = inicio + n.dur;
      osc.frequency.setValueAtTime(n.freq, inicio);
      if (n.to !== undefined) osc.frequency.exponentialRampToValueAtTime(n.to, final);
      gain.gain.setValueAtTime(0.0001, inicio);
      gain.gain.exponentialRampToValueAtTime(n.gain, inicio + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, final);
      osc.connect(gain).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(final + 0.02);
      fin = Math.max(fin, final);
    }
    void ctx.resume();
    window.setTimeout(() => void ctx.close(), Math.ceil((fin - ctx.currentTime + 0.2) * 1000));
  } catch {
    // Sin audio disponible o bloqueado hasta que haya un gesto de la persona.
  }
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings-schema.ts';
import { SOUND_LABELS, SOUND_OPTIONS, SOUNDS, soundNotes, windowsSoundFile, windowsSoundId, windowsSoundLabel } from './sounds.ts';
import { isSoundId } from '../../shared/settings-schema.ts';

describe('sonidos de aviso', () => {
  it('cada sonido tiene nombre y una partitura breve y audible pero discreta', () => {
    expect(SOUND_OPTIONS.map((o) => o.value)).toEqual([...SOUNDS]);
    for (const id of SOUNDS) {
      expect(SOUND_LABELS[id].length).toBeGreaterThan(0);
      const notas = soundNotes(id);
      expect(notas.length).toBeGreaterThan(0);
      for (const n of notas) {
        expect(n.freq).toBeGreaterThan(20);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.25);
        expect(n.at + n.dur).toBeLessThanOrEqual(1);
      }
    }
  });

  it('el «tic» de siempre sigue siendo el sonido de «te espera» por defecto', () => {
    expect(DEFAULT_SETTINGS.notifications.soundWaiting).toBe('teletipo');
    expect(soundNotes('teletipo')).toEqual([{ freq: 1800, at: 0, dur: 0.05, wave: 'square', gain: 0.08 }]);
    expect(DEFAULT_SETTINGS.notifications.soundFinish).not.toBe(DEFAULT_SETTINGS.notifications.soundWaiting);
  });

  it('sonidos de Windows: identificador, archivo, nombre legible y validación', () => {
    const id = windowsSoundId('Windows Notify Calendar.wav');
    expect(id).toBe('win:Windows Notify Calendar.wav');
    expect(windowsSoundFile(id)).toBe('Windows Notify Calendar.wav');
    expect(windowsSoundFile('gota')).toBeNull();
    expect(windowsSoundLabel('Windows Notify Calendar.wav')).toBe('Notify Calendar');
    expect(windowsSoundLabel('chimes.wav')).toBe('chimes');
    for (const ok of ['gota', 'teletipo', id, 'win:chimes.wav', 'win:Alarm01.wav']) expect(isSoundId(ok), ok).toBe(true);
    for (const ko of ['sirena', 'win:', 'win:../x.wav', 'win:a/b.wav', 'win:.oculto.wav', 'win:x.mp3', 'win:x\\y.wav', 3, null]) {
      expect(isSoundId(ko), String(ko)).toBe(false);
    }
  });
});

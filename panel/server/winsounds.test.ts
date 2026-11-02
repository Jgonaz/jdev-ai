import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_SOUND_BYTES, SoundError, isWindowsSoundName, listWindowsSounds, openWindowsSound } from './winsounds.ts';

describe('sonidos de Windows', () => {
  let tmp: string;
  let media: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-winsounds-'));
    media = join(tmp, 'Media');
    mkdirSync(media);
    writeFileSync(join(media, 'Windows Notify Calendar.wav'), 'RIFF....WAVE');
    writeFileSync(join(media, 'chimes.wav'), 'RIFF....WAVE');
    writeFileSync(join(media, 'notas.txt'), 'no');
    mkdirSync(join(media, 'Raga.wav'));
    writeFileSync(join(tmp, 'fuera.wav'), 'secreto');
    symlinkSync(join(tmp, 'fuera.wav'), join(media, 'enlace.wav'));
    writeFileSync(join(media, 'enorme.wav'), Buffer.alloc(MAX_SOUND_BYTES + 1));
    execFileSync('mkfifo', [join(media, 'tuberia.wav')]);
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('valida los nombres', () => {
    expect(isWindowsSoundName('Windows Notify Calendar.wav')).toBe(true);
    expect(isWindowsSoundName('Alarm01.wav')).toBe(true);
    for (const malo of ['../x.wav', 'a/b.wav', 'a\\b.wav', '.oculto.wav', 'x.mp3', '', 'x.wav\n']) {
      expect(isWindowsSoundName(malo), malo).toBe(false);
    }
  });

  it('lista los .wav ordenados y devuelve [] si la carpeta no existe', async () => {
    const lista = await listWindowsSounds(media);
    expect(lista).toContain('Windows Notify Calendar.wav');
    expect(lista).toContain('chimes.wav');
    expect(lista).not.toContain('notas.txt');
    expect(lista).not.toContain('Raga.wav');
    // Solo archivos regulares dentro de la carpeta y de hasta 5 MiB: sin enlaces que salen, enormes ni tuberías.
    expect(lista).not.toContain('enlace.wav');
    expect(lista).not.toContain('enorme.wav');
    expect(lista).not.toContain('tuberia.wav');
    expect(await listWindowsSounds(join(tmp, 'no-existe'))).toEqual([]);
  });

  it('abre un sonido de la carpeta', async () => {
    const s = await openWindowsSound(media, 'chimes.wav');
    expect(s.size).toBe(12);
    await s.handle.close();
  });

  it('rechaza nombres no válidos, enlaces que salen de la carpeta, directorios y archivos enormes', async () => {
    await expect(openWindowsSound(media, '../fuera.wav')).rejects.toMatchObject({ status: 400 });
    // La tubería no bloquea: da 404 de inmediato.
    for (const nombre of ['enlace.wav', 'Raga.wav', 'enorme.wav', 'no-existe.wav', 'tuberia.wav']) {
      const e = await openWindowsSound(media, nombre).catch((x: unknown) => x);
      expect(e, nombre).toBeInstanceOf(SoundError);
      expect((e as SoundError).status, nombre).toBe(404);
    }
  });
});

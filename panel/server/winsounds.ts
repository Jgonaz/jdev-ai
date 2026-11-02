// Sonidos de Windows (C:\Windows\Media en WSL) para los avisos del panel. Se
// entregan desde el disco de la persona; no se copian ni se versionan. Fuera de
// WSL la carpeta no existe y la lista queda vacía.
import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { openRegularFile } from './safefile.ts';

export const DEFAULT_WINDOWS_MEDIA = '/mnt/c/Windows/Media';
/** Los .wav de Windows pesan menos de 1 MiB; con margen. */
export const MAX_SOUND_BYTES = 5 * 1024 * 1024;
const NOMBRE = /^[\p{L}\p{N} ._()&'-]{1,120}\.wav$/iu;

/** Nombre de archivo aceptable: un .wav sin separadores ni rutas. */
export function isWindowsSoundName(nombre: string): boolean {
  return NOMBRE.test(nombre) && !nombre.startsWith('.') && !nombre.includes('/') && !nombre.includes('\\');
}

/**
 * Los .wav de la carpeta, ordenados; [] si no existe o no se puede leer. Solo
 * archivos regulares de hasta MAX_SOUND_BYTES cuya ruta real siga dentro de la
 * carpeta (un enlace que sale de ella no se lista), igual que al servirlos.
 */
export async function listWindowsSounds(dir: string): Promise<string[]> {
  let entradas: Dirent[];
  let base: string;
  try {
    entradas = await readdir(dir, { withFileTypes: true });
    base = await realpath(dir);
  } catch {
    return [];
  }
  const validos = await Promise.all(
    entradas
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && isWindowsSoundName(e.name))
      .map(async (e) => {
        try {
          const real = await realpath(join(dir, e.name));
          if (!real.startsWith(base + sep)) return null;
          const st = await stat(real);
          return st.isFile() && st.size <= MAX_SOUND_BYTES ? e.name : null;
        } catch {
          return null;
        }
      }),
  );
  return validos.filter((n): n is string => n !== null).sort((a, b) => a.localeCompare(b, 'es'));
}

export class SoundError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Abre un sonido de la carpeta comprobando el nombre, que siga dentro y su tamaño. */
export async function openWindowsSound(dir: string, nombre: string): Promise<{ handle: FileHandle; size: number }> {
  if (!isWindowsSoundName(nombre)) throw new SoundError(400, 'Nombre de sonido no válido.');
  let base: string;
  let real: string;
  try {
    base = await realpath(dir);
    real = await realpath(join(dir, nombre));
  } catch {
    throw new SoundError(404, 'El sonido no existe.');
  }
  if (!real.startsWith(base + sep)) throw new SoundError(404, 'El sonido no existe.');
  const abierto = await openRegularFile(real);
  if (!abierto || abierto.stat.size > MAX_SOUND_BYTES) {
    await abierto?.fh.close();
    throw new SoundError(404, 'El sonido no existe.');
  }
  return { handle: abierto.fh, size: abierto.stat.size };
}

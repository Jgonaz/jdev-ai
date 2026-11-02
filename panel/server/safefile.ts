// Apertura segura de archivos cuya ruta puede controlar otro proceso del usuario
// (transcripts, salidas de shells, sonidos). Abrir una tubería (FIFO) o un
// dispositivo bloquea un hilo del servidor hasta que alguien escriba, así que se
// comprueba con lstat antes de abrir y se abre sin bloquear y sin seguir enlaces.

import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';

/**
 * Abre `ruta` solo si es un archivo regular (no un enlace, tubería, socket ni
 * dispositivo): lstat antes, `O_NONBLOCK | O_NOFOLLOW` al abrir y `isFile()` sobre
 * el descriptor ya abierto. Devuelve null si algo falla. El llamador cierra el handle.
 */
export async function openRegularFile(ruta: string): Promise<{ fh: FileHandle; stat: Stats } | null> {
  let fh: FileHandle | undefined;
  try {
    if (!(await lstat(ruta)).isFile()) return null;
    fh = await open(ruta, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const stat = await fh.stat();
    if (!stat.isFile()) {
      await fh.close();
      return null;
    }
    return { fh, stat };
  } catch {
    await fh?.close().catch(() => {});
    return null;
  }
}

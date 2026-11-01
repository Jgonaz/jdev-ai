import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { detectImageKind } from './images.ts';
import type { ImageKind } from './images.ts';

// Imágenes que la persona pega o arrastra sobre una terminal del panel. Se
// guardan en una carpeta del usuario y el agente las lee por su ruta.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const UPLOAD_CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

// SVG no se admite: puede llevar contenido activo.
const EXTENSION_BY_TYPE: Record<string, { kind: ImageKind; extension: string }> = {
  'image/png': { kind: 'png', extension: 'png' },
  'image/jpeg': { kind: 'jpeg', extension: 'jpg' },
  'image/gif': { kind: 'gif', extension: 'gif' },
  'image/webp': { kind: 'webp', extension: 'webp' },
};
const NAME_FORMAT = /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{6}\.(png|jpg|gif|webp)$/;

export class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export type SavedUpload = { path: string; name: string; size: number };

const mb = (bytes: number) => Math.floor(bytes / 1048576);

// Tipo MIME de la cabecera Content-Type, sin parámetros y en minúsculas.
function mimeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

// Tipo de imagen admitido según la cabecera Content-Type, o 415. Se comprueba
// antes de leer el cuerpo para no recibir megas de algo que se va a rechazar.
export function uploadType(contentType: string | undefined): { kind: ImageKind; extension: string } {
  const tipo = EXTENSION_BY_TYPE[mimeOf(contentType)];
  if (!tipo) throw new UploadError(415, 'Tipo no admitido: solo se pueden adjuntar imágenes PNG, JPEG, GIF o WEBP.');
  return tipo;
}

// Lee el cuerpo y deja de leerlo al superar el límite: lo que ya llegó se
// descarta y la lectura se pausa, de modo que el resto del cuerpo no se
// acumula. Quien llama responde 413 y cierra la conexión.
export function readUploadBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const declarado = Number(req.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      req.pause();
      ko(new UploadError(413, `La imagen es demasiado grande: el límite es ${mb(maxBytes)} MB.`));
      return;
    }
    const trozos: Buffer[] = [];
    let total = 0;
    let terminado = false;
    const terminar = (fin: () => void) => {
      if (terminado) return;
      terminado = true;
      req.off('data', alLlegar);
      fin();
    };
    const alLlegar = (trozo: Buffer) => {
      total += trozo.length;
      if (total > maxBytes) {
        trozos.length = 0;
        req.pause();
        terminar(() => ko(new UploadError(413, `La imagen es demasiado grande: el límite es ${mb(maxBytes)} MB.`)));
        return;
      }
      trozos.push(trozo);
    };
    req.on('data', alLlegar);
    req.once('end', () => terminar(() => ok(Buffer.concat(trozos))));
    req.once('error', (e) => terminar(() => ko(e)));
    req.once('close', () => terminar(() => ko(new UploadError(400, 'La subida se interrumpió.'))));
  });
}

// YYYY-MM-DD-HHMM en hora local, como los nombres del historial.
function stamp(fecha: Date): string {
  const p = (n: number, ancho = 2) => String(n).padStart(ancho, '0');
  return `${p(fecha.getFullYear(), 4)}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}-${p(fecha.getHours())}${p(fecha.getMinutes())}`;
}

// Valida tipo y firma y guarda la imagen con un nombre único. La carpeta es
// solo del usuario (0700) y el archivo también (0600).
export async function saveUpload(
  cuerpo: Buffer,
  contentType: string | undefined,
  dir: string,
  ahora: Date = new Date(),
): Promise<SavedUpload> {
  const tipo = uploadType(contentType);
  if (cuerpo.length === 0) throw new UploadError(400, 'La imagen está vacía.');
  if (detectImageKind(cuerpo) !== tipo.kind) {
    throw new UploadError(415, 'El contenido no coincide con una imagen del tipo indicado.');
  }

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  for (let intento = 0; intento < 5; intento++) {
    const name = `${stamp(ahora)}-${randomBytes(3).toString('hex')}.${tipo.extension}`;
    const path = join(dir, name);
    try {
      // «wx» no sobrescribe: un nombre repetido (improbable) se reintenta.
      await writeFile(path, cuerpo, { mode: 0o600, flag: 'wx' });
      await chmod(path, 0o600);
      return { path, name, size: cuerpo.length };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw e;
    }
  }
  throw new Error('no se pudo asignar un nombre libre a la imagen');
}

// Borra las imágenes adjuntadas con más de `maxAgeMs`. Solo toca archivos
// regulares con el nombre que genera saveUpload, nunca enlaces ni otros archivos.
// Devuelve cuántas borró.
export async function cleanOldUploads(dir: string, maxAgeMs: number = UPLOAD_MAX_AGE_MS, ahora: number = Date.now()): Promise<number> {
  let nombres: string[];
  try {
    nombres = await readdir(dir);
  } catch {
    return 0;
  }
  let borradas = 0;
  for (const nombre of nombres) {
    if (!NAME_FORMAT.test(nombre)) continue;
    const ruta = join(dir, nombre);
    try {
      const info = await lstat(ruta);
      if (!info.isFile() || ahora - info.mtimeMs <= maxAgeMs) continue;
      await unlink(ruta);
      borradas++;
    } catch {
      // Desapareció o no se puede borrar: se intentará en la siguiente pasada.
    }
  }
  return borradas;
}

// Limpieza al arrancar y cada 12 h. El temporizador no mantiene vivo el
// proceso. Devuelve la función que lo detiene.
export function startUploadCleanup(dir: string, intervaloMs: number = UPLOAD_CLEANUP_INTERVAL_MS, maxAgeMs: number = UPLOAD_MAX_AGE_MS): () => void {
  const pasada = () => {
    cleanOldUploads(dir, maxAgeMs).catch(() => {});
  };
  pasada();
  const temporizador = setInterval(pasada, intervaloMs);
  temporizador.unref();
  return () => clearInterval(temporizador);
}

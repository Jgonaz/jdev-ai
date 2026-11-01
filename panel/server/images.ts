import { open, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { uploadsDir } from './paths.ts';

// Entrega de imágenes al visor del panel. El servidor lee archivos del disco,
// así que cada petición pasa por una lista cerrada de carpetas (sobre la ruta
// real, tras resolver enlaces simbólicos), una extensión de imagen, la firma
// del contenido y un límite de tamaño.

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
// Cabecera leída para detectar el tipo y las dimensiones. Los JPEG con miniatura
// EXIF pueden llevar el marcador SOF más allá de los primeros KB.
const HEADER_BYTES = 64 * 1024;

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg';

const KIND_BY_EXTENSION: Record<string, ImageKind> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  svg: 'svg',
};

export const CONTENT_TYPES: Record<ImageKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

// Un SVG puede llevar scripts: se entrega aislado y sin acceso a nada.
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export class ImageError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ImageError';
    this.status = status;
  }
}

export type ImageInfo = {
  /** Ruta real del archivo. */
  file: string;
  kind: ImageKind;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  /** Manejador abierto: quien lo reciba debe cerrarlo. */
  handle: FileHandle;
};

// ------------------------------------------------------------- Firma y tamaño

const startsWith = (b: Uint8Array, bytes: readonly number[], offset = 0) =>
  b.length >= offset + bytes.length && bytes.every((x, i) => b[offset + i] === x);

const ascii = (b: Uint8Array, texto: string, offset: number) =>
  b.length >= offset + texto.length && [...texto].every((c, i) => b[offset + i] === c.charCodeAt(0));

// Reconoce PNG, JPEG, GIF y WEBP por sus bytes mágicos y SVG por su cabecera
// de texto (declaración XML o elemento <svg>). Devuelve null si no es una imagen.
export function detectImageKind(b: Uint8Array): ImageKind | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(b, 'GIF87a', 0) || ascii(b, 'GIF89a', 0)) return 'gif';
  if (ascii(b, 'RIFF', 0) && ascii(b, 'WEBP', 8)) return 'webp';
  if (b.length > 0 && !b.includes(0)) {
    const texto = Buffer.from(b.subarray(0, 4096)).toString('utf8').replace(/^﻿/, '').trimStart();
    if (/^(<\?xml|<svg|<!--|<!doctype svg)/i.test(texto) && /<svg[\s>]/i.test(texto)) return 'svg';
  }
  return null;
}

// Dimensiones leídas de la cabecera, sin decodificar la imagen. Devuelve null
// si no se pueden obtener (SVG, cabecera truncada o formato raro).
export function imageDimensions(b: Buffer, kind: ImageKind): { width: number; height: number } | null {
  try {
    if (kind === 'png' && b.length >= 24 && ascii(b, 'IHDR', 12)) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (kind === 'gif' && b.length >= 10) return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (kind === 'webp') return webpDimensions(b);
    if (kind === 'jpeg') return jpegDimensions(b);
  } catch {
    // Cabecera incompleta: sin dimensiones.
  }
  return null;
}

function webpDimensions(b: Buffer): { width: number; height: number } | null {
  if (b.length < 30) return null;
  if (ascii(b, 'VP8X', 12)) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (ascii(b, 'VP8L', 12) && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (ascii(b, 'VP8 ', 12) && startsWith(b, [0x9d, 0x01, 0x2a], 23)) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function jpegDimensions(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marcador = b[i + 1]!;
    if (marcador === 0xff) {
      i++;
      continue;
    }
    // Marcadores sin longitud.
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) {
      i += 2;
      continue;
    }
    const longitud = b.readUInt16BE(i + 2);
    // SOF0..SOF15, salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + longitud;
  }
  return null;
}

// ----------------------------------------------------------- Carpetas permitidas

// Carpetas de las que el panel puede entregar imágenes: el harness (con
// projects/ y los worktrees), las evidencias del QA, las imágenes adjuntadas y
// la carpeta temporal del sistema. La temporal es amplia, pero es donde
// Playwright y otras herramientas dejan capturas.
export function defaultImageDirs(harnessRoot: string, uploads: string = uploadsDir(), env: NodeJS.ProcessEnv = process.env): string[] {
  const tmp = env.TMPDIR && isAbsolute(env.TMPDIR) ? env.TMPDIR : '/tmp';
  const qa = env.PLAYWRIGHT_MCP_OUTPUT_DIR && isAbsolute(env.PLAYWRIGHT_MCP_OUTPUT_DIR) ? [env.PLAYWRIGHT_MCP_OUTPUT_DIR] : [];
  return [harnessRoot, ...qa, join(tmp, 'jdev-qa'), uploads, tmp];
}

const dentro = (ruta: string, carpeta: string) => ruta === carpeta || ruta.startsWith(carpeta.endsWith(sep) ? carpeta : carpeta + sep);

async function realOrNull(ruta: string): Promise<string | null> {
  try {
    return await realpath(ruta);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ Resolución

export type ResolveOptions = {
  /** Ruta pedida, absoluta o relativa a `cwd`. */
  path: string;
  /** Directorio contra el que se resuelve una ruta relativa (el de la sesión). */
  cwd?: string | null;
  allowedDirs: readonly string[];
  maxBytes?: number;
};

// Valida la petición y abre el archivo. Lanza ImageError con un mensaje apto
// para la persona: 400 petición mal formada, 403 fuera de las carpetas
// permitidas, 404 no existe, 413 demasiado grande y 415 no es una imagen.
// El archivo se abre una sola vez y las comprobaciones de tipo y tamaño se
// hacen sobre ese manejador, para que no cambie entre la comprobación y la lectura.
export async function openImage(opts: ResolveOptions): Promise<ImageInfo> {
  const { path } = opts;
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  if (typeof path !== 'string' || path === '') throw new ImageError(400, 'Indica la ruta de la imagen.');
  if (path.length > MAX_PATH_LENGTH || path.includes('\0')) throw new ImageError(400, 'La ruta de la imagen no es válida.');

  let pedida: string;
  if (isAbsolute(path)) {
    pedida = resolve(path);
  } else {
    if (!opts.cwd) {
      throw new ImageError(400, 'Una ruta relativa necesita la sesión de la terminal donde aparece.');
    }
    pedida = resolve(opts.cwd, path);
  }

  const carpetas = new Set<string>();
  for (const c of opts.allowedDirs) {
    carpetas.add(resolve(c));
    const real = await realOrNull(c);
    if (real) carpetas.add(real);
  }
  const permitida = (ruta: string) => [...carpetas].some((c) => dentro(ruta, c));

  const real = await realOrNull(pedida);
  if (real === null) {
    // No se revela si existen archivos fuera de las carpetas permitidas.
    throw permitida(pedida) ? new ImageError(404, 'La imagen no existe.') : new ImageError(403, 'La imagen está fuera de las carpetas permitidas.');
  }
  if (!permitida(real)) throw new ImageError(403, 'La imagen está fuera de las carpetas permitidas.');

  const extension = /\.([A-Za-z0-9]+)$/.exec(real)?.[1]?.toLowerCase() ?? '';
  const esperado = KIND_BY_EXTENSION[extension];
  if (!esperado) throw new ImageError(415, 'El archivo no es una imagen admitida (png, jpg, jpeg, gif, webp o svg).');

  // Antes de abrir: abrir una tubería o un dispositivo con nombre de imagen bloquearía la petición.
  try {
    if (!(await stat(real)).isFile()) throw new ImageError(404, 'La ruta no es un archivo.');
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError(404, 'La imagen no existe.');
  }

  let handle: FileHandle;
  try {
    handle = await open(real, 'r');
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;
    if (codigo === 'ENOENT') throw new ImageError(404, 'La imagen no existe.');
    if (codigo === 'EACCES' || codigo === 'EPERM') throw new ImageError(403, 'No hay permiso para leer la imagen.');
    throw e;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new ImageError(404, 'La ruta no es un archivo.');
    if (info.size > maxBytes) {
      throw new ImageError(413, `La imagen pesa ${(info.size / 1048576).toFixed(1)} MB y el límite es ${Math.floor(maxBytes / 1048576)} MB.`);
    }
    const cabecera = Buffer.alloc(Math.min(info.size, HEADER_BYTES));
    const { bytesRead } = await handle.read(cabecera, 0, cabecera.length, 0);
    const lectura = cabecera.subarray(0, bytesRead);
    const kind = detectImageKind(lectura);
    // La extensión y el contenido deben coincidir: un .png que en realidad es
    // otra cosa (o un SVG con otra extensión) no se entrega.
    if (kind === null || kind !== esperado) {
      throw new ImageError(415, 'El contenido del archivo no es una imagen del tipo que indica su extensión.');
    }
    const medidas = imageDimensions(lectura, kind);
    return { file: real, kind, contentType: CONTENT_TYPES[kind], size: info.size, ...(medidas ?? {}), handle };
  } catch (e) {
    await handle.close().catch(() => {});
    throw e;
  }
}

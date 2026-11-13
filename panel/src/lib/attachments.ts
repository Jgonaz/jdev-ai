// Validación de los archivos que se adjuntan a una terminal. Debe coincidir con
// lo que acepta POST /api/uploads (el servidor vuelve a comprobarlo).

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const UPLOAD_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const TYPE_BY_EXTENSION: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export const ACCEPTED_HELP = 'Adjunta png, jpg, gif o webp de hasta 20 MB.';

export type FileLike = { name: string; type: string; size: number };

export type FileCheck = { ok: true; type: string } | { ok: false; reason: string };

/** Tipo MIME admitido del archivo: el declarado o, si el navegador no lo da, el que indica la extensión. */
export function uploadMime(f: Pick<FileLike, 'name' | 'type'>): string | null {
  const declarado = f.type.split(';')[0]!.trim().toLowerCase();
  if (UPLOAD_TYPES[declarado]) return declarado;
  if (declarado !== '' && declarado !== 'application/octet-stream') return null;
  const ext = /\.([A-Za-z0-9]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? '';
  return TYPE_BY_EXTENSION[ext] ?? null;
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1).replace('.', ',');

/** ¿Se puede subir este archivo? Si no, el motivo en castellano para el aviso. */
export function validateUpload(f: FileLike): FileCheck {
  const nombre = f.name || 'El archivo';
  const tipo = uploadMime(f);
  if (!tipo) return { ok: false, reason: `«${nombre}» no es una imagen. ${ACCEPTED_HELP}` };
  if (f.size === 0) return { ok: false, reason: `«${nombre}» está vacío.` };
  if (f.size > MAX_UPLOAD_BYTES) return { ok: false, reason: `«${nombre}» pesa ${mb(f.size)} MB. ${ACCEPTED_HELP}` };
  return { ok: true, type: tipo };
}

/** ¿El portapapeles o el arrastre trae archivos? (las imágenes de una captura llegan como «Files»). */
export function hasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return types != null && Array.from(types).includes('Files');
}

/**
 * Archivos que un `paste` debe subir: solo si hay alguna imagen y ningún texto.
 * Con texto se deja el pegado normal (copiar una imagen de una web trae a veces
 * HTML, que no cuenta como texto).
 */
export function pastedImages<T extends FileLike>(files: readonly T[], plainText: string): T[] {
  if (plainText.trim() !== '') return [];
  return files.filter((f) => uploadMime(f) !== null);
}

/**
 * Inserta `insertado` (p. ej. rutas de imágenes) en un texto, sustituyendo la selección `[inicio, fin)`, y devuelve el
 * texto nuevo y dónde queda el cursor. Va separado por espacios de lo que lo rodea: uno detrás (que se aprovecha si ya
 * lo había) y otro delante si pegaría con una palabra, porque Claude Code solo convierte en adjunto una ruta suelta.
 */
export function insertAtCursor(texto: string, inicio: number, fin: number, insertado: string): { texto: string; cursor: number } {
  const antes = texto.slice(0, inicio);
  const despues = texto.slice(fin);
  const delante = antes !== '' && !/\s$/.test(antes) ? ' ' : '';
  const detras = /^\s/.test(despues) ? '' : ' ';
  const cabeza = `${antes}${delante}${insertado}`;
  return { texto: `${cabeza}${detras}${despues}`, cursor: cabeza.length + 1 };
}

// Zoom y ajuste del visor de imágenes. Funciones puras; la escala es 1 = 100 %.

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
const STEPS = [0.05, 0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;

export type Size = { width: number; height: number };

export const clampScale = (escala: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, escala));

/** Escala que hace caber la imagen en el área. Nunca se agranda por encima del 100 %. */
export function fitScale(imagen: Size, area: Size): number {
  if (imagen.width <= 0 || imagen.height <= 0 || area.width <= 0 || area.height <= 0) return 1;
  return clampScale(Math.min(1, area.width / imagen.width, area.height / imagen.height));
}

/** Siguiente escala del botón acercar (dirección 1) o alejar (-1). */
export function stepScale(escala: number, direccion: 1 | -1): number {
  // Tolerancia: 0,33 mostrado como «33 %» no debe saltarse un paso por redondeo.
  const eps = 0.005;
  if (direccion === 1) return STEPS.find((s) => s > escala + eps) ?? MAX_SCALE;
  return [...STEPS].reverse().find((s) => s < escala - eps) ?? MIN_SCALE;
}

/** Escala tras un giro de la rueda con Ctrl: cada 100 px de desplazamiento cambia un 25 %, de forma proporcional. */
export function wheelScale(escala: number, deltaY: number): number {
  return clampScale(escala * Math.exp(-deltaY / 400));
}

/** Relleno del área del visor, a cada lado. */
export const AREA_PADDING = 16;

/**
 * Desplazamiento (en un eje) que mantiene en el centro de la vista el mismo punto
 * de la imagen al pasar de un tamaño mostrado a otro. Si la imagen es menor que
 * el área, el navegador la centra con un margen y ese desplazamiento hay que
 * tenerlo en cuenta: el punto central visible es entonces el centro de la imagen.
 */
export function scrollAfterZoom(scroll: number, client: number, antes: number, despues: number, padding: number = AREA_PADDING): number {
  if (antes <= 0 || despues <= 0 || client <= 0) return Math.max(0, scroll);
  const interior = Math.max(0, client - 2 * padding);
  const origen = (tamano: number) => padding + Math.max(0, (interior - tamano) / 2);
  const fraccion = (scroll + client / 2 - origen(antes)) / antes;
  return Math.max(0, origen(despues) + fraccion * despues - client / 2);
}

export const percent = (escala: number): string => `${Math.round(escala * 100)} %`;

/** Tamaño legible: 412 KB, 1,2 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
}

/** Datos de la cabecera del visor leídos de las cabeceras de HEAD /api/image. */
/** `path` es la ruta real del archivo en el servidor (cabecera X-Image-Path). */
export type ImageMeta = { size: number | null; width: number | null; height: number | null; path: string | null };

/** La cabecera X-Image-Path va codificada con encodeURIComponent; solo se acepta una ruta absoluta. */
function decodeImagePath(valor: string | null): string | null {
  if (!valor) return null;
  try {
    const ruta = decodeURIComponent(valor);
    return ruta.startsWith('/') ? ruta : null;
  } catch {
    return null;
  }
}

export function parseImageHeaders(h: Pick<Headers, 'get'>): ImageMeta {
  const num = (nombre: string) => {
    const v = h.get(nombre);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const width = num('X-Image-Width');
  const height = num('X-Image-Height');
  return {
    size: num('X-Image-Size') ?? num('Content-Length'),
    width: width && height ? width : null,
    height: width && height ? height : null,
    path: decodeImagePath(h.get('X-Image-Path')),
  };
}

/** «412 KB» o «1179 × 2556 · 412 KB» según los datos que haya. */
export function describeMeta(meta: ImageMeta | null, natural?: Size | null): string {
  const ancho = meta?.width ?? natural?.width ?? null;
  const alto = meta?.height ?? natural?.height ?? null;
  return [ancho && alto ? `${ancho} × ${alto}` : null, meta?.size != null ? formatBytes(meta.size) : null].filter(Boolean).join(' · ');
}

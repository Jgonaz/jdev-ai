// Detección de rutas de imagen en el texto de una terminal. Sin xterm ni React:
// trabaja sobre estructuras mínimas para poder probarse con buffers falsos.

const EXTENSIONS = 'png|jpe?g|gif|webp|svg';
// Exige al menos un carácter de nombre antes de la extensión («.png» a secas no es una ruta).
const IMAGE_END = new RegExp(`[^/\\s]\\.(?:${EXTENSIONS})$`, 'i');
// Rutas entre comillas, comillas angulares o acentos graves: pueden llevar espacios.
const QUOTED = new RegExp(
  [`"([^"\\n]+\\.(?:${EXTENSIONS}))"`, `'([^'\\n]+\\.(?:${EXTENSIONS}))'`, `\`([^\`\\n]+\\.(?:${EXTENSIONS}))\``, `<([^<>\\n]+\\.(?:${EXTENSIONS}))>`].join('|'),
  'gi',
);
// Un token sin espacios ni delimitadores habituales de texto, comillas o paréntesis.
const TOKEN = /[^\s"'`<>()[\]{}|,;*]+/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
// Puntuación que cierra una frase y no forma parte de la ruta.
const TRAILING = /[.:!?…]+$/;

export type ImageMatch = {
  /** Ruta tal como aparece en el texto (sin comillas). */
  path: string;
  /** Posición en el texto de la ruta (fin exclusivo). */
  start: number;
  end: number;
};

/** ¿Es una ruta aceptable? Con extensión de imagen y no una URL (esas son de web-links). */
function acceptable(path: string): boolean {
  return IMAGE_END.test(path) && !SCHEME.test(path) && path.length <= 4096;
}

/**
 * Rutas de imagen (absolutas, relativas o con «~/») que contiene el texto.
 * Sin comillas no admite espacios; entre comillas, acentos graves o «< >» sí.
 * Se descartan las URL (las atiende web-links) y las que continúan tras la
 * extensión, como «foo.png.bak».
 */
export function findImagePaths(text: string): ImageMatch[] {
  const resultado: ImageMatch[] = [];
  // Los tramos entrecomillados se enmascaran para no volver a leerlos como tokens.
  let resto = text;
  for (const m of text.matchAll(QUOTED)) {
    const path = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    const start = m.index + 1;
    resto = resto.slice(0, m.index) + ' '.repeat(m[0].length) + resto.slice(m.index + m[0].length);
    if (path.trim() !== path || !acceptable(path)) continue;
    resultado.push({ path, start, end: start + path.length });
  }
  for (const m of resto.matchAll(TOKEN)) {
    let token = m[0];
    let start = m.index;
    // «clave=/ruta»: la ruta es lo que sigue al último «=».
    const igual = token.lastIndexOf('=');
    if (igual >= 0) {
      token = token.slice(igual + 1);
      start += igual + 1;
    }
    token = token.replace(TRAILING, '');
    if (token === '' || !acceptable(token)) continue;
    resultado.push({ path: token, start, end: start + token.length });
  }
  return resultado.sort((a, b) => a.start - b.start);
}

/** Expande «~/» con el HOME del servidor; sin HOME conocido deja la ruta como está. */
export function expandHome(path: string, home: string | null | undefined): string {
  if (!home || !path.startsWith('~/')) return path;
  return `${home.replace(/\/+$/, '')}${path.slice(1)}`;
}

// ------------------------------------------------------------ Líneas ajustadas

export type CellLike = { getChars(): string; getWidth(): number };
export type LineLike = { isWrapped: boolean; length: number; getCell(x: number): CellLike | undefined };
export type BufferLike = { length: number; getLine(y: number): LineLike | undefined };

/** Posición de un carácter en el búfer: x e y empiezan en 1, como los rangos de xterm. */
export type CellPos = { x: number; y: number };

export type LogicalLine = {
  /** Texto de la línea lógica: las filas unidas por `isWrapped`. */
  text: string;
  /** Posición en el búfer de cada unidad UTF-16 de `text`. */
  positions: CellPos[];
};

// Tope de filas que se unen a cada lado: una ruta no ocupa más y evita recorrer
// un búfer entero de una sola línea ajustada.
const MAX_WRAPPED_ROWS = 24;

/**
 * Línea lógica que contiene la fila `y` (índice del búfer, desde 0): une las
 * filas contiguas marcadas como ajustadas. Las celdas vacías cuentan como
 * espacio y las segundas mitades de un carácter ancho no añaden texto, de modo
 * que cada índice del texto se puede volver a llevar a su celda. `cols` limita
 * cada fila a las columnas actuales: tras estrechar la terminal el búfer de
 * xterm conserva celdas viejas más allá de ellas y, unidas a la fila siguiente,
 * romperían la ruta ajustada.
 */
export function logicalLine(buffer: BufferLike, y: number, cols?: number): LogicalLine {
  let primera = y;
  while (primera > 0 && y - primera < MAX_WRAPPED_ROWS && buffer.getLine(primera)?.isWrapped) primera--;
  let ultima = y;
  while (ultima + 1 < buffer.length && ultima - y < MAX_WRAPPED_ROWS && buffer.getLine(ultima + 1)?.isWrapped) ultima++;

  let text = '';
  const positions: CellPos[] = [];
  for (let fila = primera; fila <= ultima; fila++) {
    const linea = buffer.getLine(fila);
    if (!linea) continue;
    const ancho = cols === undefined ? linea.length : Math.min(linea.length, cols);
    for (let x = 0; x < ancho; x++) {
      const celda = linea.getCell(x);
      if (!celda || celda.getWidth() === 0) continue;
      const chars = celda.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) {
        text += chars[i];
        positions.push({ x: x + 1, y: fila + 1 });
      }
    }
  }
  return { text, positions };
}

export type ImageLinkRange = { start: CellPos; end: CellPos };

export type FoundImage = { path: string; range: ImageLinkRange };

/** Rutas de imagen de la línea lógica de la fila `y`, con su rango en el búfer (1-based, fin incluido). */
export function imageLinksAt(buffer: BufferLike, y: number, cols?: number): FoundImage[] {
  const { text, positions } = logicalLine(buffer, y, cols);
  const encontradas: FoundImage[] = [];
  for (const m of findImagePaths(text)) {
    const start = positions[m.start];
    const end = positions[m.end - 1];
    if (start && end) encontradas.push({ path: m.path, range: { start, end } });
  }
  return encontradas;
}

/**
 * Rutas de imagen de las líneas lógicas que tocan las filas [desde, hasta) del
 * búfer (índices desde 0), de la más antigua a la más reciente y sin repetir.
 * Una línea lógica ajustada se analiza entera aunque solo una de sus filas caiga
 * en el rango. `omitir` es una fila: la línea lógica que la contiene se descarta
 * (la que está escribiendo la persona).
 */
export function scanImagePathsInRows(buffer: BufferLike, desde: number, hasta: number, cols?: number, omitir?: number): string[] {
  const vistas = new Set<string>();
  let y = Math.max(0, desde);
  const fin = Math.min(hasta, buffer.length);
  while (y < fin) {
    // Se salta a la última fila de la línea lógica para no analizarla varias veces.
    let primera = y;
    while (primera > 0 && y - primera < MAX_WRAPPED_ROWS && buffer.getLine(primera)?.isWrapped) primera--;
    let siguiente = y + 1;
    while (siguiente < buffer.length && buffer.getLine(siguiente)?.isWrapped) siguiente++;
    if (omitir === undefined || omitir < primera || omitir >= siguiente) {
      const { text } = logicalLine(buffer, y, cols);
      for (const m of findImagePaths(text)) vistas.add(m.path);
    }
    y = siguiente;
  }
  return [...vistas];
}

/** Todas las rutas de imagen del búfer, de la más antigua a la más reciente y sin repetir. */
export function scanBufferImagePaths(buffer: BufferLike, cols?: number): string[] {
  return scanImagePathsInRows(buffer, 0, buffer.length, cols);
}

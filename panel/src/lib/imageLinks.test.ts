import { describe, expect, it } from 'vitest';
import { expandHome, findImagePaths, imageLinksAt, logicalLine, scanBufferImagePaths, scanImagePathsInRows } from './imageLinks.ts';
import type { BufferLike } from './imageLinks.ts';

const rutas = (texto: string) => findImagePaths(texto).map((m) => m.path);

describe('findImagePaths', () => {
  it('reconoce rutas absolutas, relativas y con ~ de las seis extensiones', () => {
    expect(rutas('/tmp/jdev-qa/fitnessia/02-dashboard.png')).toEqual(['/tmp/jdev-qa/fitnessia/02-dashboard.png']);
    expect(rutas('docs/img/logo.png ./a/b.jpg ../c.jpeg')).toEqual(['docs/img/logo.png', './a/b.jpg', '../c.jpeg']);
    expect(rutas('~/.cache/jdev-ai/panel/uploads/2026-11-01-1142-a3f9.webp')).toEqual(['~/.cache/jdev-ai/panel/uploads/2026-11-01-1142-a3f9.webp']);
    expect(rutas('logo.gif icono.svg FOTO.PNG')).toEqual(['logo.gif', 'icono.svg', 'FOTO.PNG']);
  });

  it('da la posición exacta de la ruta en el texto', () => {
    const [m] = findImagePaths('Captura: /tmp/a.png ok');
    expect(m).toEqual({ path: '/tmp/a.png', start: 9, end: 19 });
  });

  it('quita la puntuación final y los delimitadores habituales', () => {
    expect(rutas('Mira /tmp/a.png.')).toEqual(['/tmp/a.png']);
    expect(rutas('(ver /tmp/a.png), y también /tmp/b.jpg:')).toEqual(['/tmp/a.png', '/tmp/b.jpg']);
    expect(rutas('**/tmp/a.png**')).toEqual(['/tmp/a.png']);
    expect(rutas('![x](/tmp/a.png)')).toEqual(['/tmp/a.png']);
    expect(rutas('--out=/tmp/a.png')).toEqual(['/tmp/a.png']);
  });

  it('admite espacios solo entre comillas o comillas angulares', () => {
    expect(rutas('"/tmp/mi captura.png"')).toEqual(['/tmp/mi captura.png']);
    expect(rutas("'/tmp/mi captura.png'")).toEqual(['/tmp/mi captura.png']);
    expect(rutas('`/tmp/mi captura.png`')).toEqual(['/tmp/mi captura.png']);
    expect(rutas('<~/Mis imágenes/foto 1.jpg>')).toEqual(['~/Mis imágenes/foto 1.jpg']);
    // Sin comillas la ruta acaba en el espacio: solo cuenta el último tramo.
    expect(rutas('/tmp/mi captura.png')).toEqual(['captura.png']);
    expect(findImagePaths('"/tmp/mi captura.png"')[0]).toMatchObject({ start: 1, end: 20 });
  });

  it('no confunde un apóstrofo de texto con comillas', () => {
    expect(rutas("no veo /tmp/a.png y it's raro")).toEqual(['/tmp/a.png']);
  });

  it('descarta falsos positivos', () => {
    expect(rutas('foo.png.bak')).toEqual([]);
    expect(rutas('archivo.pngs y imagen.jpg2')).toEqual([]);
    expect(rutas('.png')).toEqual([]);
    expect(rutas('/tmp/.png')).toEqual([]);
    expect(rutas('versión 1.2 y a.png.')).toEqual(['a.png']);
    expect(rutas('script.js leeme.txt')).toEqual([]);
  });

  it('deja las URL para web-links', () => {
    expect(rutas('https://example.com/a/b.png')).toEqual([]);
    expect(rutas('http://localhost:5173/logo.svg y /tmp/a.png')).toEqual(['/tmp/a.png']);
    expect(rutas('"https://example.com/mi imagen.png"')).toEqual([]);
    expect(rutas('<https://example.com/a.webp>')).toEqual([]);
  });
});

describe('expandHome', () => {
  it('expande ~/ con el HOME del servidor', () => {
    expect(expandHome('~/a/b.png', '/home/jorge')).toBe('/home/jorge/a/b.png');
    expect(expandHome('~/a.png', '/home/jorge/')).toBe('/home/jorge/a.png');
  });
  it('no toca otras rutas ni inventa un HOME', () => {
    expect(expandHome('/tmp/a.png', '/home/jorge')).toBe('/tmp/a.png');
    expect(expandHome('a/~/b.png', '/home/jorge')).toBe('a/~/b.png');
    expect(expandHome('~otro/a.png', '/home/jorge')).toBe('~otro/a.png');
    expect(expandHome('~/a.png', null)).toBe('~/a.png');
  });
});

// Búfer falso: cada fila es un texto de ancho fijo; «ancho» marca las celdas de segunda mitad de un carácter ancho.
// `anchoReal` simula el búfer de xterm tras estrechar la terminal: las filas conservan celdas viejas más allá de las columnas actuales.
function fakeBuffer(filas: { text: string; wrapped?: boolean }[], cols: number, anchoReal: number = cols): BufferLike {
  return {
    length: filas.length,
    getLine: (y) => {
      const f = filas[y];
      if (!f) return undefined;
      const celdas: { chars: string; width: number }[] = [];
      for (const c of [...f.text]) {
        // Anchos como los de Unicode 11: CJK y emojis ocupan dos columnas.
        const ancho = c === '好' || (c.codePointAt(0) ?? 0) >= 0x1f000 ? 2 : 1;
        celdas.push({ chars: c, width: ancho });
        if (ancho === 2) celdas.push({ chars: '', width: 0 });
      }
      while (celdas.length < anchoReal) celdas.push({ chars: '', width: 1 });
      return {
        isWrapped: f.wrapped ?? false,
        length: anchoReal,
        getCell: (x) => (celdas[x] ? { getChars: () => celdas[x]!.chars, getWidth: () => celdas[x]!.width } : undefined),
      };
    },
  };
}

describe('líneas ajustadas', () => {
  const buffer = fakeBuffer(
    [
      { text: 'Capturas:' },
      { text: 'abre /tmp/jdev-qa/fitnes' },
      { text: 'sia/02-dashboard.png ya', wrapped: true },
      { text: 'fin' },
    ],
    24,
  );

  it('une las filas marcadas como ajustadas desde cualquiera de ellas', () => {
    expect(logicalLine(buffer, 1).text).toContain('/tmp/jdev-qa/fitnessia/02-dashboard.png');
    expect(logicalLine(buffer, 2).text).toBe(logicalLine(buffer, 1).text);
    expect(logicalLine(buffer, 0).text.trim()).toBe('Capturas:');
  });

  it('devuelve la ruta partida con su rango de dos filas (1-based, fin incluido)', () => {
    const [enlace] = imageLinksAt(buffer, 2);
    expect(enlace?.path).toBe('/tmp/jdev-qa/fitnessia/02-dashboard.png');
    expect(enlace?.range.start).toEqual({ x: 6, y: 2 });
    expect(enlace?.range.end).toEqual({ x: 20, y: 3 });
    expect(imageLinksAt(buffer, 1)[0]?.path).toBe(enlace?.path);
    expect(imageLinksAt(buffer, 0)).toEqual([]);
    expect(imageLinksAt(buffer, 3)).toEqual([]);
  });

  it('cuenta los caracteres anchos para que el rango caiga en las celdas correctas', () => {
    const b = fakeBuffer([{ text: '好好 /tmp/a.png' }], 30);
    const [enlace] = imageLinksAt(b, 0);
    expect(enlace?.path).toBe('/tmp/a.png');
    // «好好» ocupa 4 celdas y el espacio una: la ruta empieza en la celda 6.
    expect(enlace?.range.start).toEqual({ x: 6, y: 1 });
    expect(enlace?.range.end).toEqual({ x: 15, y: 1 });
  });

  it('limita cada fila a las columnas actuales: las celdas viejas más allá de ellas no parten la ruta', () => {
    // Terminal estrechada de 40 a 16 columnas: la fila 0 conserva basura en las celdas 16..39.
    const cols = 16;
    const filas = [{ text: 'abre /tmp/jdev-qa/ESCRITO-ANTES-DE-ESTRECHAR' }, { text: 'foto.png ya', wrapped: true }];
    const ancho = fakeBuffer(filas, cols, 60);
    const sinLimite = logicalLine(ancho, 0).text;
    expect(sinLimite).not.toContain('/tmp/jdev-qa/foto.png');
    const limitada = logicalLine(ancho, 0, cols);
    expect(limitada.text).toBe('abre /tmp/jdev-q' + 'foto.png ya'.padEnd(cols, ' '));
    expect(limitada.positions[16]).toEqual({ x: 1, y: 2 });
    // Con filas realistas: la ruta ajustada se une entre las dos filas.
    const real = fakeBuffer([{ text: 'abre /tmp/jdev-q' }, { text: 'a/foto.png ya', wrapped: true }], cols, 60);
    const [enlace] = imageLinksAt(real, 1, cols);
    expect(enlace?.path).toBe('/tmp/jdev-qa/foto.png');
    expect(enlace?.range.start).toEqual({ x: 6, y: 1 });
    expect(enlace?.range.end).toEqual({ x: 10, y: 2 });
    expect(scanBufferImagePaths(real, cols)).toEqual(['/tmp/jdev-qa/foto.png']);
    // Sin el límite, los espacios sobrantes de la fila 0 cortarían la ruta.
    expect(scanBufferImagePaths(real)).toEqual(['a/foto.png']);
  });

  it('recorre todo el búfer sin repetir rutas, de la más antigua a la más reciente', () => {
    const b = fakeBuffer(
      [{ text: '/tmp/a.png' }, { text: 'otra línea' }, { text: 'ver /tmp/b.png' }, { text: '/tmp/a.png' }, { text: '/tmp/c.jpg y /tmp/' }, { text: 'd.png', wrapped: true }],
      18,
    );
    expect(scanBufferImagePaths(b)).toEqual(['/tmp/a.png', '/tmp/b.png', '/tmp/c.jpg', '/tmp/d.png']);
  });
});

describe('formato del agente: «📸 ruta  descripción»', () => {
  const ruta = '/tmp/jdev-qa/fitnessia/02-dashboard.png';

  it('enlaza la ruta tras el 📸 y no el texto descriptivo', () => {
    expect(rutas(`📸 ${ruta}  Muestra el fallo (clave para decidir).`)).toEqual([ruta]);
    expect(rutas(`📸 ${ruta}`)).toEqual([ruta]);
    expect(rutas(`— 📸 ${ruta}  Muestra el fallo.`)).toEqual([ruta]);
  });

  it('con el guion largo delante, el rango empieza tras «— 📸 »', () => {
    const b = fakeBuffer([{ text: `— 📸 ${ruta}  descripción` }], 100);
    const [enlace] = imageLinksAt(b, 0);
    expect(enlace?.path).toBe(ruta);
    expect(enlace?.range.start).toEqual({ x: 6, y: 1 });
  });

  it('el rango empieza tras el emoji, que ocupa dos columnas', () => {
    const b = fakeBuffer([{ text: `📸 ${ruta}  descripción` }], 100);
    const [enlace] = imageLinksAt(b, 0);
    expect(enlace?.path).toBe(ruta);
    expect(enlace?.range.start).toEqual({ x: 4, y: 1 });
  });
});

describe('formato del agente: «▸ ruta  descripción»', () => {
  const ruta = '/tmp/jdev-qa/fitnessia/02-dashboard.png';
  const linea = `▸ ${ruta}  Dashboard con la tabla vacía: revisa el contraste del botón.`;

  it('enlaza la ruta tras «▸ » y no el texto descriptivo', () => {
    expect(findImagePaths(linea)).toEqual([{ path: ruta, start: 2, end: 2 + ruta.length }]);
    expect(rutas(`▸ ${ruta}  Muestra el fallo (clave para decidir).`)).toEqual([ruta]);
    expect(rutas(`▸ ${ruta}  — comprueba el estado vacío`)).toEqual([ruta]);
    expect(rutas(`▸ ${ruta}`)).toEqual([ruta]);
  });

  it('el rango en pantalla empieza en la ruta y termina antes de la descripción', () => {
    const b = fakeBuffer([{ text: linea }], 100);
    const [enlace] = imageLinksAt(b, 0);
    expect(imageLinksAt(b, 0)).toHaveLength(1);
    expect(enlace?.path).toBe(ruta);
    expect(enlace?.range.start).toEqual({ x: 3, y: 1 });
    expect(enlace?.range.end).toEqual({ x: 2 + ruta.length, y: 1 });
  });

  it('con la línea ajustada en dos filas, el rango cubre solo la ruta', () => {
    const b = fakeBuffer([{ text: linea.slice(0, 30) }, { text: linea.slice(30), wrapped: true }], 30);
    const [enlace] = imageLinksAt(b, 1, 30);
    expect(imageLinksAt(b, 1, 30)).toHaveLength(1);
    expect(enlace?.path).toBe(ruta);
    expect(enlace?.range.start).toEqual({ x: 3, y: 1 });
    expect(enlace?.range.end.y).toBe(2);
    expect(enlace?.range.end.x).toBe(2 + ruta.length - 30);
  });

  it('el bloque «Imágenes para revisar:» da una ruta por línea, en orden', () => {
    const b = fakeBuffer(
      [
        { text: 'Hay 2 imágenes para revisar (al final).' },
        { text: 'Imágenes para revisar:' },
        { text: '▸ /tmp/jdev-qa/a/01-login.png  Login correcto' },
        { text: '▸ /tmp/jdev-qa/a/02-error.png  Error de validación (clave)' },
      ],
      80,
    );
    expect(scanBufferImagePaths(b, 80)).toEqual(['/tmp/jdev-qa/a/01-login.png', '/tmp/jdev-qa/a/02-error.png']);
  });
});

describe('scanImagePathsInRows', () => {
  const b = fakeBuffer(
    [
      { text: '/tmp/a.png' },
      { text: 'texto' },
      { text: 'abre /tmp/jdev-qa/fitnes' },
      { text: 'sia/b.png ya', wrapped: true },
      { text: '/tmp/c.png' },
    ],
    24,
  );

  it('solo mira las filas del rango, pero analiza entera una línea ajustada', () => {
    expect(scanImagePathsInRows(b, 3, 5, 24)).toEqual(['/tmp/jdev-qa/fitnessia/b.png', '/tmp/c.png']);
    expect(scanImagePathsInRows(b, 4, 5, 24)).toEqual(['/tmp/c.png']);
    expect(scanImagePathsInRows(b, 0, 2, 24)).toEqual(['/tmp/a.png']);
  });

  it('omite la línea lógica de la fila indicada (lo que escribe la persona)', () => {
    expect(scanImagePathsInRows(b, 0, 5, 24, 4)).toEqual(['/tmp/a.png', '/tmp/jdev-qa/fitnessia/b.png']);
    expect(scanImagePathsInRows(b, 0, 5, 24, 3)).toEqual(['/tmp/a.png', '/tmp/c.png']);
  });

  it('un rango fuera del búfer devuelve una lista vacía', () => {
    expect(scanImagePathsInRows(b, 10, 20, 24)).toEqual([]);
  });
});

// Limpieza del texto que se copia de la terminal. Claude Code (Ink) maqueta con saltos de línea
// reales al ancho de la terminal, sangra el texto bajo sus marcas («⏺ », «⎿ ») y, al copiar, todo
// eso llega al portapapeles: frases cortadas, sangrías y marcas. Aquí se deshace sin tocar el
// texto normal de una shell. Ante la duda no se une: un salto de más molesta menos que fundir dos
// líneas que no iban juntas.

/**
 * Columnas de holgura al decidir que una línea estaba «casi llena». Ink ajusta el texto a su ancho
 * de maquetación, que puede ser algo menor que las columnas de la terminal (una columna de reserva
 * para evitar el autoajuste del terminal, otra por un carácter ancho mal medido), así que una
 * línea ajustada puede quedar hasta dos columnas por debajo del borde. Con más holgura se unirían
 * líneas cortas a propósito; con menos, se dejarían sin unir párrafos que sí se ajustaron.
 */
export const MARGEN_AJUSTE = 2;

// Marcas de la TUI de Claude Code que abren un bloque (mensaje del asistente, resultado de una herramienta).
const MARCA_SEGURA = /^( *)(⏺|⎿)/;
// «●» es la marca de mensaje en Linux, pero también la usan salidas como `systemctl status`: solo se
// quita si la línea siguiente lleva la sangría de 2 espacios que Claude da a sus continuaciones.
const MARCA_PUNTO = /^( *)● /;
const CAJA = /[│┌┐└┘├┤┬┴┼─━┃╭╮╯╰]/;
const ELEMENTO_DE_LISTA = /^([-*•+]|\d{1,3}[.)])\s+/;
// Líneas que nunca son la continuación de un párrafo ajustado: títulos, citas, tablas y prompts de shell.
const INICIO_DE_BLOQUE = /^(#{1,6}\s|>\s?|\||[$❯]\s)/;

// Palabra que abre una línea de registro, una fecha, una hora o una versión («2026-11-13», «10:02:11», «1.2.3»):
// en un log cada línea es independiente aunque la anterior llegue casi al borde.
const PRINCIPIO_DE_REGISTRO = /^\d+[-:/.]\d/;

/** La línea acaba una frase y la siguiente palabra empieza otra: se deja el salto, que es inofensivo, en vez de arriesgarse. */
const nuevaFrase = (linea: string, palabra: string): boolean => /[.!?:]$/.test(linea) && /^[\p{Lu}\d¿¡"«]/u.test(palabra);

const COMBINANTE = /^\p{M}$/u;

/** Columnas que ocupa un texto en la terminal (los caracteres anchos, CJK y emojis, ocupan dos). */
function anchoVisible(texto: string): number {
  let ancho = 0;
  for (const c of texto) {
    const cp = c.codePointAt(0)!;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || COMBINANTE.test(c)) continue;
    const ancha =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    ancho += ancha ? 2 : 1;
  }
  return ancho;
}

const sangriaDe = (linea: string): number => linea.length - linea.trimStart().length;

/**
 * Sustituye la marca inicial por un espacio, para que el texto conserve su columna y la sangría de
 * las líneas de continuación siga cuadrando (se quita después, de golpe, como sangría común).
 */
function sinMarca(linea: string, siguiente: string | undefined): { texto: string; marcada: boolean } {
  const segura = MARCA_SEGURA.exec(linea);
  if (segura) return { texto: `${segura[1]} ${linea.slice(segura[0].length)}`, marcada: true };
  const punto = MARCA_PUNTO.exec(linea);
  if (punto && (siguiente === undefined || (/^ {2}\S/.test(siguiente) && !/^ *[⏺⎿●]/.test(siguiente)))) {
    return { texto: `${punto[1]} ${linea.slice(punto[0].length - 1)}`, marcada: true };
  }
  return { texto: linea, marcada: false };
}

/**
 * Deja el texto copiado listo para pegar: sin espacios finales, sin marcas de la TUI de Claude, sin
 * la sangría común y con unidas las líneas que Claude ajustó al ancho de la terminal (`cols`).
 * Una línea se une con la siguiente si estaba casi llena (con la primera palabra de la siguiente
 * no habría cabido) y la siguiente continúa su párrafo: no está vacía, no empieza un elemento de
 * lista, un título, una cita, una tabla ni una marca, ni abre una frase tras un punto o una fecha, y
 * lleva exactamente la sangría del texto del bloque; además la línea ha de llegar a la mitad del ancho. No se une dentro de bloques de código (entre vallas ```), en tablas o líneas con
 * caracteres de caja, ni cuando la línea acaba en una palabra larguísima (una URL partida a mitad
 * de palabra no admite un espacio) o en `;`, `{` o `}`, que huelen a código.
 */
export function cleanCopiedText(texto: string, cols: number): string {
  const crudas = texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());
  // La longitud «original» es la de la línea tal como se veía en pantalla, con su sangría y su marca.
  const anchos = crudas.map(anchoVisible);

  const marcadas: boolean[] = [];
  let lineas = crudas.map((l, i) => {
    const siguiente = crudas.slice(i + 1).find((x) => x !== '');
    const r = sinMarca(l, siguiente);
    marcadas.push(r.marcada);
    return r.texto;
  });

  const comun = Math.min(...lineas.filter((l) => l !== '').map(sangriaDe));
  if (Number.isFinite(comun) && comun > 0) lineas = lineas.map((l) => l.slice(Math.min(comun, sangriaDe(l))));

  if (!Number.isFinite(cols) || cols < 20) return lineas.join('\n');

  const salida: string[] = [];
  let enCodigo = false;
  // Si la línea anterior es prosa (candidata a seguir en la misma línea), la columna donde empieza
  // el texto de su bloque: tras el marcador, si era un elemento de lista.
  let sangriaTexto: number | null = null;

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]!;
    const contenido = l.trimStart();
    const sangria = l.length - contenido.length;
    if (contenido.startsWith('```')) {
      enCodigo = !enCodigo;
      salida.push(l);
      sangriaTexto = null;
      continue;
    }
    if (enCodigo || contenido === '') {
      salida.push(l);
      sangriaTexto = null;
      continue;
    }

    const lista = ELEMENTO_DE_LISTA.exec(contenido);
    const empiezaBloque = marcadas[i]! || lista !== null || INICIO_DE_BLOQUE.test(contenido);
    const primeraPalabra = contenido.split(/\s+/)[0]!;
    const caja = CAJA.test(contenido);
    if (
      sangriaTexto !== null &&
      !empiezaBloque &&
      !caja &&
      sangria === sangriaTexto &&
      !nuevaFrase(salida[salida.length - 1]!, primeraPalabra) &&
      !PRINCIPIO_DE_REGISTRO.test(primeraPalabra) &&
      // Una línea corta no estaba «casi llena»: solo una palabra enorme habría hecho saltar el ajuste.
      anchos[i - 1]! >= cols / 2 &&
      anchos[i - 1]! + 1 + anchoVisible(primeraPalabra) > cols - MARGEN_AJUSTE
    ) {
      salida[salida.length - 1] += ` ${contenido}`;
    } else {
      salida.push(l);
      sangriaTexto = sangria + (lista ? lista[0].length : 0);
    }

    // Una línea de caja, o que acaba en una palabra muy larga o en algo propio del código, no se une con la siguiente.
    const ultimaPalabra = contenido.split(/\s+/).pop()!;
    if (caja || anchoVisible(ultimaPalabra) > cols / 2 || /[;{}]$/.test(contenido)) sangriaTexto = null;
  }

  return salida.join('\n');
}

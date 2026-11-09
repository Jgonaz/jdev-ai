// Lectura de la pantalla de una terminal con Claude Code (capture-pane): detecta las
// ventanas y menús de su TUI, que se llevan lo que se pega mientras están abiertos, y
// extrae la respuesta visible de la ventana de `/btw`. Funciones puras, sin tmux.
//
// Los textos son de Claude Code (2.1.319) y pueden cambiar: ante la duda no se detecta
// nada (se envía como siempre) y la lectura de /btw cae en lo visible o en «pendiente».

export type TuiWindowKind = 'btw' | 'menu' | 'dialog';

export type TuiWindow = {
  kind: TuiWindowKind;
  /** Línea de la pantalla que lo delata (recortada). */
  hint: string;
  /** Solo `btw`: la respuesta ya está (el pie ofrece copiar, navegar o bifurcar); si no, sigue en «Answering…». */
  ready: boolean;
};

/** Líneas con texto del final de la pantalla donde se busca el pie de una ventana (el pie queda sobre la caja de entrada y la barra de estado). */
const TAIL_LINES = 10;

const BTW_CLOSE = /\bEsc to close\b/i;
// «↑/↓ to scroll · c to copy · f to fork · Esc to close» y «⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close»;
// tras pulsar `c`, «c to copy» pasa a «Copied to clipboard».
const BTW_READY = /\bc to copy\b|\bCopied to clipboard\b|\bto browse\b|\bto scroll\b|\bf to fork\b/i;
const MENU_FOOTER = /\bEsc to (?:cancel|exit|go back)\b|\bEnter to (?:select|confirm)\b/i;
const DIALOG = /\bDo you want to [^?\n]{1,80}\?|\bWould you like to [^?\n]{1,80}\?/;

/** Líneas de la captura sin espacios finales. */
const lineas = (captura: string): string[] => captura.split('\n').map((l) => l.replace(/\s+$/, ''));

/**
 * La ventana o el menú de Claude que hay abierto en la captura, o null si está el prompt normal.
 * Detecta el pie de la ventana de `/btw` («Esc to close», con las ayudas para copiar o navegar
 * cuando ya hay respuesta), los menús y selectores («Esc to cancel», «Esc to exit»,
 * «Enter to select|confirm») y los diálogos de permiso («Do you want to proceed?»). No confunde
 * el aviso de un agente trabajando («esc to interrupt»).
 */
export function detectTuiWindow(captura: string): TuiWindow | null {
  const cola = lineas(captura).filter((l) => l.trim() !== '').slice(-TAIL_LINES);
  // De abajo arriba: manda el pie más cercano a la caja de entrada.
  for (let i = cola.length - 1; i >= 0; i--) {
    const l = cola[i]!;
    const hint = l.trim().slice(0, 160);
    if (BTW_CLOSE.test(l)) return { kind: 'btw', hint, ready: BTW_READY.test(l) };
    if (MENU_FOOTER.test(l)) return { kind: 'menu', hint, ready: false };
  }
  for (let i = cola.length - 1; i >= 0; i--) {
    const l = cola[i]!;
    if (DIALOG.test(l)) return { kind: 'dialog', hint: l.trim().slice(0, 160), ready: false };
  }
  return null;
}

export type BtwCapture = { answer: string; truncated: boolean };

// La cabecera de la ventana («  /btw <pregunta>…», con dos espacios) no se confunde con el eco del prompt («❯ /btw …»).
const BTW_HEADING = /^ {2}\/btw(?:\s|$)/;
const BTW_SCROLL = /to scroll/i;

/** Lo que muestra la ventana de `/btw` en una captura: el cuerpo tal cual (con sus huecos) y si se ve su cabecera. */
type BtwView = { body: string[]; heading: boolean; footer: string };

function readBtwView(captura: string): BtwView | null {
  const todas = lineas(captura);
  let pie = -1;
  for (let i = todas.length - 1; i >= 0; i--) {
    if (BTW_CLOSE.test(todas[i]!)) {
      pie = i;
      break;
    }
  }
  if (pie < 0) return null;
  // Se sube mientras sea cuerpo de la respuesta (sangrado 4 espacios o línea en blanco) hasta la cabecera.
  let inicio = pie;
  let heading = false;
  for (let i = pie - 1; i >= 0; i--) {
    const l = todas[i]!;
    if (BTW_HEADING.test(l)) {
      heading = true;
      inicio = i;
      break;
    }
    if (l.trim() !== '' && !l.startsWith('    ')) break;
    inicio = i;
  }
  const body = todas.slice(heading ? inicio + 1 : inicio, pie).map((l) => l.replace(/^ {1,4}/, ''));
  return { body, heading, footer: todas[pie]! };
}

const sinHuecosExtremos = (lineas: string[]): string[] => {
  let a = 0;
  let b = lineas.length;
  while (a < b && lineas[a]!.trim() === '') a++;
  while (b > a && lineas[b - 1]!.trim() === '') b--;
  return lineas.slice(a, b);
};

/**
 * La respuesta visible de la ventana de `/btw` en la captura: las líneas entre su cabecera
 * (`  /btw pregunta`) y el pie, sin la sangría de 4 espacios. Con varias entradas de `/btw`
 * en la ventana (historial) es la última. `truncated` es true si la ventana tiene scroll o
 * su cabecera ya no se ve (la respuesta es más alta que la pantalla); null si no hay pie
 * ni respuesta que leer.
 */
export function extractBtwAnswer(captura: string): BtwCapture | null {
  const vista = readBtwView(captura);
  if (!vista) return null;
  const cuerpo = sinHuecosExtremos(vista.body);
  if (cuerpo.length === 0) return null;
  return { answer: cuerpo.join('\n'), truncated: !vista.heading || BTW_SCROLL.test(vista.footer) };
}

/**
 * Una pantalla de la respuesta de `/btw` para reconstruirla al desplazarla: las líneas del cuerpo
 * sin el hueco que la ventana deja bajo la cabecera ni el de encima del pie, pero con los huecos
 * (párrafos) de dentro. null si no hay ventana ni cuerpo.
 */
export function extractBtwPage(captura: string): string[] | null {
  const vista = readBtwView(captura);
  if (!vista) return null;
  const cuerpo = [...vista.body];
  if (vista.heading && cuerpo.length > 0 && cuerpo[0]!.trim() === '') cuerpo.shift();
  if (cuerpo.length > 0 && cuerpo[cuerpo.length - 1]!.trim() === '') cuerpo.pop();
  return cuerpo.some((l) => l.trim() !== '') ? cuerpo : null;
}

/**
 * Une la pantalla siguiente a lo reconstruido hasta ahora por solapamiento: busca el mayor número
 * de líneas del final de `acumulado` que coincide con el principio de `pagina`. `solapa` es false si no
 * hay ninguna coincidencia (el desplazamiento fue mayor que la pantalla: se ha perdido un trozo), y
 * entonces la página se añade igualmente.
 */
export function mergeBtwPages(acumulado: string[], pagina: string[]): { lines: string[]; solapa: boolean } {
  const tope = Math.min(acumulado.length, pagina.length);
  for (let k = tope; k >= 1; k--) {
    let igual = true;
    for (let j = 0; j < k; j++) {
      if (acumulado[acumulado.length - k + j] !== pagina[j]) {
        igual = false;
        break;
      }
    }
    // Una coincidencia de huecos sueltos no prueba nada.
    if (igual && pagina.slice(0, k).some((l) => l.trim() !== '')) return { lines: [...acumulado, ...pagina.slice(k)], solapa: true };
  }
  return { lines: [...acumulado, ...pagina], solapa: false };
}

/** Texto final de la respuesta reconstruida (sin huecos al principio ni al final). */
export const joinBtwLines = (lineas: string[]): string => sinHuecosExtremos(lineas).join('\n');

// Lectura de la pantalla de una terminal con Claude Code (capture-pane): detecta las
// ventanas y menús de su TUI, que se llevan lo que se pega mientras están abiertos, y
// extrae la respuesta visible de la ventana de `/btw`. Funciones puras, sin tmux.
//
// Los textos son de Claude Code (2.1.319 para las ventanas y /btw; 2.1.325 para el menú de
// preguntas de `AskUserQuestion` y los diálogos de permiso) y pueden cambiar: ante la duda no
// se detecta nada (se envía como siempre), la lectura de /btw cae en lo visible o en «pendiente»
// y los lectores del menú y del permiso devuelven null (el chat no pulsa nada).

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

// ---------------------------------------------------------------- Preguntas (AskUserQuestion)
//
// Claude Code 2.1.325. El menú se pinta bajo una línea de guiones (el borde del prompt):
//
//   ←  ☐ Color  ☐ Frutas  ✔ Submit  →      pestañas (sin «←…→» ni «Submit» con una sola pregunta; ☒ = contestada)
//
//   ¿Frutas?                               la pregunta (si es larga, parte en líneas con «│ » delante)
//
//   ❯ 1. [✔] Pera                          opciones numeradas (con `[ ]`/`[✔]` solo en la selección múltiple)
//        Fruta dulce.                      su descripción
//     4. [ ] Type something                la fila de texto libre: la última numerada, antes del separador
//        Submit                            solo en la selección múltiple
//   ──────────
//     5. Chat about this
//
// Con varias preguntas, tras la última sale «Review your answers» con `● pregunta` / `→ respuesta`
// y «Ready to submit your answers?» con `1. Submit answers` y `2. Cancel`.

/** Una pestaña de la fila superior del menú: la cabecera de la pregunta y si ya tiene respuesta. */
export type TuiTab = { header: string; answered: boolean };

/** Una fila numerada. `checked` es null fuera de la selección múltiple. */
export type TuiRow = { n: number; label: string; checked: boolean | null; cursor: boolean };

/** Menú de una pregunta. `options` son las filas numeradas salvo la última, `other` («Type something») con el texto tecleado. */
export type TuiQuestionMenu = {
  kind: 'menu';
  tabs: TuiTab[];
  /** La fila de pestañas incluye «Submit»: se ven todas. */
  submitTab: boolean;
  /** Texto de la pregunta visible (líneas unidas con un espacio). */
  question: string;
  options: TuiRow[];
  other: TuiRow & { text: string };
  multiSelect: boolean;
  /** Fila «Submit» de la selección múltiple, con si tiene el cursor. */
  submit: { cursor: boolean } | null;
  /** Número de la fila numerada con el cursor; null si está en «Submit», en «Chat about this» o no se ve. */
  cursorRow: number | null;
  /** El cursor está en «Chat about this» (la fila bajo el separador): no se debe pulsar Enter. */
  chatCursor: boolean;
};

/** Pantalla «Review your answers». */
export type TuiQuestionReview = {
  kind: 'review';
  tabs: TuiTab[];
  submitTab: boolean;
  entries: { question: string; answer: string }[];
  /** `1. Submit answers` y `2. Cancel`. */
  options: TuiRow[];
};

export type TuiQuestionScreen = TuiQuestionMenu | TuiQuestionReview;

const SEPARADOR = /^─{5,}$/;
const TYPE_SOMETHING = /^Type something\.?$/i;
// Fila numerada: sangría de hasta 4 columnas con el cursor `❯` (en los menús de preguntas en la primera columna; en los
// diálogos de permiso con una más). Las descripciones llevan más sangría y no la confunden.
const FILA_NUMERADA = /^ {0,2}(❯)? {0,2}(\d{1,2})\.\s+(\S.*)$/;
const MARCA = /^\[([ ✔✓xX])\]\s+(.*)$/;
// Una pregunta larga se parte en varias líneas y la TUI pinta un «│ » al principio de cada una.
const PREFIJO_PREGUNTA = /^│ ?/;

/** Espacios colapsados y sin los de los extremos. */
export const normalizeTuiText = (texto: string): string => texto.replace(/\s+/g, ' ').trim();

/**
 * Si `visible` (lo que se ve en pantalla, quizá recortado con «…» o con la primera línea de una etiqueta partida) es la
 * etiqueta `completa` o su comienzo. Un comienzo sin puntos suspensivos solo vale si es largo (12 caracteres o toda la
 * etiqueta): un prefijo corto casaría con cualquier cosa.
 */
export function tuiTextMatches(visible: string, completa: string): boolean {
  const recortado = /…$|\.\.\.$/.test(visible.trim());
  const v = normalizeTuiText(visible).replace(/…$|\.\.\.$/, '').trimEnd();
  const f = normalizeTuiText(completa);
  if (v === '') return false;
  if (v === f) return true;
  return f.startsWith(v) && (recortado || v.length >= Math.min(f.length, 12));
}

function parseFila(linea: string): TuiRow | null {
  const m = FILA_NUMERADA.exec(linea);
  if (!m) return null;
  const marca = MARCA.exec(m[3]!);
  return { n: Number(m[2]), label: (marca ? marca[2]! : m[3]!).trim(), checked: marca ? marca[1] !== ' ' : null, cursor: m[1] === '❯' };
}

/** Pestañas de una línea («←  ☐ Color  ☒ Frutas  ✔ Submit  →» o « ☐ Tamaño»); null si la línea no es una fila de pestañas. */
function parseTabs(linea: string): { tabs: TuiTab[]; submitTab: boolean } | null {
  const t = linea.trim().replace(/^←\s*/, '').replace(/\s*→$/, '');
  if (!/^[☐☒✔]\s/.test(t)) return null;
  const tabs: TuiTab[] = [];
  let submitTab = false;
  for (const parte of t.split(/\s+(?=[☐☒✔]\s)/)) {
    const m = /^([☐☒✔])\s+(\S.*)$/.exec(parte);
    if (!m) return null;
    if (m[1] === '✔' && m[2] === 'Submit') submitTab = true;
    else tabs.push({ header: m[2]!, answered: m[1] !== '☐' });
  }
  return tabs.length > 0 ? { tabs, submitTab } : null;
}

/**
 * El menú de preguntas de `AskUserQuestion` o su pantalla de revisión en la captura, o null si no hay (o no se reconoce).
 * Exige la fila de pestañas justo bajo una línea de guiones (una lista de tareas «☐ …» del historial no cuenta) y,
 * debajo, o bien la pregunta con sus opciones numeradas, o bien «Review your answers» con sus opciones.
 */
export function readQuestionScreen(captura: string): TuiQuestionScreen | null {
  const todas = lineas(captura);
  for (let i = todas.length - 1; i >= 1; i--) {
    if (!SEPARADOR.test(todas[i - 1]!.trim())) continue;
    const pestanas = parseTabs(todas[i]!);
    if (!pestanas) continue;
    const resto = todas.slice(i + 1);
    let k = 0;
    while (k < resto.length && resto[k]!.trim() === '') k++;
    if (k >= resto.length) return null;
    return /^Review your answers\b/.test(resto[k]!.trim()) ? leeRevision(pestanas, resto, k + 1) : leeMenu(pestanas, resto, k);
  }
  return null;
}

function leeMenu(pestanas: { tabs: TuiTab[]; submitTab: boolean }, resto: string[], desde: number): TuiQuestionMenu | null {
  let k = desde;
  const pregunta: string[] = [];
  while (k < resto.length && resto[k]!.trim() !== '') pregunta.push(resto[k++]!.trim().replace(PREFIJO_PREGUNTA, ''));
  const filas: TuiRow[] = [];
  let submit: { cursor: boolean } | null = null;
  let chatCursor = false;
  for (; k < resto.length; k++) {
    const l = resto[k]!;
    if (l.trim() === '') continue;
    if (SEPARADOR.test(l.trim())) {
      // Bajo el separador va «Chat about this», que también puede tener el cursor.
      const siguiente = resto.slice(k + 1).find((x) => x.trim() !== '');
      chatCursor = siguiente !== undefined && parseFila(siguiente)?.cursor === true;
      break;
    }
    const fila = parseFila(l);
    if (fila) {
      filas.push(fila);
      continue;
    }
    const s = /^ ?(❯)? {1,6}Submit$/.exec(l);
    if (s) {
      submit = { cursor: s[1] === '❯' };
      continue;
    }
    // Descripciones (más sangría) o su continuación; cualquier otra cosa es lo que hay bajo el menú.
    if (!/^ {4,}\S/.test(l)) break;
  }
  const otra = filas[filas.length - 1];
  if (pregunta.length === 0 || !otra) return null;
  const cursor = filas.find((f) => f.cursor)?.n ?? null;
  const texto = TYPE_SOMETHING.test(otra.label) ? '' : otra.label;
  return {
    kind: 'menu',
    tabs: pestanas.tabs,
    submitTab: pestanas.submitTab,
    question: normalizeTuiText(pregunta.join(' ')),
    options: filas.slice(0, -1),
    other: { ...otra, text: texto },
    multiSelect: filas.some((f) => f.checked !== null),
    submit,
    cursorRow: cursor,
    chatCursor,
  };
}

function leeRevision(pestanas: { tabs: TuiTab[]; submitTab: boolean }, resto: string[], desde: number): TuiQuestionReview | null {
  const entradas: { question: string; answer: string }[] = [];
  let k = desde;
  let ultimo: 'question' | 'answer' = 'question';
  for (; k < resto.length; k++) {
    const l = resto[k]!;
    if (/^Ready to submit\b/.test(l.trim())) break;
    const p = /^\s*●\s+(.*)$/.exec(l);
    const r = /^\s*→\s+(.*)$/.exec(l);
    if (p) {
      entradas.push({ question: p[1]!.trim(), answer: '' });
      ultimo = 'question';
    } else if (r && entradas.length > 0) {
      entradas[entradas.length - 1]!.answer = r[1]!.trim();
      ultimo = 'answer';
    } else if (l.trim() !== '' && entradas.length > 0) {
      // Una pregunta o una respuesta larga se parte en varias líneas sangradas.
      const e = entradas[entradas.length - 1]!;
      e[ultimo] = `${e[ultimo]} ${l.trim().replace(PREFIJO_PREGUNTA, '')}`.trim();
    }
  }
  const opciones: TuiRow[] = [];
  for (k++; k < resto.length; k++) {
    const l = resto[k]!;
    if (l.trim() === '') {
      if (opciones.length > 0) break;
      continue;
    }
    const fila = parseFila(l);
    if (!fila) break;
    opciones.push(fila);
  }
  if (entradas.length === 0 || opciones.length === 0) return null;
  return { kind: 'review', tabs: pestanas.tabs, submitTab: pestanas.submitTab, entries: entradas.map((e) => ({ question: normalizeTuiText(e.question), answer: normalizeTuiText(e.answer) })), options: opciones };
}

// ---------------------------------------------------------------- Permisos de herramienta
//
// Claude Code 2.1.325. Bajo una línea de guiones: el título («Bash command»), a veces un consejo, el detalle de
// lo que va a hacer entre líneas `╌╌╌`, la pregunta («Do you want to proceed?») y las opciones numeradas, con
// el cursor `❯` en la primera y el pie «Esc to cancel · Tab to amend». En terminales estrechas una opción se parte en
// varias líneas sangradas.

export type TuiPermissionDialog = {
  /** Primera línea bajo el borde del diálogo («Bash command»); '' si no se ve. */
  title: string;
  /** «Do you want to proceed?» */
  question: string;
  options: { n: number; label: string; cursor: boolean }[];
  /** Texto del diálogo entero (del título a la última opción), para saber si sigue siendo el mismo. */
  signature: string;
};

/** Ancho de la pantalla: el de la línea de guiones más larga (el borde del prompt y de los diálogos llega de lado a lado); 0 si no hay. */
function anchoDePantalla(todas: readonly string[]): number {
  let ancho = 0;
  for (const l of todas) if (SEPARADOR.test(l.trim())) ancho = Math.max(ancho, [...l.trim()].length);
  return ancho;
}

/**
 * Une la continuación de una etiqueta partida por la TUI. Casi siempre el corte es entre palabras y va un espacio; pero
 * una palabra más larga que la caja (una ruta) se corta a mitad, y ahí no hay espacio que poner. Se sabe por dos
 * señales a la vez: la línea anterior llega al ancho de la pantalla (una cortada entre palabras suele quedarse corta) y
 * las dos mitades de la palabra, juntas, ocupan casi todo el ancho (con palabras normales sería imposible). Sin el
 * ancho de la pantalla (no se ve ninguna línea de guiones) se pone el espacio. Es una heurística solo de presentación:
 * lo que se compara al contestar sale de la misma función, así que siempre coincide.
 * `anterior` es la línea física anterior, tal como se ve (con su sangría).
 */
function unePartida(etiqueta: string, anterior: string, continuacion: string, ancho: number): string {
  if (ancho > 0 && [...anterior].length >= ancho - 3) {
    const cola = /\S+$/.exec(etiqueta)?.[0] ?? '';
    const cabeza = /^\S+/.exec(continuacion)?.[0] ?? '';
    if ([...cola].length + [...cabeza].length >= ancho - 10) return `${etiqueta}${continuacion}`;
  }
  return `${etiqueta} ${continuacion}`;
}

const PERMISO_PREGUNTA = /^(?:Do you want to [^?\n]{1,120}|Would you like to [^?\n]{1,120})\?$/;
const PIE_MENU = /\bEsc to (?:cancel|exit|go back)\b|\bEnter to (?:select|confirm)\b/i;

/**
 * El diálogo de permiso de una herramienta en la captura, con sus opciones completas, o null si no hay uno (o no se
 * ven opciones numeradas bajo su pregunta).
 */
export function readPermissionDialog(captura: string): TuiPermissionDialog | null {
  const todas = lineas(captura);
  const ancho = anchoDePantalla(todas);
  for (let q = todas.length - 1; q >= 0; q--) {
    const pregunta = todas[q]!.trim();
    if (!PERMISO_PREGUNTA.test(pregunta)) continue;
    const opciones: TuiPermissionDialog['options'] = [];
    let ultima = q;
    for (let i = q + 1; i < todas.length; i++) {
      const l = todas[i]!;
      if (l.trim() === '') {
        if (opciones.length > 0) break;
        continue;
      }
      if (PIE_MENU.test(l)) break;
      const fila = parseFila(l);
      if (fila) {
        opciones.push({ n: fila.n, label: fila.label, cursor: fila.cursor });
        ultima = i;
      } else if (opciones.length > 0 && /^ {3,}\S/.test(l)) {
        const o = opciones[opciones.length - 1]!;
        o.label = unePartida(o.label, todas[ultima]!, l.trim(), ancho);
        ultima = i;
      } else break;
    }
    if (opciones.length === 0) return null;
    // El título es la primera línea con texto bajo el último borde del diálogo.
    let borde = -1;
    for (let i = q - 1; i >= 0 && q - i <= 60; i--) {
      if (SEPARADOR.test(todas[i]!.trim())) {
        borde = i;
        break;
      }
    }
    let inicio = q;
    let titulo = '';
    if (borde >= 0) {
      for (let i = borde + 1; i < q; i++) {
        if (todas[i]!.trim() !== '') {
          inicio = i;
          titulo = todas[i]!.trim();
          break;
        }
      }
    }
    return { title: titulo, question: pregunta, options: opciones, signature: todas.slice(inicio, ultima + 1).join('\n') };
  }
  return null;
}

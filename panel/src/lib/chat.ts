// Lógica pura de la vista chat de una terminal: convierte los eventos de la
// transcripción en elementos (mensajes de la persona, respuestas del agente y
// grupos de herramientas), busca texto en ellos y da formato a lo que se pinta.

import type { Token, Tokens } from 'marked';
import { decodeEntities, lex } from '../components/Markdown.tsx';
import type { AgentEvent, QuestionItem } from '../../shared/follow.ts';
import { questionSearchTexts } from './prompts.ts';
import { formatElapsed, formatTokens } from './statusline.ts';

export type ChatResult = { error: boolean; summary: string; lines: number; output?: string };

export type ChatStep = {
  id: string;
  tool: string;
  verb: string;
  target: string;
  detail?: string;
  at: number | null;
  result?: ChatResult;
};

/** Cómo terminó una pregunta de `AskUserQuestion`: `answers` es `{ pregunta: respuesta }` tal como la guardó Claude Code, si la trae. */
export type ChatQuestionResult = { error: boolean; summary: string; answers?: Record<string, string>; /** Hora de la línea del resultado, si la trae. */ at?: number };

export type ChatItem =
  | { kind: 'user'; key: string; text: string; at: number | null; images: number }
  | { kind: 'agent'; key: string; text: string; at: number | null }
  /** Comando de Claude Code (`/goal close`) con su salida local, si la tuvo. `name` va sin la barra. */
  | { kind: 'command'; key: string; name: string; args: string; at: number | null; output?: { text: string; error: boolean } }
  /** Pregunta de Claude a la persona (`AskUserQuestion`), en el sitio de su `tool_use`. Está pendiente mientras no tenga `result`. */
  | { kind: 'question'; key: string; id: string; questions: QuestionItem[]; at: number | null; result?: ChatQuestionResult }
  /** Herramientas ejecutadas seguidas, entre dos mensajes. */
  | { kind: 'tools'; key: string; steps: ChatStep[]; errors: number; at: number | null };

/** El turno en curso: lo que va desde el último mensaje de la persona. */
export type ChatTurn = {
  /** Hora de ese mensaje; null si aún no hay ninguno o la transcripción no traía hora. */
  startedAt: number | null;
  /** Tokens de salida generados en el turno: la suma del último valor de cada mensaje del asistente. */
  output: number;
  /** Último valor de cada mensaje (por `id`) del turno, para no contar dos veces el `usage` que repite cada línea. */
  byId: ReadonlyMap<string, number>;
};

export type ChatModel = {
  items: ChatItem[];
  /** Contador para dar claves estables a los elementos nuevos. */
  next: number;
  turn: ChatTurn;
};

export const EMPTY_TURN: ChatTurn = { startedAt: null, output: 0, byId: new Map() };

export const EMPTY_CHAT: ChatModel = { items: [], next: 0, turn: EMPTY_TURN };

/** Turno nuevo, abierto por un mensaje de la persona: se olvidan los tokens del anterior. */
export const startTurn = (at: number | null): ChatTurn => ({ startedAt: at, output: 0, byId: new Map() });

/**
 * Suma al turno los tokens de salida de un mensaje del asistente. Un mismo `id` llega varias veces (Claude Code escribe una
 * línea por bloque con el mismo `usage`, y el valor crece mientras se genera): cuenta el último, no la suma. Devuelve un
 * turno nuevo, o el mismo si no cambia nada.
 */
export function addTurnUsage(turn: ChatTurn, id: string, output: number): ChatTurn {
  const previo = turn.byId.get(id);
  if (previo === output) return turn;
  const byId = new Map(turn.byId);
  byId.set(id, output);
  return { ...turn, output: turn.output - (previo ?? 0) + output, byId };
}

/** «↓ 950 tokens», «↓ 3,4k tokens», «↓ 12k tokens»: los de salida del turno, con un decimal entre 1 000 y 10 000 (donde «3k» diría poco). */
export function turnTokensLabel(output: number): string | null {
  if (output <= 0) return null;
  const n = output >= 1000 && output < 10_000 ? `${(output / 1000).toFixed(1).replace('.', ',')}k` : formatTokens(output);
  return `↓ ${n} tokens`;
}

/**
 * Lo que enseña el indicador de trabajo: el tiempo desde el último mensaje de la persona (o, si no hay, desde `desde`,
 * el momento en que la sesión empezó a trabajar) y los tokens de salida del turno, si ya se conocen.
 */
export function workingView(turn: ChatTurn, desde: number, ahora: number): { elapsed: string; tokens: string | null } {
  return { elapsed: formatElapsed(ahora - (turn.startedAt ?? desde)), tokens: turnTokensLabel(turn.output) };
}

/** El comando tal como se escribe: «/goal close». */
export const commandLine = (c: { name: string; args: string }): string => `/${c.name}${c.args !== '' ? ` ${c.args}` : ''}`;

/** Texto que se pinta de un resultado: la salida, si la hay, y si no su primera línea. */
export const resultText = (r: ChatResult): string => r.output ?? r.summary;

/**
 * Suma los eventos nuevos a la conversación; con `reset` empieza de cero. Las
 * herramientas seguidas forman un grupo (también entre respuestas del servidor)
 * y cada resultado se asocia a su herramienta por id, aunque llegue en otro trozo.
 * No modifica el modelo anterior: los elementos que cambian son objetos nuevos,
 * para que las vistas memoizadas solo repinten lo que cambió.
 */
export function applyChatEvents(previo: ChatModel, eventos: readonly AgentEvent[], reset = false): ChatModel {
  if (!reset && eventos.length === 0) return previo;
  const base = reset ? EMPTY_CHAT : previo;
  const items = base.items.slice();
  let next = base.next;
  let turn = base.turn;
  // Posición de cada herramienta (elemento, paso) y de cada pregunta (elemento, -1), construida solo si llega algún resultado.
  const tabla: { m: Map<string, [number, number]> | null } = { m: null };
  const indexa = (): Map<string, [number, number]> => {
    if (tabla.m) return tabla.m;
    const m = new Map<string, [number, number]>();
    items.forEach((it, i) => {
      if (it.kind === 'tools') it.steps.forEach((s, j) => m.set(s.id, [i, j]));
      else if (it.kind === 'question') m.set(it.id, [i, -1]);
    });
    tabla.m = m;
    return m;
  };
  // Elementos ya copiados en esta llamada: se clonan una sola vez.
  const propios = new Set<number>();
  const clona = (i: number): Extract<ChatItem, { kind: 'tools' }> => {
    const it = items[i] as Extract<ChatItem, { kind: 'tools' }>;
    if (!propios.has(i)) {
      items[i] = { ...it, steps: it.steps.slice() };
      propios.add(i);
    }
    return items[i] as Extract<ChatItem, { kind: 'tools' }>;
  };

  for (const e of eventos) {
    if (e.type === 'user') {
      items.push({ kind: 'user', key: `u${next++}`, text: e.text, at: e.at, images: e.images ?? 0 });
      turn = startTurn(e.at);
    } else if (e.type === 'usage') {
      turn = addTurnUsage(turn, e.id, e.output);
    } else if (e.type === 'message') {
      items.push({ kind: 'agent', key: `a${next++}`, text: e.text, at: e.at });
    } else if (e.type === 'command') {
      items.push({ kind: 'command', key: `c${next++}`, name: e.name, args: e.args, at: e.at });
    } else if (e.type === 'command-output') {
      // La salida local va justo tras su comando (aunque llegue en otra respuesta): se une a él.
      const ultimo = items.length - 1;
      const it = items[ultimo];
      if (it && it.kind === 'command' && !it.output) items[ultimo] = { ...it, output: { text: e.text, error: e.error } };
    } else if (e.type === 'question') {
      items.push({ kind: 'question', key: `q${next++}`, id: e.id, questions: e.questions, at: e.at });
      tabla.m?.set(e.id, [items.length - 1, -1]);
    } else if (e.type === 'tool') {
      const paso: ChatStep = { id: e.id, tool: e.tool, verb: e.verb, target: e.target, detail: e.detail, at: e.at };
      const ultimo = items.length - 1;
      if (ultimo >= 0 && items[ultimo]!.kind === 'tools') {
        const g = clona(ultimo);
        g.steps.push(paso);
        tabla.m?.set(e.id, [ultimo, g.steps.length - 1]);
      } else {
        items.push({ kind: 'tools', key: `t${next++}`, steps: [paso], errors: 0, at: e.at });
        propios.add(items.length - 1);
        tabla.m?.set(e.id, [items.length - 1, 0]);
      }
    } else if (e.type === 'result') {
      const pos = indexa().get(e.id);
      if (!pos) continue;
      const destino = items[pos[0]]!;
      if (destino.kind === 'question') {
        // Una pregunta se contesta una sola vez: el primer resultado manda.
        if (!destino.result) items[pos[0]] = { ...destino, result: { error: e.error, summary: e.summary, ...(e.answers !== undefined ? { answers: e.answers } : {}), ...(typeof e.at === 'number' ? { at: e.at } : {}) } };
        continue;
      }
      const g = clona(pos[0]);
      const paso = g.steps[pos[1]]!;
      if (paso.result) continue;
      g.steps[pos[1]] = { ...paso, result: { error: e.error, summary: e.summary, lines: e.lines, ...(e.output !== undefined ? { output: e.output } : {}) } };
      if (e.error) g.errors++;
    }
    // Los eventos «task» son de subagentes: la conversación no los tiene.
  }
  // Solo tokens: no hay elementos nuevos, y se conserva la lista para que no se repinte lo que depende de ella.
  if (!reset && eventos.every((e) => e.type === 'usage')) return turn === base.turn ? previo : { ...previo, turn };
  return { items, next, turn };
}

// ---------------------------------------------------------------------- Resumen de un grupo

const INFINITIVO: Record<string, string> = {
  Leo: 'Leer',
  Busco: 'Buscar',
  Edito: 'Editar',
  Escribo: 'Escribir',
  Ejecuto: 'Ejecutar',
  Delego: 'Delegar',
  Consulto: 'Consultar',
  Uso: 'Usar',
};
const DE_ARCHIVO = new Set(['Leo', 'Edito', 'Escribo']);

const recorta = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** «Leer tmux.ts», «Buscar «send-keys»»: la acción de un paso en pocas palabras. */
export function stepLabel(paso: Pick<ChatStep, 'verb' | 'target'>): string {
  const verbo = INFINITIVO[paso.verb] ?? paso.verb;
  if (paso.target === '') return verbo;
  if (DE_ARCHIVO.has(paso.verb)) return `${verbo} ${paso.target.split('/').pop() || paso.target}`;
  // El servidor ya entrecomilla el patrón de un Grep («send-keys» en panel); el de un Glob llega sin comillas.
  if (paso.verb === 'Busco') return `${verbo} ${paso.target.startsWith('«') ? recorta(paso.target, 32) : `«${recorta(paso.target, 28)}»`}`;
  return `${verbo} ${recorta(paso.target, 32)}`;
}

/** «Leer tmux.ts · Buscar «send-keys» · …»: las primeras acciones de un grupo. */
export function toolsSummary(steps: readonly ChatStep[], max = 4): string {
  const etiquetas = steps.slice(0, max).map(stepLabel);
  return etiquetas.join(' · ') + (steps.length > max ? ' · …' : '');
}

/** «1 acción», «4 acciones». */
export const actionsLabel = (n: number): string => `${n} ${n === 1 ? 'acción' : 'acciones'}`;

/** «1 error», «2 errores». */
export const errorsLabel = (n: number): string => `${n} ${n === 1 ? 'error' : 'errores'}`;

// ---------------------------------------------------------------------- Búsqueda

const SOLO_ASCII = /^[\x00-\x7f]*$/;

/** Un texto sin tildes ni mayúsculas. El texto ASCII (casi todo en un transcript) no necesita normalizar. */
const pliega = (s: string): string => (SOLO_ASCII.test(s) ? s.toLowerCase() : s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());

/** Texto normalizado para comparar: sin mayúsculas ni tildes. */
export function normalizeText(s: string): string {
  return pliega(s);
}

/**
 * Posiciones `[desde, hasta)` del texto original donde aparece `consulta`,
 * sin distinguir mayúsculas ni tildes. La normalización puede cambiar la
 * longitud (una «é» descompuesta ocupa dos caracteres), así que se lleva la
 * correspondencia con el texto original.
 */
export function findRanges(texto: string, consulta: string): Array<[number, number]> {
  const q = pliega(consulta.trim());
  if (q === '' || texto === '') return [];
  let normal: string;
  let origen: number[] | null = null; // posición en `texto` de cada carácter de `normal`; null si coinciden (ASCII)
  if (SOLO_ASCII.test(texto)) {
    normal = texto.toLowerCase();
  } else {
    const trozos: string[] = [];
    origen = [];
    for (let i = 0; i < texto.length; ) {
      const cp = texto.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      const f = cp < 128 ? ch.toLowerCase() : pliega(ch);
      for (let k = 0; k < f.length; k++) origen.push(i);
      trozos.push(f);
      i += ch.length;
    }
    normal = trozos.join('');
  }
  const rangos: Array<[number, number]> = [];
  for (let pos = normal.indexOf(q); pos !== -1; pos = normal.indexOf(q, pos + q.length)) {
    if (origen === null) {
      rangos.push([pos, pos + q.length]);
      continue;
    }
    const desde = origen[pos]!;
    const ultimo = origen[pos + q.length - 1]!;
    const hasta = ultimo + String.fromCodePoint(texto.codePointAt(ultimo)!).length;
    rangos.push([desde, hasta]);
  }
  return rangos;
}

export type TextPart = { text: string; hit: boolean };

/** El texto partido en trozos que coinciden con la consulta y trozos que no. */
export function splitHighlight(texto: string, consulta: string): TextPart[] {
  const rangos = findRanges(texto, consulta);
  if (rangos.length === 0) return [{ text: texto, hit: false }];
  const partes: TextPart[] = [];
  let cursor = 0;
  for (const [desde, hasta] of rangos) {
    if (desde > cursor) partes.push({ text: texto.slice(cursor, desde), hit: false });
    partes.push({ text: texto.slice(desde, hasta), hit: true });
    cursor = hasta;
  }
  if (cursor < texto.length) partes.push({ text: texto.slice(cursor), hit: false });
  return partes;
}

/**
 * Los textos que se pintan de un Markdown, uno por nodo de texto: lo mismo que
 * resalta `Markdown`, así que un texto solo cuenta como coincidencia si se va
 * a ver marcado (no por una URL o un signo de formato que no se muestran).
 */
export function markdownPieces(fuente: string): string[] {
  const salida: string[] = [];
  const recorre = (tokens: readonly Token[] | undefined): void => {
    for (const t of tokens ?? []) {
      switch (t.type) {
        case 'space':
        case 'def':
        case 'hr':
        case 'br':
        case 'checkbox':
        case 'image':
          break;
        case 'text': {
          const tt = t as Tokens.Text;
          if (tt.tokens && tt.tokens.length > 0) recorre(tt.tokens);
          else salida.push(decodeEntities(tt.text));
          break;
        }
        case 'escape':
          salida.push(decodeEntities((t as Tokens.Escape).text));
          break;
        case 'codespan':
          salida.push(decodeEntities((t as Tokens.Codespan).text));
          break;
        case 'code':
          salida.push((t as Tokens.Code).text);
          break;
        case 'html':
          salida.push((t as Tokens.HTML).text);
          break;
        case 'list':
          for (const it of (t as Tokens.List).items) recorre(it.tokens);
          break;
        case 'table': {
          const tb = t as Tokens.Table;
          for (const c of tb.header) recorre(c.tokens);
          for (const fila of tb.rows) for (const c of fila) recorre(c.tokens);
          break;
        }
        default:
          if ('tokens' in t && Array.isArray(t.tokens)) recorre(t.tokens as Token[]);
          else if ('text' in t && typeof t.text === 'string') salida.push(t.text);
      }
    }
  };
  recorre(lex(fuente));
  return salida;
}

export type ChatMatch = {
  /** Identifica el mensaje o la acción que coincide (el `data-hit` con el que se pinta). */
  key: string;
  /** Posición del elemento en la conversación. */
  item: number;
  /** Posición de la acción dentro de su grupo; null si es un mensaje. */
  step: number | null;
};

/** Clave de la acción `j` de un grupo. */
export const stepKey = (itemKey: string, j: number): string => `${itemKey}:${j}`;

/** Textos buscables de un mensaje o una acción, ya normalizados. Se guardan por elemento: la conversación crece, no se rehace. */
type Pajar = { key: string; step: number | null; textos: string[] };
const PAJAR = new WeakMap<ChatItem, Pajar[]>();

function pajares(it: ChatItem): Pajar[] {
  const guardado = PAJAR.get(it);
  if (guardado) return guardado;
  let r: Pajar[];
  if (it.kind === 'user') r = [{ key: it.key, step: null, textos: [pliega(it.text)] }];
  else if (it.kind === 'agent') r = [{ key: it.key, step: null, textos: markdownPieces(it.text).map(pliega) }];
  else if (it.kind === 'command') r = [{ key: it.key, step: null, textos: [commandLine(it), it.output?.text ?? ''].filter((t) => t !== '').map(pliega) }];
  else if (it.kind === 'question') r = [{ key: it.key, step: null, textos: questionSearchTexts(it).map(pliega) }];
  else {
    r = it.steps.map((s, j) => ({
      key: stepKey(it.key, j),
      step: j,
      textos: [s.verb, s.target, s.detail ?? '', s.result ? resultText(s.result) : ''].filter((t) => t !== '').map(pliega),
    }));
  }
  PAJAR.set(it, r);
  return r;
}

/**
 * Normaliza los textos buscables de los elementos que aún no lo están, de los últimos a los primeros, durante a lo sumo
 * `ms` milisegundos. Devuelve true si no queda ninguno. Se llama en ratos libres para que la primera búsqueda no
 * tenga que hacerlo todo de golpe.
 */
export function warmSearch(items: readonly ChatItem[], ms: number): boolean {
  const limite = performance.now() + ms;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (PAJAR.has(it)) continue;
    pajares(it);
    if (performance.now() > limite) return false;
  }
  return true;
}

/**
 * Mensajes y acciones de la conversación que contienen la consulta, sin
 * distinguir mayúsculas ni tildes, en orden de aparición. Busca en el texto de
 * los mensajes, en el verbo, el objetivo y el detalle de cada acción y en su
 * resultado. Una coincidencia es un mensaje o una acción, no cada repetición.
 */
export function searchChat(items: readonly ChatItem[], consulta: string): ChatMatch[] {
  const q = pliega(consulta.trim());
  if (q === '') return [];
  const salida: ChatMatch[] = [];
  items.forEach((it, i) => {
    for (const p of pajares(it)) if (p.textos.some((t) => t.includes(q))) salida.push({ key: p.key, item: i, step: p.step });
  });
  return salida;
}

/** Coincidencias que se resaltan como mucho (las más cercanas a la actual): resaltar decenas de miles de `<mark>` bloquea la página. */
export const MAX_RESALTADAS = 2000;

/**
 * Qué coincidencias se resaltan: hasta `max`, las más cercanas a la actual en el orden de aparición
 * (la actual siempre entra). Devuelve el intervalo `[desde, hasta)` dentro de `coincidencias`.
 */
export function highlightRange(total: number, actual: number, max = MAX_RESALTADAS): [number, number] {
  if (total <= max) return [0, total];
  const desde = Math.max(0, Math.min(actual - Math.floor(max / 2), total - max));
  return [desde, desde + max];
}

/** Las claves de las coincidencias agrupadas por posición del elemento (una sola pasada: cada elemento recibe su conjunto). */
export function groupMatches(coincidencias: readonly ChatMatch[]): Map<number, Set<string>> {
  const m = new Map<number, Set<string>>();
  for (const c of coincidencias) {
    const s = m.get(c.item);
    if (s) s.add(c.key);
    else m.set(c.item, new Set([c.key]));
  }
  return m;
}

/** Un entero con separador de miles a la española: «3.482», «12.000». */
const miles = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** El contador de la búsqueda: «3 de 12», «1 de 3.482 · resalte parcial» si hay más coincidencias de las que se resaltan. */
export function hitCountLabel(indice: number, total: number): string {
  if (total === 0) return 'Sin coincidencias';
  return `${miles(indice + 1)} de ${miles(total)}${total > MAX_RESALTADAS ? ' · resalte parcial' : ''}`;
}

// ---------------------------------------------------------------------- Mensajes nuevos

/** Mensajes (de la persona o del agente) añadidos tras los primeros `vistos` elementos. */
export function countNewMessages(items: readonly ChatItem[], vistos: number): number {
  let n = 0;
  for (let i = Math.max(0, vistos); i < items.length; i++) if (items[i]!.kind !== 'tools') n++;
  return n;
}

/** «1 mensaje nuevo», «2 mensajes nuevos». */
export const newMessagesLabel = (n: number): string => `${n} ${n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`;

/**
 * Lo que anuncia el lector de pantalla cuando llegan elementos tras los primeros `anunciados`: solo las respuestas de
 * Claude (lo que la persona escribe ya lo sabe) y sus preguntas pendientes, de forma agregada, nunca el texto. Cadena
 * vacía si no hay nada que decir.
 */
export function newRepliesAnnouncement(items: readonly ChatItem[], anunciados: number): string {
  let n = 0;
  let preguntas = 0;
  for (let i = Math.max(0, anunciados); i < items.length; i++) {
    const it = items[i]!;
    if (it.kind === 'agent') n++;
    else if (it.kind === 'question' && !it.result) preguntas++;
  }
  const respuestas = n === 0 ? '' : n === 1 ? 'Nueva respuesta de Claude' : newMessagesLabel(n);
  return [respuestas, preguntas === 0 ? '' : 'Claude te pregunta'].filter((t) => t !== '').join('. ');
}

/** Aviso de que Claude espera en la terminal: una frase propia y, aparte, el detalle que dio el hook. */
export type WaitingNotice = { text: string; detail: string | null; translated: boolean };

/**
 * El mensaje del hook de Claude Code suele venir en inglés: se traducen solo los patrones conocidos
 * («needs your permission to use X») y el resto se enseña tal cual, como cita, sin traducirlo.
 */
export function waitingNotice(notice: string): WaitingNotice {
  const text = 'Claude espera tu respuesta en la terminal.';
  const crudo = notice.trim();
  if (crudo === '') return { text, detail: null, translated: false };
  const permiso = /^Claude needs your permission to use (.+?)\.?$/i.exec(crudo);
  if (permiso) return { text, detail: `Pide permiso para usar ${permiso[1]}`, translated: true };
  if (/^Claude is waiting for your input\.?$/i.test(crudo)) return { text, detail: null, translated: true };
  return { text, detail: crudo, translated: false };
}

// ---------------------------------------------------------------------- Ventana de render

/** Elementos que se pintan de una conversación larga: los últimos, y se cargan más al subir. */
export const VENTANA = 400;
/** Cuántos más se cargan cada vez que se pide ver los anteriores o los siguientes. */
export const PASO_VENTANA = 300;

/** Tramo pintado de la conversación; `to: null` es «hasta el último», aunque lleguen elementos nuevos. `null` es «los últimos». */
export type ChatWindow = { from: number; to: number | null } | null;

/** El tramo `[desde, hasta)` que se pinta. */
export function windowRange(v: ChatWindow, total: number): [number, number] {
  if (v === null) return [Math.max(0, total - VENTANA), total];
  const hasta = v.to === null ? total : Math.min(v.to, total);
  return [Math.min(v.from, hasta), hasta];
}

/** Un tramo alrededor del elemento `i` (para saltar a una coincidencia antigua). */
export function windowAround(i: number, total: number): ChatWindow {
  const desde = Math.max(0, i - VENTANA / 2);
  const hasta = desde + VENTANA;
  return hasta >= total ? null : { from: desde, to: hasta };
}

/** Amplía el tramo hacia arriba `PASO_VENTANA` elementos. */
export function windowUp(v: ChatWindow, total: number): ChatWindow {
  const [desde, hasta] = windowRange(v, total);
  return { from: Math.max(0, desde - PASO_VENTANA), to: v === null || v.to === null || hasta >= total ? null : hasta };
}

/** Amplía el tramo hacia abajo; al llegar al último vuelve a «los últimos» (si cabe). */
export function windowDown(v: ChatWindow, total: number): ChatWindow {
  const [desde, hasta] = windowRange(v, total);
  const nuevo = hasta + PASO_VENTANA;
  return nuevo >= total ? { from: desde, to: null } : { from: desde, to: nuevo };
}

// ---------------------------------------------------------------------- Carga y sondeo

/** Cuánto se ha leído de la transcripción: «3,1 de 5 MB», o en KB si es pequeña. */
export function progressLabel(from: number, size: number): string {
  const MB = 1024 * 1024;
  if (size < MB) return `${Math.round(from / 1024)} de ${Math.round(size / 1024)} KB`;
  const n = (b: number) => (Math.round((b / MB) * 10) / 10).toString().replace('.', ',');
  return `${n(Math.min(from, size))} de ${n(size)} MB`;
}

/** Porcentaje leído (0 a 100); 0 si aún no se conoce el tamaño. */
export function progressPercent(from: number, size: number): number {
  return size > 0 ? Math.max(0, Math.min(100, Math.round((from / size) * 100))) : 0;
}

/** Cada cuánto preguntar por lo nuevo: enseguida si queda más por leer, cada 1 s mientras el agente trabaja y cada 3 s si no. */
export function conversationDelay(more: boolean, trabajando: boolean): number {
  if (more) return 0;
  return trabajando ? 1000 : 3000;
}

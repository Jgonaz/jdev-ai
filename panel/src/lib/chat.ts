// Lógica pura de la vista chat de una terminal: convierte los eventos de la
// transcripción en elementos (mensajes de la persona, respuestas del agente y
// grupos de herramientas), busca texto en ellos y da formato a lo que se pinta.

import type { Token, Tokens } from 'marked';
import { decodeEntities, lex } from '../components/Markdown.tsx';
import type { AgentEvent } from '../../shared/follow.ts';

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

export type ChatItem =
  | { kind: 'user'; key: string; text: string; at: number | null; images: number }
  | { kind: 'agent'; key: string; text: string; at: number | null }
  /** Herramientas ejecutadas seguidas, entre dos mensajes. */
  | { kind: 'tools'; key: string; steps: ChatStep[]; errors: number; at: number | null };

export type ChatModel = {
  items: ChatItem[];
  /** Contador para dar claves estables a los elementos nuevos. */
  next: number;
};

export const EMPTY_CHAT: ChatModel = { items: [], next: 0 };

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
  // Posición de cada herramienta (elemento, paso), construida solo si llega algún resultado.
  const tabla: { m: Map<string, [number, number]> | null } = { m: null };
  const indexa = (): Map<string, [number, number]> => {
    if (tabla.m) return tabla.m;
    const m = new Map<string, [number, number]>();
    items.forEach((it, i) => it.kind === 'tools' && it.steps.forEach((s, j) => m.set(s.id, [i, j])));
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
    } else if (e.type === 'message') {
      items.push({ kind: 'agent', key: `a${next++}`, text: e.text, at: e.at });
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
      const g = clona(pos[0]);
      const paso = g.steps[pos[1]]!;
      if (paso.result) continue;
      g.steps[pos[1]] = { ...paso, result: { error: e.error, summary: e.summary, lines: e.lines, ...(e.output !== undefined ? { output: e.output } : {}) } };
      if (e.error) g.errors++;
    }
    // Los eventos «task» son de subagentes: la conversación no los tiene.
  }
  return { items, next };
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
  if (paso.verb === 'Busco') return `${verbo} «${recorta(paso.target, 28)}»`;
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

/** Una letra sin tildes ni mayúsculas. */
const pliega = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

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
  let normal = '';
  const origen: number[] = []; // posición en `texto` de cada carácter de `normal`
  for (let i = 0; i < texto.length; ) {
    const cp = texto.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = pliega(ch);
    for (let k = 0; k < f.length; k++) origen.push(i);
    normal += f;
    i += ch.length;
  }
  const rangos: Array<[number, number]> = [];
  for (let pos = normal.indexOf(q); pos !== -1; pos = normal.indexOf(q, pos + q.length)) {
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

// ---------------------------------------------------------------------- Mensajes nuevos

/** Mensajes (de la persona o del agente) añadidos tras los primeros `vistos` elementos. */
export function countNewMessages(items: readonly ChatItem[], vistos: number): number {
  let n = 0;
  for (let i = Math.max(0, vistos); i < items.length; i++) if (items[i]!.kind !== 'tools') n++;
  return n;
}

/** «1 mensaje nuevo», «2 mensajes nuevos». */
export const newMessagesLabel = (n: number): string => `${n} ${n === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`;

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

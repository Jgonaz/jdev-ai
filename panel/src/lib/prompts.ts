// Lógica pura de las preguntas (`AskUserQuestion`) y los permisos que el chat puede contestar: la selección en curso,
// el cuerpo que se envía al servidor, cómo se ve una pregunta ya respondida y cuándo se enseña el aviso de espera.

import type { PermissionInput, PromptInfo, QuestionAnswer } from '../../shared/chat.ts';
import { normalizeAnswerText } from '../../shared/chat.ts';
import type { QuestionItem } from '../../shared/follow.ts';
import type { ChatItem } from './chat.ts';
import { formatClock } from './statusline.ts';

type QuestionChatItem = Extract<ChatItem, { kind: 'question' }>;

// ---------------------------------------------------------------------- Selección

/** Lo elegido en una pregunta: opciones (índices desde 0), si «Otra respuesta» está marcada y su texto (aunque no esté marcada se conserva). */
export type Selection = { options: number[]; other: boolean; text: string };

/** Una selección por pregunta, en su orden. */
export type Draft = Selection[];

export const emptyDraft = (n: number): Draft => Array.from({ length: n }, () => ({ options: [], other: false, text: '' }));

/** Marca una opción: en las simples sustituye a la anterior (y desmarca «Otra»); en las múltiples la marca o desmarca. */
export function chooseOption(sel: Selection, multi: boolean, i: number): Selection {
  if (!multi) return { ...sel, options: [i], other: false };
  const options = sel.options.includes(i) ? sel.options.filter((o) => o !== i) : [...sel.options, i].sort((a, b) => a - b);
  return { ...sel, options };
}

/** Marca «Otra respuesta» (al enfocar su texto o al escribir): en las simples es excluyente con las opciones; en las múltiples se suma. */
export function selectOther(sel: Selection, multi: boolean): Selection {
  return multi ? { ...sel, other: true } : { ...sel, options: [], other: true };
}

/** Marca o desmarca «Otra respuesta» con su casilla: solo las múltiples pueden desmarcarla. */
export function toggleOther(sel: Selection, multi: boolean): Selection {
  return multi && sel.other ? { ...sel, other: false } : selectOther(sel, multi);
}

/** Cambia el texto libre; escribir lo marca. */
export function setOtherText(sel: Selection, multi: boolean, text: string): Selection {
  return { ...selectOther(sel, multi), text };
}

/** El texto libre que se enviaría: el normalizado (una sola línea), solo si «Otra respuesta» está marcada. */
export const otherText = (sel: Selection): string => (sel.other ? normalizeAnswerText(sel.text) : '');

/** ¿Tiene respuesta la pregunta? Una opción o un texto no vacío. */
export const isAnswered = (sel: Selection): boolean => sel.options.length > 0 || otherText(sel) !== '';

/** Cuántas preguntas tienen respuesta. */
export const answeredCount = (draft: Draft): number => draft.filter(isAnswered).length;

/** «1 de 2 contestadas», «1 de 1 contestada». */
export const progressText = (hechas: number, total: number): string => `${hechas} de ${total} ${total === 1 ? 'contestada' : 'contestadas'}`;

// «(Recommended)» lo añade Claude a la etiqueta de la opción que prefiere; en el chat sale como pastilla «Recomendada».
const RECOMENDADA = /\s*\((?:Recommended|Recomendad[oa])\)\s*$/i;

/** La etiqueta sin el sufijo «(Recommended)» y si lo tenía. Solo es para pintar: lo que se envía es el índice, y la pantalla se compara con la etiqueta original. */
export function splitRecommended(label: string): { text: string; recommended: boolean } {
  const text = label.replace(RECOMENDADA, '');
  return text === label || text === '' ? { text: label, recommended: false } : { text, recommended: true };
}

/** «1 pregunta», «2 preguntas». */
export const questionsLabel = (n: number): string => `${n} ${n === 1 ? 'pregunta' : 'preguntas'}`;

/** El cuerpo de POST /answer: una entrada por pregunta, en orden, con las opciones ascendentes y el texto ya normalizado. */
export function buildAnswers(draft: Draft): QuestionAnswer[] {
  return draft.map((sel) => {
    const text = otherText(sel);
    return { options: [...sel.options].sort((a, b) => a - b), ...(text === '' ? {} : { text }) };
  });
}

/** Una selección guardada solo vale si encaja con las preguntas (mismo número de preguntas y de opciones). */
export function fitDraft(draft: Draft | undefined, questions: readonly QuestionItem[]): Draft {
  if (!draft || draft.length !== questions.length) return emptyDraft(questions.length);
  const valido = draft.every((s, i) => s.options.every((o) => o >= 0 && o < questions[i]!.options.length));
  return valido ? draft : emptyDraft(questions.length);
}

// ---------------------------------------------------------------------- Respondida

/** Una fila de una pregunta respondida: cabecera, pregunta y lo que se contestó (null si Claude Code no lo guardó). */
export type AnsweredRow = {
  header: string;
  question: string;
  /** La respuesta tal como la guardó Claude Code (opciones unidas por «, » y el texto propio al final). */
  answer: string | null;
  /** Las opciones elegidas, sin el sufijo «(Recommended)», y el texto propio aparte (null si no hay). */
  chosen: string[];
  own: string | null;
};

/**
 * Separa una respuesta guardada en las opciones elegidas y el texto propio. Claude Code une las opciones por «, »
 * en su orden y añade al final el texto libre; se reconocen las opciones por su etiqueta exacta desde el principio y
 * lo que sobra es texto propio. Si una etiqueta contiene «, », puede no reconocerse: entonces sale como texto propio.
 */
export function splitAnswer(answer: string, q: QuestionItem): { chosen: string[]; own: string | null } {
  const etiquetas = [...q.options.map((o) => o.label)].sort((a, b) => b.length - a.length);
  const chosen: string[] = [];
  let resto = answer;
  for (;;) {
    const l = etiquetas.find((e) => e !== '' && (resto === e || resto.startsWith(`${e}, `)));
    if (l === undefined) break;
    chosen.push(splitRecommended(l).text);
    resto = resto === l ? '' : resto.slice(l.length + 2);
    if (!q.multiSelect) break;
  }
  return { chosen, own: resto === '' ? null : resto };
}

/** Lo que se pinta de una pregunta con resultado: una fila por pregunta y, si no hay respuestas estructuradas, el resumen del resultado. */
export function answeredView(item: QuestionChatItem): { rows: AnsweredRow[]; note: string | null; declined: boolean; at: number | null } {
  const r = item.result;
  const respuestas = r?.answers;
  const rows = item.questions.map((q) => {
    const answer = respuestas?.[q.question] ?? null;
    return { header: q.header, question: q.question, answer, ...(answer === null ? { chosen: [], own: null } : splitAnswer(answer, q)) };
  });
  // Sin respuestas (o con alguna que falta) se enseña el resumen; un error es que no se contestó (se rechazó o se interrumpió).
  const note = r !== undefined && (r.error || respuestas === undefined || rows.some((x) => x.answer === null)) ? r.summary : null;
  return { rows, note: note === '' ? null : note, declined: r?.error === true, at: r?.at ?? null };
}

/** «HH:MM» (hora local) de la respuesta, si el resultado la trae. */
export const answeredClock = (at: number | null): string | null => (at === null ? null : formatClock(at));

/** Los textos de una pregunta con los que se busca: pendiente, sus preguntas y opciones; respondida, también lo elegido. */
export function questionSearchTexts(item: QuestionChatItem): string[] {
  const textos: string[] = [];
  if (item.result) {
    const v = answeredView(item);
    for (const f of v.rows) textos.push(f.header, f.question, ...(f.chosen.length > 0 ? [f.chosen.join(', ')] : []), ...(f.own === null ? [] : [f.own]));
    if (v.note !== null) textos.push(v.note);
  } else {
    for (const q of item.questions) textos.push(q.header, q.question, ...q.options.flatMap((o) => [splitRecommended(o.label).text, o.description]));
  }
  return textos.filter((t) => t !== '');
}

// ---------------------------------------------------------------------- Qué se enseña mientras la sesión espera

export type PromptState = { prompt: PromptInfo | null; loaded: boolean; failed: boolean };

/** La pregunta pendiente de la conversación con ese `id`, si está. */
export function pendingQuestion(items: readonly ChatItem[], id: string): QuestionChatItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === 'question' && it.id === id) return it.result ? null : it;
  }
  return null;
}

/** La tarjeta de una pregunta que solo se conoce por lo que dice la terminal (el hook la anunció y la transcripción aún no trae su línea). */
export function promptQuestionItem(prompt: Extract<PromptInfo, { kind: 'question' }>): QuestionChatItem {
  return { kind: 'question', key: `prompt-${prompt.id}`, id: prompt.id, questions: prompt.questions, at: null };
}

/**
 * Qué enseña el chat bajo la conversación mientras la sesión espera: el diálogo de permiso, la tarjeta de una pregunta que
 * aún no está en la conversación (`question`: va al final, antes de la caja, y pasa a su sitio cuando llega su línea),
 * el aviso de «espera en la terminal» (para lo que el chat no contesta, o si la consulta falla) o nada. Una pregunta que
 * ya está en la conversación, pendiente o respondida, es su tarjeta y no hace falta nada más.
 */
export function waitingView(
  esperando: boolean,
  estado: PromptState,
  items: readonly ChatItem[],
): { permission: Extract<PromptInfo, { kind: 'permission' }> | null; question: QuestionChatItem | null; notice: boolean } {
  const nada = { permission: null, question: null, notice: false };
  if (!esperando) return nada;
  const { prompt } = estado;
  if (prompt?.kind === 'permission') return { ...nada, permission: prompt };
  if (prompt?.kind === 'question') {
    const enLaConversacion = items.some((it) => it.kind === 'question' && it.id === prompt.id);
    return enLaConversacion ? nada : { ...nada, question: promptQuestionItem(prompt) };
  }
  if (prompt?.kind === 'other') return { ...nada, notice: true };
  // Sin prompt: es «nada abierto» si la consulta ya respondió; si falló, se avisa igual; mientras carga, no se enseña nada.
  return { ...nada, notice: estado.loaded || estado.failed };
}

/** ¿Puede contestarse ahora esta pregunta desde el chat? Solo si la terminal muestra su menú, sin empezar a contestar en ella. */
export type QuestionReadiness = 'ready' | 'started' | 'not-open' | 'not-waiting';

export function questionReadiness(item: QuestionChatItem, esperando: boolean, prompt: PromptInfo | null): QuestionReadiness {
  if (!esperando) return 'not-waiting';
  if (prompt?.kind !== 'question' || prompt.id !== item.id) return 'not-open';
  // El servidor exige la primera pregunta sin contestar: si ya se ha empezado en la terminal, se termina allí.
  if (prompt.screen === 'review' || prompt.tabs.some((t) => t.answered)) return 'started';
  return 'ready';
}

/** Dónde busca el chat lo que quiere hacer una herramienta que pide permiso: su paso en la conversación. */
export function toolStep(items: readonly ChatItem[], toolUseId: string): { verb: string; target: string; detail?: string } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind !== 'tools') continue;
    const s = it.steps.find((p) => p.id === toolUseId);
    if (s) return { verb: s.verb, target: s.target, ...(s.detail ? { detail: s.detail } : {}) };
  }
  return null;
}

// ---------------------------------------------------------------------- Permiso

// Lo que dice la tarjeta de permiso de lo que va a hacer la herramienta, por el verbo con que la resume el servidor.
const FRASE_PERMISO: Record<string, string> = {
  Ejecuto: 'Ejecutar este comando',
  Leo: 'Leer este archivo',
  Edito: 'Editar este archivo',
  Escribo: 'Escribir este archivo',
  Consulto: 'Consultar esta URL',
  Busco: 'Buscar',
  Delego: 'Delegar',
  'Uso la skill': 'Usar esta skill',
  Uso: 'Usar',
};

/**
 * La parte de «lo que quiere hacer» de la tarjeta de permiso: la frase («Ejecutar este comando», «Editar este archivo»), dónde
 * (el directorio si no es el de la sesión), el texto que va en el bloque (el comando entero, el archivo o la URL) y una línea
 * pequeña con la explicación de Claude y el cambio de líneas.
 */
export function permissionView(input: PermissionInput): { lead: string; where: string | null; text: string; note: string | null } {
  const note = [input.description, input.detail].filter((t): t is string => t !== undefined && t !== '').join(' · ');
  return { lead: FRASE_PERMISO[input.verb] ?? input.verb, where: input.where ?? null, text: input.text, note: note === '' ? null : note };
}

// ---------------------------------------------------------------------- Borradores

/** La selección en curso de cada pregunta pendiente (por sesión e `id`): sobrevive a pasar a la terminal y volver, y a las actualizaciones en directo. */
const borradores = new Map<string, Draft>();
/** Preguntas contestadas desde este chat (se sabe de verdad solo en esta sesión del navegador). */
const desdeElChat = new Set<string>();

/** Cómo acabó el envío de una respuesta: enviada, ya no estaba pendiente (se contestó en la terminal) o falló con este motivo. */
export type SendOutcome = 'sent' | 'gone' | { error: string };

/** Envíos en marcha por sesión e id: la tarjeta puede cambiar de sitio (de «al final» a su línea de la conversación) mientras tanto y la nueva se engancha. */
const envios = new Map<string, Promise<SendOutcome>>();

const clave = (sesion: string, id: string): string => `${sesion}\u0000${id}`;

export const loadDraft = (sesion: string, id: string, questions: readonly QuestionItem[]): Draft => fitDraft(borradores.get(clave(sesion, id)), questions);
export const saveDraft = (sesion: string, id: string, draft: Draft): void => void borradores.set(clave(sesion, id), draft);
export const dropDraft = (sesion: string, id: string): void => void borradores.delete(clave(sesion, id));
export const markAnsweredFromChat = (sesion: string, id: string): void => void desdeElChat.add(clave(sesion, id));
export const wasAnsweredFromChat = (sesion: string, id: string): boolean => desdeElChat.has(clave(sesion, id));
/** Registra el envío en marcha de una pregunta hasta que acabe, y lo devuelve. */
export function trackSend(sesion: string, id: string, envio: Promise<SendOutcome>): Promise<SendOutcome> {
  const k = clave(sesion, id);
  envios.set(k, envio);
  void envio.finally(() => {
    if (envios.get(k) === envio) envios.delete(k);
  });
  return envio;
}
/** El envío en marcha de una pregunta, si lo hay. */
export const pendingSend = (sesion: string, id: string): Promise<SendOutcome> | null => envios.get(clave(sesion, id)) ?? null;

/** Olvida lo guardado de una sesión (al cerrar su pestaña y en las pruebas). */
export function forgetPrompts(sesion: string): void {
  const prefijo = `${sesion}\u0000`;
  for (const k of [...borradores.keys()]) if (k.startsWith(prefijo)) borradores.delete(k);
  for (const k of [...desdeElChat]) if (k.startsWith(prefijo)) desdeElChat.delete(k);
  for (const k of [...envios.keys()]) if (k.startsWith(prefijo)) envios.delete(k);
}

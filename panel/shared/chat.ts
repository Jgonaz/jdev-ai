// Validación del mensaje que la vista chat envía a una sesión (POST /api/sessions/:name/input) y de las
// respuestas a sus preguntas y permisos (POST /api/sessions/:name/answer).
// Módulo sin dependencias de Node: lo comparten el servidor y el cliente.

import { QUESTION_LIMITS } from './follow.ts';
import type { QuestionItem } from './follow.ts';

/** Tamaño máximo del mensaje, en bytes UTF-8. */
export const CHAT_MESSAGE_MAX_BYTES = 64 * 1024;

export type ChatMessageCheck = { ok: true; text: string } | { ok: false; status: 400 | 413; error: string };

// Controles C0 salvo tabulador, salto de línea y retorno de carro, más DEL. Un ESC dentro de un pegado
// entre corchetes podría cerrarlo antes de tiempo («ESC [201~») y convertir el resto en teclas.
const CONTROLES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/** Texto listo para pegar (saltos de línea normalizados y sin espacios finales) o el motivo del rechazo. */
export function checkChatMessage(entrada: unknown): ChatMessageCheck {
  if (typeof entrada !== 'string') return { ok: false, status: 400, error: 'Indica el mensaje en «text».' };
  const text = entrada.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (text.trim() === '') return { ok: false, status: 400, error: 'El mensaje está vacío.' };
  if (CONTROLES.test(text)) return { ok: false, status: 400, error: 'El mensaje contiene caracteres de control no admitidos.' };
  if (new TextEncoder().encode(text).length > CHAT_MESSAGE_MAX_BYTES) {
    return { ok: false, status: 413, error: 'El mensaje es demasiado largo: el máximo son 64 KiB.' };
  }
  return { ok: true, text };
}

// ---------------------------------------------------------------------- Comandos

/**
 * Si el mensaje es una pregunta al margen de Claude Code (`/btw pregunta`, o `/btw` solo), la
 * pregunta (vacía si no la hay); null en otro caso. Claude no guarda `/btw` en la transcripción y
 * responde en una ventana de la terminal: el servidor la captura y la devuelve en la respuesta del envío.
 */
export function parseBtw(texto: string): { question: string } | null {
  const t = texto.trim();
  const m = /^\/btw(?:\s+([\s\S]*))?$/.exec(t);
  return m ? { question: (m[1] ?? '').trim() } : null;
}

/** Si el mensaje es un comando de Claude Code (`/nombre` o `/nombre args`), no una ruta que empieza por barra. */
export function isSlashCommand(texto: string): boolean {
  return /^\/[A-Za-z][\w:.-]*(?:\s|$)/.test(texto.trim());
}

/** Respuesta de `/btw` capturada de la terminal. */
export type BtwAnswer = {
  question: string;
  /** Markdown. */
  answer: string;
  /** No se pudo confirmar que se llegó al final de la ventana (tope de pasos al desplazarla, o se cerró a medias): la respuesta puede estar incompleta. */
  truncated: boolean;
};

/** Lo que responde POST /api/sessions/:name/input cuando el mensaje se envió. */
export type ChatSendResponse = {
  sent: true;
  /** Solo con `/btw`: la respuesta, o null si no se pudo capturar a tiempo (con `pending`). */
  btw?: BtwAnswer | null;
  /** `/btw` no respondió a tiempo: la ventana sigue abierta en la terminal. */
  pending?: boolean;
  /** Tras un comando se abrió una ventana o un menú de Claude que espera en la terminal. */
  awaitingTerminal?: boolean;
};

/** Código del 409 cuando la terminal tiene abierta una ventana o un menú de Claude. */
export const TUI_BUSY_CODE = 'tui-busy';
export const TUI_BUSY_MESSAGE = 'La terminal tiene abierta una ventana de Claude: ciérrala o respóndela en la terminal.';

// ---------------------------------------------------------------- Preguntas y permisos

/**
 * Lo que pide una herramienta que espera permiso, según el hook `PermissionRequest` (con `describeTool` para el resumen):
 * `verb` y `target` como en la conversación («Ejecuto» / primera línea del comando), `text` lo que se enseña entero
 * (el comando completo en Bash, si no el objetivo), `detail` el cambio de líneas de las ediciones y `description` la
 * explicación que da Claude (en Bash). `where` es el directorio donde se ejecuta si no es el de la sesión.
 */
export type PermissionInput = { verb: string; target: string; detail?: string; text: string; description?: string; where?: string };

/** Lo que hay abierto en la terminal de una sesión de Claude y el chat puede contestar (GET /api/sessions/:name/prompt). */
export type PromptInfo =
  | {
      kind: 'question';
      /** Id del `AskUserQuestion` pendiente al que corresponde el menú de la pantalla (el `tool_use_id` del hook o el de la transcripción). */
      id: string;
      /** Las preguntas, para pintar la tarjeta aunque la transcripción no traiga aún su línea (con los topes de `QUESTION_LIMITS`). */
      questions: QuestionItem[];
      /** `menu`: eligiendo respuestas; `review`: pantalla «Review your answers» a punto de enviarse. */
      screen: 'menu' | 'review';
      /** Pestañas visibles (una por pregunta) y si ya tienen respuesta. */
      tabs: { header: string; answered: boolean }[];
      /** Índice de la pregunta que se ve (la primera sin contestar), o null en la revisión. */
      active: number | null;
    }
  | {
      kind: 'permission';
      /** Nombre de la herramienta: el del hook `PermissionRequest` o, sin él, el del aviso («Claude needs your permission to use X»), si lo hay. */
      tool: string | null;
      /** Lo que pide la herramienta, del hook `PermissionRequest`; falta en sesiones sin ese hook. */
      input?: PermissionInput;
      /** Título del diálogo tal como lo pinta la TUI («Bash command»). */
      title: string;
      /** «Do you want to proceed?» */
      question: string;
      /** Opciones numeradas con su etiqueta completa. */
      options: { n: number; label: string }[];
      /** `tool_use` pendiente que pide el permiso; solo si hay uno y solo uno de esa herramienta sin resultado. */
      toolUseId?: string;
    }
  | { kind: 'other'; hint: string };

export type PromptResponse = { prompt: PromptInfo | null };

/** Tope del texto libre de una respuesta (caracteres, ya normalizado). */
export const ANSWER_TEXT_MAX_CHARS = 1000;
/** Tope de preguntas y de opciones por pregunta de una respuesta (ver `QUESTION_LIMITS`). */
const ANSWER_MAX_QUESTIONS = QUESTION_LIMITS.questions;
const ANSWER_MAX_OPTIONS = QUESTION_LIMITS.options;

/** Respuesta a una pregunta de `AskUserQuestion`: opciones elegidas (índices desde 0) y texto libre. */
export type QuestionAnswer = { options: number[]; text?: string };

/** Cuerpo de POST /api/sessions/:name/answer. */
export type AnswerRequest =
  | { kind: 'question'; id: string; answers: QuestionAnswer[] }
  | { kind: 'permission'; option: number; label: string };

/** Lo que responde POST /answer cuando la respuesta se entregó y el menú se cerró. */
export type AnswerResponse = { answered: true };

/** Códigos del 409 de POST /answer. */
export const TUI_MISMATCH_CODE = 'tui-mismatch';
export const NOT_PENDING_CODE = 'not-pending';
export type AnswerConflict =
  /** La pantalla no coincide con lo esperado: no se pulsó nada más (puede haber quedado a medias). `step` dice en qué paso. */
  | { code: typeof TUI_MISMATCH_CODE; error: string; step: string }
  /** La pregunta ya no está pendiente en la transcripción. */
  | { code: typeof NOT_PENDING_CODE; error: string };

/**
 * Texto libre listo para teclear en la fila de «Type something»: es de una línea, así que los saltos de línea y los
 * tabuladores pasan a espacios (un tabulador cambiaría de pestaña), y se recorta.
 */
export function normalizeAnswerText(texto: string): string {
  return texto
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\t/g, ' ')
    .trim();
}

export type AnswerRequestCheck = { ok: true; request: AnswerRequest } | { ok: false; error: string };

const ID_HERRAMIENTA = /^[\w-]{1,200}$/;

/** Valida la forma del cuerpo de POST /answer (no si encaja con lo pendiente) y normaliza el texto libre. */
export function checkAnswerRequest(entrada: Record<string, unknown>): AnswerRequestCheck {
  const malo = (error: string): AnswerRequestCheck => ({ ok: false, error });
  if (entrada.kind === 'permission') {
    const { option, label } = entrada;
    if (typeof option !== 'number' || !Number.isInteger(option) || option < 1 || option > 9) return malo('«option» debe ser un número del 1 al 9.');
    if (typeof label !== 'string' || label.trim() === '' || label.length > 1000) return malo('Indica la etiqueta de la opción en «label».');
    return { ok: true, request: { kind: 'permission', option, label } };
  }
  if (entrada.kind !== 'question') return malo('«kind» debe ser «question» o «permission».');
  const { id, answers } = entrada;
  if (typeof id !== 'string' || !ID_HERRAMIENTA.test(id)) return malo('Indica el id de la pregunta en «id».');
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > ANSWER_MAX_QUESTIONS) return malo('«answers» debe traer una respuesta por pregunta.');
  const respuestas: QuestionAnswer[] = [];
  for (const a of answers) {
    if (typeof a !== 'object' || a === null || Array.isArray(a)) return malo('Cada respuesta debe ser un objeto.');
    const { options, text } = a as Record<string, unknown>;
    if (!Array.isArray(options) || options.length > ANSWER_MAX_OPTIONS) return malo('«options» debe ser una lista de índices de opción.');
    if (!options.every((o) => typeof o === 'number' && Number.isInteger(o) && o >= 0 && o < ANSWER_MAX_OPTIONS) || new Set(options).size !== options.length) {
      return malo('«options» tiene un índice no válido o repetido.');
    }
    let texto = '';
    if (text !== undefined && text !== null) {
      if (typeof text !== 'string') return malo('«text» debe ser un texto.');
      if (CONTROLES.test(text)) return malo('El texto contiene caracteres de control no admitidos.');
      texto = normalizeAnswerText(text);
      if (texto.length > ANSWER_TEXT_MAX_CHARS) return malo(`El texto es demasiado largo: el máximo son ${ANSWER_TEXT_MAX_CHARS} caracteres.`);
    }
    respuestas.push({ options: [...(options as number[])].sort((x, y) => x - y), ...(texto === '' ? {} : { text: texto }) });
  }
  return { ok: true, request: { kind: 'question', id, answers: respuestas } };
}

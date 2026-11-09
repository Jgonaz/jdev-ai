// Validación del mensaje que la vista chat envía a una sesión (POST /api/sessions/:name/input).
// Módulo sin dependencias de Node: lo comparten el servidor y el cliente.

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

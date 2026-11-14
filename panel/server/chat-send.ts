// Envío de un mensaje del chat a la terminal de una sesión de Claude, con lo que el chat
// necesita de la TUI de Claude Code:
//
//  - No se pega nada si hay una ventana o un menú abiertos (el mensaje se perdería o
//    contestaría a un diálogo de permiso): 409 `tui-busy`.
//  - `/btw pregunta` no escribe nada en la transcripción: Claude responde en una ventana
//    superpuesta. Se espera a que haya respuesta, se lee el texto visible de la ventana
//    (desplazándola con Abajo y uniendo las pantallas por solapamiento si no cabe) y se cierra con
//    Escape. Nunca se pulsa «c»: Claude copiaría también con la herramienta nativa del sistema
//    (en WSL, clip.exe) y pisaría el portapapeles de la persona, sin que el servidor pueda evitarlo.
//  - Un `/comando` que abre un menú o una ventana (`/model`) se avisa como pendiente en la terminal.
//
// Un cerrojo por sesión impide que dos envíos se mezclen mientras uno espera.

import { TUI_BUSY_CODE, TUI_BUSY_MESSAGE, isSlashCommand, parseBtw } from '../shared/chat.ts';
import type { BtwAnswer, ChatSendResponse } from '../shared/chat.ts';
import { capturePane, pasteMessage, pressKey } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';
import { detectTuiWindow, extractBtwAnswer, extractBtwPage, joinBtwLines, mergeBtwPages } from './tui.ts';

export type ChatSendTiming = {
  /** Cada cuánto se mira la pantalla. */
  pollMs: number;
  /** Cuánto debe llevar sin cambiar la respuesta de /btw para darla por completa. */
  settleMs: number;
  /** Tope de espera de la respuesta de /btw. */
  btwTimeoutMs: number;
  /** Tope de espera de la ventana con `/btw` sin pregunta, que quizá no abre ninguna. */
  btwBareTimeoutMs: number;
  /** Tras un `/comando`, cuánto se vigila si abre una ventana o un menú. */
  commandWatchMs: number;
  /** Cuánto se espera tras cada Abajo a que la ventana de /btw repinte, al leer una respuesta con scroll. */
  scrollWaitMs: number;
  /** Tope de pulsaciones de Abajo al leer una respuesta (cada una avanza unas líneas): pasado, se marca `truncated`. */
  maxScrollSteps: number;
  /** Cuánto se espera a que la ventana se cierre tras Escape. */
  closeWaitMs: number;
};

export const DEFAULT_TIMING: ChatSendTiming = {
  pollMs: 300,
  settleMs: 1000,
  btwTimeoutMs: 90_000,
  btwBareTimeoutMs: 4000,
  commandWatchMs: 1500,
  scrollWaitMs: 120,
  maxScrollSteps: 200,
  closeWaitMs: 1500,
};

export type ChatSendOptions = {
  timing?: Partial<ChatSendTiming>;
};

export type ChatSendResult =
  | { status: 200; body: ChatSendResponse }
  | { status: 404; body: { error: string } }
  | { status: 409; body: { error: string; code: typeof TUI_BUSY_CODE } };

const NO_EXISTE = { status: 404, body: { error: 'La sesión no existe.' } } as const;

const espera = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

const cerrojos = new Map<string, Promise<void>>();

/** Clave del cerrojo de una sesión: lo comparten el envío de mensajes y las respuestas a preguntas y permisos (chat-answer.ts). */
export const claveCerrojo = (cfg: TmuxConfig, name: string): string => `${cfg.socket}/${name}`;

/** Ejecuta `fn` cuando terminen los anteriores de la misma clave. */
export async function conCerrojo<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const previo = cerrojos.get(clave) ?? Promise.resolve();
  let libera!: () => void;
  const mio = new Promise<void>((ok) => (libera = ok));
  const cola = previo.then(() => mio);
  cerrojos.set(clave, cola);
  await previo;
  try {
    return await fn();
  } finally {
    libera();
    if (cerrojos.get(clave) === cola) cerrojos.delete(clave);
  }
}

/** Envía el mensaje a la sesión (ya validado, sesión de Claude) y devuelve lo que responde la API. */
export async function sendChatMessage(cfg: TmuxConfig, name: string, texto: string, opciones: ChatSendOptions = {}): Promise<ChatSendResult> {
  const t: ChatSendTiming = { ...DEFAULT_TIMING, ...opciones.timing };
  return conCerrojo(claveCerrojo(cfg, name), async () => {
    const pantalla = await capturePane(cfg, name);
    if (pantalla === null) return NO_EXISTE;
    // Con una ventana abierta el mensaje se pierde (o responde a un diálogo): no se pega.
    if (detectTuiWindow(pantalla) !== null) return { status: 409, body: { error: TUI_BUSY_MESSAGE, code: TUI_BUSY_CODE } };

    if (!(await pasteMessage(cfg, name, texto))) return NO_EXISTE;

    const btw = parseBtw(texto);
    if (btw) return { status: 200, body: await esperaBtw(cfg, name, btw.question, t) };

    if (isSlashCommand(texto)) {
      const limite = Date.now() + t.commandWatchMs;
      while (Date.now() < limite) {
        await espera(Math.min(t.pollMs, Math.max(0, limite - Date.now())));
        const ahora = await capturePane(cfg, name);
        if (ahora === null) break;
        if (detectTuiWindow(ahora) !== null) return { status: 200, body: { sent: true, awaitingTerminal: true } };
      }
    }
    return { status: 200, body: { sent: true } };
  });
}

/**
 * Espera la respuesta de `/btw` ya enviado y la devuelve. Sin respuesta a tiempo es
 * `{ btw: null, pending: true }` y no se toca la terminal (un Escape suelto interrumpiría al agente).
 */
async function esperaBtw(cfg: TmuxConfig, name: string, question: string, t: ChatSendTiming): Promise<ChatSendResponse> {
  const sinPregunta = question === '';
  const limite = Date.now() + (sinPregunta ? t.btwBareTimeoutMs : t.btwTimeoutMs);
  const pendiente: ChatSendResponse = { sent: true, btw: null, pending: true };
  let ultima = '';
  let desde = 0;
  while (Date.now() < limite) {
    await espera(t.pollMs);
    const pantalla = await capturePane(cfg, name);
    if (pantalla === null) return { sent: true, btw: null };
    const ventana = detectTuiWindow(pantalla);
    if (ventana?.kind !== 'btw' || !ventana.ready) {
      ultima = '';
      continue;
    }
    // La respuesta puede seguir llegando: se espera a que deje de cambiar (lo que muestra la ventana, no la
    // barra de estado de debajo, que puede tener reloj o contadores).
    const marca = extractBtwAnswer(pantalla)?.answer ?? pantalla;
    if (marca !== ultima) {
      ultima = marca;
      desde = Date.now();
      continue;
    }
    if (Date.now() - desde < t.settleMs) continue;

    const respuesta = await leeRespuesta(cfg, name, pantalla, question, t);
    if (respuesta === null) return pendiente; // no hay manera de leerla: se queda en la terminal
    await cierraVentana(cfg, name, t);
    return { sent: true, btw: respuesta };
  }
  // Sin pregunta, Claude quizá solo muestra un uso: no es un /btw pendiente.
  return sinPregunta ? { sent: true, btw: null } : pendiente;
}

/**
 * El texto de la respuesta, leído de la ventana. Si no cabe, se desplaza con Abajo (cada pulsación
 * avanza unas líneas), se captura cada pantalla y se unen por solapamiento hasta que dejan de
 * cambiar. `truncated` solo si no se confirma haber llegado al final (tope de pasos, la ventana
 * se cerró o las pantallas no solapan). Av Pág no funciona en la ventana y «c» no se usa nunca.
 */
async function leeRespuesta(cfg: TmuxConfig, name: string, pantalla: string, question: string, t: ChatSendTiming): Promise<BtwAnswer | null> {
  let pagina = extractBtwPage(pantalla);
  if (pagina === null) {
    const visible = extractBtwAnswer(pantalla);
    return visible ? { question, answer: visible.answer, truncated: visible.truncated } : null;
  }
  let lineas = pagina;
  let completa = false;
  let iguales = 0;
  for (let paso = 0; paso < t.maxScrollSteps; paso++) {
    if (!(await pressKey(cfg, name, 'Down'))) break;
    await espera(t.scrollWaitMs);
    const ahora = await capturePane(cfg, name);
    if (ahora === null || detectTuiWindow(ahora)?.kind !== 'btw') break;
    const nueva = extractBtwPage(ahora);
    if (nueva === null) break;
    if (nueva.join('\n') === pagina.join('\n')) {
      // Dos pantallas seguidas sin cambios: se ha llegado al final (una sola podría ser un repintado a medias).
      if (++iguales >= 2) {
        completa = true;
        break;
      }
      continue;
    }
    iguales = 0;
    const unido = mergeBtwPages(lineas, nueva);
    lineas = unido.lines;
    pagina = nueva;
    // Sin solapamiento se ha perdido un trozo: no se puede dar por completa.
    if (!unido.solapa) break;
  }
  const answer = joinBtwLines(lineas);
  return answer === '' ? null : { question, answer, truncated: !completa };
}

/**
 * Cierra la ventana de /btw con Escape, pero solo mientras su pie siga visible: un Escape fuera de
 * ella interrumpiría al agente si está trabajando.
 */
async function cierraVentana(cfg: TmuxConfig, name: string, t: ChatSendTiming): Promise<void> {
  for (let intento = 0; intento < 2; intento++) {
    const pantalla = await capturePane(cfg, name);
    if (pantalla === null || detectTuiWindow(pantalla)?.kind !== 'btw') return;
    if (!(await pressKey(cfg, name, 'Escape'))) return;
    const limite = Date.now() + t.closeWaitMs;
    while (Date.now() < limite) {
      await espera(Math.min(150, t.pollMs));
      const ahora = await capturePane(cfg, name);
      if (ahora === null || detectTuiWindow(ahora)?.kind !== 'btw') return;
    }
  }
}

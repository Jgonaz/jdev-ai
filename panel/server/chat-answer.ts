// Respuestas del chat a lo que Claude Code espera en su terminal: las preguntas de `AskUserQuestion` y los
// permisos de herramienta (POST /api/sessions/:name/answer), y qué hay abierto ahora (GET .../prompt).
//
// Se contesta pulsando las teclas del menú de la TUI y mirando la pantalla (capture-pane) antes de empezar y
// tras cada pulsación. Si algo no coincide con lo esperado (o no aparece en un tope corto) se para SIN pulsar nada
// más, ni Escape (cancelaría la pregunta entera): 409 `tui-mismatch`, y la persona termina en la terminal, que es donde
// está la verdad. Las teclas son las de Claude Code 2.1.325 (ver tui.ts):
//
//  - Selección simple: el número elige la opción y pasa a la pestaña siguiente (con una sola pregunta, además envía).
//    Con texto libre: flechas hasta «Type something», se teclea y Enter.
//  - Selección múltiple: el número marca o desmarca sin mover el cursor. El texto libre se teclea en su fila (queda
//    marcada sola). Se baja a «Submit» y Enter.
//  - Con varias preguntas, al final sale «Review your answers»: se comprueba lo que lista y se pulsa `1` (Submit answers).
//  - Permiso: el número de la opción.
//
// Comparte el cerrojo por sesión de chat-send.ts: un envío de mensaje y una respuesta nunca se mezclan.

import { NOT_PENDING_CODE, TUI_MISMATCH_CODE } from '../shared/chat.ts';
import type { AnswerConflict, AnswerRequest, AnswerResponse, PromptInfo, QuestionAnswer } from '../shared/chat.ts';
import type { QuestionItem } from '../shared/follow.ts';
import { claveCerrojo, conCerrojo } from './chat-send.ts';
import type { PendingWork } from './follow.ts';
import { pendingQuestionOf, relativeCwd } from './prompt-hook.ts';
import type { PromptHook } from './prompt-hook.ts';
import { capturePane, pressKey, typeText } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';
import { detectTuiWindow, normalizeTuiText, readPermissionDialog, readQuestionScreen, tuiTextMatches } from './tui.ts';
import type { TuiPermissionDialog, TuiQuestionMenu, TuiQuestionReview, TuiTab } from './tui.ts';

// ------------------------------------------------------------------ Terminal

/** Lo que se hace con la terminal de la sesión. Inyectable para las pruebas; por defecto es tmux. */
export type TuiIo = {
  /** La pantalla visible; null si la sesión ya no existe. */
  capture(): Promise<string | null>;
  /** Pulsa una tecla (nombre de tecla de tmux o un carácter); false si la sesión ya no existe. */
  press(tecla: string): Promise<boolean>;
  /** Teclea texto tal cual, sin Enter; false si la sesión ya no existe. */
  type(texto: string): Promise<boolean>;
};

export const tmuxIo = (cfg: TmuxConfig, name: string): TuiIo => ({
  capture: () => capturePane(cfg, name),
  press: (tecla) => pressKey(cfg, name, tecla),
  type: (texto) => typeText(cfg, name, texto),
});

export type AnswerTiming = {
  /** Cada cuánto se mira la pantalla mientras se espera un cambio. */
  pollMs: number;
  /** Tope de espera de cada cambio esperado tras una pulsación. */
  stepTimeoutMs: number;
  /** Tope de espera a que el menú o el diálogo se cierre tras la última pulsación. */
  doneTimeoutMs: number;
};

export const DEFAULT_ANSWER_TIMING: AnswerTiming = { pollMs: 80, stepTimeoutMs: 3000, doneTimeoutMs: 5000 };

export type AnswerOptions = {
  timing?: Partial<AnswerTiming>;
  /** Solo las pruebas: una terminal simulada en lugar de tmux. */
  io?: TuiIo;
};

export type AnswerResult =
  | { status: 200; body: AnswerResponse }
  | { status: 400; body: { error: string } }
  | { status: 404; body: { error: string } }
  | { status: 409; body: AnswerConflict };

const NO_EXISTE = { status: 404, body: { error: 'La sesión no existe.' } } as const;

type QuestionEvent = NonNullable<PendingWork['question']>;
type QuestionRequest = Extract<AnswerRequest, { kind: 'question' }>;
type PermissionRequest = Extract<AnswerRequest, { kind: 'permission' }>;

// ------------------------------------------------------------------ Pasos

/** La pantalla no es la esperada: se para. `step` es un identificador estable; `detalle`, lo que se esperaba. */
class Parada extends Error {
  readonly step: string;
  constructor(step: string, detalle: string) {
    super(detalle);
    this.step = step;
  }
}

/** La sesión ya no existe (la terminal devolvió null o rechazó la tecla). */
class SinSesion extends Error {}

type Estado = { io: TuiIo; t: AnswerTiming; pulsadas: number };

const dormir = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

async function captura(e: Estado): Promise<string> {
  const pantalla = await e.io.capture();
  if (pantalla === null) throw new SinSesion();
  return pantalla;
}

async function pulsa(e: Estado, tecla: string): Promise<void> {
  e.pulsadas++;
  if (!(await e.io.press(tecla))) throw new SinSesion();
}

async function teclea(e: Estado, texto: string): Promise<void> {
  e.pulsadas++;
  if (!(await e.io.type(texto))) throw new SinSesion();
}

/** Mira la pantalla hasta que `prueba` devuelva algo (o se agote `ms`); null si no apareció. */
async function espera<T>(e: Estado, ms: number, prueba: (pantalla: string) => T | null): Promise<T | null> {
  const limite = Date.now() + ms;
  for (;;) {
    const hallado = prueba(await captura(e));
    if (hallado !== null) return hallado;
    const resto = limite - Date.now();
    if (resto <= 0) return null;
    await dormir(Math.min(e.t.pollMs, resto));
  }
}

/**
 * Espera a que `presente` deje de cumplirse en dos capturas seguidas (una sola podría ser un repintado a medias).
 * false si sigue presente al agotarse `ms`.
 */
async function esperaAusencia(e: Estado, ms: number, presente: (pantalla: string) => boolean): Promise<boolean> {
  const limite = Date.now() + ms;
  let ausente = 0;
  for (;;) {
    ausente = presente(await captura(e)) ? 0 : ausente + 1;
    if (ausente >= 2) return true;
    if (Date.now() >= limite) return false;
    await dormir(Math.min(e.t.pollMs, Math.max(0, limite - Date.now())));
  }
}

// ------------------------------------------------------------------ Preguntas

/** Respuesta a una pregunta, ya validada: opciones (índices ascendentes) y texto libre ('' si no hay). */
type Plan = { options: number[]; text: string };

/**
 * Comprueba que `answers` encaja con las preguntas pendientes (una por pregunta; una opción o un texto en las
 * simples; al menos una opción o un texto en las múltiples; índices en rango) y las normaliza. Devuelve el
 * motivo si no encaja.
 */
export function planAnswers(preguntas: readonly QuestionItem[], answers: readonly QuestionAnswer[]): Plan[] | string {
  if (answers.length !== preguntas.length) return `Hay ${preguntas.length} pregunta(s) y llegan ${answers.length} respuesta(s).`;
  const plan: Plan[] = [];
  for (let i = 0; i < preguntas.length; i++) {
    const q = preguntas[i]!;
    const a = answers[i]!;
    const texto = a.text ?? '';
    if (a.options.some((o) => !Number.isInteger(o) || o < 0 || o >= q.options.length) || new Set(a.options).size !== a.options.length) {
      return `La respuesta ${i + 1} elige una opción que no existe.`;
    }
    const elegidas = a.options.length + (texto === '' ? 0 : 1);
    if (q.multiSelect ? elegidas < 1 : elegidas !== 1) {
      return q.multiSelect ? `La pregunta ${i + 1} necesita al menos una opción o un texto.` : `La pregunta ${i + 1} admite una sola respuesta: una opción o un texto.`;
    }
    plan.push({ options: [...a.options].sort((x, y) => x - y), text: texto });
  }
  return plan;
}

/** Cómo Claude Code guarda (y lista en la revisión) la respuesta: opciones en su orden unidas por «, » y el texto al final. */
function respuestaEsperada(q: QuestionItem, a: Plan): string {
  return [...a.options.map((o) => q.options[o]!.label), ...(a.text === '' ? [] : [a.text])].join(', ');
}

function respuestaCasa(visible: string, esperada: string): boolean {
  const v = normalizeTuiText(visible);
  const f = normalizeTuiText(esperada);
  return v === f || (/…$/.test(v) && f.startsWith(v.slice(0, -1).trimEnd()));
}

/**
 * Las pestañas visibles son las de estas preguntas. La fila puede recortarse en una terminal estrecha: se compara solo
 * lo que se ve, pero si se ve «Submit» se ven todas.
 */
function pestanasCasan(pantalla: { tabs: TuiTab[]; submitTab: boolean }, preguntas: readonly QuestionItem[]): boolean {
  const { tabs } = pantalla;
  if (tabs.length === 0 || tabs.length > preguntas.length) return false;
  if (tabs.length < preguntas.length && pantalla.submitTab) return false;
  return tabs.every((t, i) => preguntas[i]!.header === '' || tuiTextMatches(t.header, preguntas[i]!.header));
}

/** El menú de la pregunta `i` (de las pendientes), con todas las anteriores contestadas y las siguientes no. */
function menuDe(preguntas: readonly QuestionItem[], i: number): (pantalla: string) => TuiQuestionMenu | null {
  const q = preguntas[i]!;
  return (pantalla) => {
    const m = readQuestionScreen(pantalla);
    if (m?.kind !== 'menu' || !pestanasCasan(m, preguntas)) return null;
    if (m.tabs.slice(0, i).some((t) => !t.answered) || m.tabs.slice(i + 1).some((t) => t.answered)) return null;
    // Una simple ya contestada es otra respuesta que se cambiaría; una múltiple se marca (☒) en cuanto tiene algo.
    if (m.tabs[i]?.answered && !q.multiSelect) return null;
    if (!tuiTextMatches(m.question, q.question) || m.multiSelect !== q.multiSelect) return null;
    if (m.options.length !== q.options.length || m.other.n !== q.options.length + 1) return null;
    if (!m.options.every((o, j) => o.n === j + 1 && tuiTextMatches(o.label, q.options[j]!.label))) return null;
    return m;
  };
}

/** Posición del cursor: número de fila, o el de «Submit» (el siguiente al de la fila de texto) si está ahí. */
function posicion(m: TuiQuestionMenu): number | null {
  if (m.cursorRow !== null) return m.cursorRow;
  if (m.submit === null || m.chatCursor) return null;
  // Sin cursor visible en ninguna fila numerada ni en «Chat about this», solo queda «Submit».
  return m.other.n + 1;
}

/** Baja el cursor con Abajo, de uno en uno y comprobando cada paso, hasta la fila `destino`. */
async function bajaHasta(e: Estado, preguntas: readonly QuestionItem[], i: number, inicial: TuiQuestionMenu, destino: number): Promise<TuiQuestionMenu> {
  let m = inicial;
  let pos = posicion(m);
  if (pos === null || pos > destino) throw new Parada('cursor', 'no se ve dónde está el cursor del menú');
  while (pos < destino) {
    const actual: number = pos;
    await pulsa(e, 'Down');
    const siguiente = await espera(e, e.t.stepTimeoutMs, (p) => {
      const x = menuDe(preguntas, i)(p);
      return x !== null && posicion(x) === actual + 1 ? x : null;
    });
    if (siguiente === null) throw new Parada('cursor', 'el cursor no bajó a la fila esperada');
    m = siguiente;
    pos = actual + 1;
  }
  return m;
}

async function contestaPregunta(e: Estado, preguntas: readonly QuestionItem[], plan: readonly Plan[], i: number, inicial: TuiQuestionMenu): Promise<void> {
  const q = preguntas[i]!;
  const a = plan[i]!;
  let m = inicial;

  if (!q.multiSelect) {
    // El número elige y pasa a la pestaña siguiente (o envía, con una sola pregunta).
    if (a.text === '') return pulsa(e, String(a.options[0]! + 1));
    if (m.other.text !== '') throw new Parada('texto', 'la fila «Type something» ya tiene algo escrito');
    m = await bajaHasta(e, preguntas, i, m, m.other.n);
    await tecleaEnFilaDeTexto(e, preguntas, i, a.text, false);
    return pulsa(e, 'Enter');
  }

  // Selección múltiple: el número marca o desmarca. Se parte de lo que se ve (una opción puede venir ya marcada).
  for (let j = 0; j < q.options.length; j++) {
    const quiere = a.options.includes(j);
    if (m.options[j]!.checked === quiere) continue;
    await pulsa(e, String(j + 1));
    const marcada = await espera(e, e.t.stepTimeoutMs, (p) => {
      const x = menuDe(preguntas, i)(p);
      return x !== null && x.options[j]!.checked === quiere ? x : null;
    });
    if (marcada === null) throw new Parada('marca', `la opción ${j + 1} no quedó ${quiere ? 'marcada' : 'desmarcada'}`);
    m = marcada;
  }
  if (a.text !== '') {
    if (m.other.text !== a.text) {
      if (m.other.text !== '') throw new Parada('texto', 'la fila «Type something» ya tiene otro texto');
      m = await bajaHasta(e, preguntas, i, m, m.other.n);
      m = await tecleaEnFilaDeTexto(e, preguntas, i, a.text, true);
    }
  } else if (m.other.text !== '' || m.other.checked === true) {
    throw new Parada('texto', 'la fila «Type something» ya tiene algo escrito');
  }
  if (m.submit === null) throw new Parada('submit', 'no se ve la fila «Submit»');
  await bajaHasta(e, preguntas, i, m, m.other.n + 1);
  return pulsa(e, 'Enter');
}

/** Teclea el texto con el cursor ya en la fila de «Type something» y comprueba que se ve (y, en las múltiples, que queda marcada). */
async function tecleaEnFilaDeTexto(e: Estado, preguntas: readonly QuestionItem[], i: number, texto: string, multi: boolean): Promise<TuiQuestionMenu> {
  await teclea(e, texto);
  const escrito = await espera(e, e.t.stepTimeoutMs, (p) => {
    const x = menuDe(preguntas, i)(p);
    return x !== null && tuiTextMatches(x.other.text, texto) && (!multi || x.other.checked === true) ? x : null;
  });
  if (escrito === null) throw new Parada('texto', 'el texto no aparece en la fila «Type something»');
  return escrito;
}

/** Comprueba la pantalla de revisión contra lo que se quiso contestar y envía con `1` (Submit answers). */
async function enviaRevision(e: Estado, preguntas: readonly QuestionItem[], plan: readonly Plan[], revision: TuiQuestionReview): Promise<void> {
  if (revision.entries.length !== preguntas.length) throw new Parada('revision', 'la revisión no lista todas las preguntas');
  for (let i = 0; i < preguntas.length; i++) {
    const entrada = revision.entries[i]!;
    if (!tuiTextMatches(entrada.question, preguntas[i]!.question) || !respuestaCasa(entrada.answer, respuestaEsperada(preguntas[i]!, plan[i]!))) {
      throw new Parada('revision', `la revisión muestra otra respuesta en la pregunta ${i + 1}`);
    }
  }
  const enviar = revision.options[0];
  if (!enviar || enviar.n !== 1 || !tuiTextMatches(enviar.label, 'Submit answers')) throw new Parada('revision', 'la opción 1 de la revisión no es «Submit answers»');
  await pulsa(e, '1');
}

async function contestaPreguntas(e: Estado, preguntas: readonly QuestionItem[], plan: readonly Plan[]): Promise<void> {
  let menu = await espera(e, e.t.stepTimeoutMs, menuDe(preguntas, 0));
  if (menu === null) throw new Parada('menu', 'el menú de preguntas no está abierto, o no es el de estas preguntas, o ya está contestada la primera');
  for (let i = 0; i < preguntas.length; i++) {
    if (i > 0) {
      menu = await espera(e, e.t.stepTimeoutMs, menuDe(preguntas, i));
      if (menu === null) throw new Parada('pregunta', `no aparece la pregunta ${i + 1} tras contestar la anterior`);
    }
    await contestaPregunta(e, preguntas, plan, i, menu!);
  }

  // Tras la última respuesta: con varias preguntas, la revisión; con una, el menú se cierra sin más.
  const fin = await espera<TuiQuestionReview | 'cerrado'>(e, e.t.stepTimeoutMs, (p) => {
    const s = readQuestionScreen(p);
    return s === null ? 'cerrado' : s.kind === 'review' ? s : null;
  });
  if (fin === null) throw new Parada('envio', 'tras la última respuesta la terminal sigue en el menú');
  if (fin !== 'cerrado') await enviaRevision(e, preguntas, plan, fin);
  if (!(await esperaAusencia(e, e.t.doneTimeoutMs, (p) => readQuestionScreen(p) !== null))) {
    throw new Parada('envio', 'el menú no se cerró tras enviar las respuestas');
  }
}

// ------------------------------------------------------------------ Permisos

async function contestaPermiso(e: Estado, req: PermissionRequest): Promise<void> {
  const dialogo = await espera(e, e.t.stepTimeoutMs, readPermissionDialog);
  if (dialogo === null) throw new Parada('permiso', 'no hay un diálogo de permiso abierto');
  const opcion = dialogo.options.find((o) => o.n === req.option);
  if (!opcion) throw new Parada('permiso', `el diálogo no tiene la opción ${req.option}`);
  if (normalizeTuiText(opcion.label) !== normalizeTuiText(req.label)) throw new Parada('etiqueta', `la opción ${req.option} ya no es «${req.label}»`);
  await pulsa(e, String(opcion.n));
  // Otro diálogo distinto que aparezca enseguida (otra herramienta pidiendo permiso) cuenta como cerrado.
  const cerrado = await esperaAusencia(e, e.t.doneTimeoutMs, (p) => {
    const ahora = readPermissionDialog(p);
    return ahora !== null && ahora.signature === dialogo.signature;
  });
  if (!cerrado) throw new Parada('permiso', 'el diálogo no se cerró tras elegir la opción');
}

// ------------------------------------------------------------------ API

function enRespuesta(error: unknown, e: Estado): AnswerResult {
  if (error instanceof SinSesion) return NO_EXISTE;
  if (!(error instanceof Parada)) throw error;
  const resto =
    e.pulsadas === 0
      ? 'No se ha pulsado ninguna tecla.'
      : 'No se ha pulsado nada más, pero la respuesta puede haber quedado a medias: termínala en la terminal.';
  return { status: 409, body: { code: TUI_MISMATCH_CODE, step: error.step, error: `La terminal no muestra lo que el panel esperaba (${error.message}). ${resto}` } };
}

const estadoDe = (cfg: TmuxConfig, name: string, opciones: AnswerOptions): Estado => ({
  io: opciones.io ?? tmuxIo(cfg, name),
  t: { ...DEFAULT_ANSWER_TIMING, ...opciones.timing },
  pulsadas: 0,
});

/**
 * Contesta una pregunta de `AskUserQuestion` en la terminal. `cargaPendiente` da la pregunta que sigue sin resultado en
 * la transcripción (se llama con el cerrojo ya tomado: una respuesta anterior ya habrá dejado su resultado).
 */
export async function answerQuestion(
  cfg: TmuxConfig,
  name: string,
  req: QuestionRequest,
  cargaPendiente: () => Promise<QuestionEvent | null>,
  opciones: AnswerOptions = {},
): Promise<AnswerResult> {
  return conCerrojo(claveCerrojo(cfg, name), async () => {
    const pendiente = await cargaPendiente();
    if (pendiente === null || pendiente.id !== req.id) {
      return { status: 409, body: { code: NOT_PENDING_CODE, error: 'La pregunta ya no está pendiente: puede que se haya contestado en la terminal.' } };
    }
    const plan = planAnswers(pendiente.questions, req.answers);
    if (typeof plan === 'string') return { status: 400, body: { error: plan } };
    const e = estadoDe(cfg, name, opciones);
    try {
      await contestaPreguntas(e, pendiente.questions, plan);
      return { status: 200, body: { answered: true } };
    } catch (error) {
      return enRespuesta(error, e);
    }
  });
}

/** Elige una opción del diálogo de permiso abierto, si sigue abierto y la opción conserva su etiqueta. */
export async function answerPermission(cfg: TmuxConfig, name: string, req: PermissionRequest, opciones: AnswerOptions = {}): Promise<AnswerResult> {
  return conCerrojo(claveCerrojo(cfg, name), async () => {
    const e = estadoDe(cfg, name, opciones);
    try {
      await contestaPermiso(e, req);
      return { status: 200, body: { answered: true } };
    } catch (error) {
      return enRespuesta(error, e);
    }
  });
}

const PERMISO_DEL_HOOK = /^Claude needs your permission to use (.+?)\.?$/i;

/**
 * El permiso del hook es el del diálogo que se ve: un archivo que no se borró (la herramienta se rechazó, así que no hubo
 * `PostToolUse`) no debe enseñar un comando que ya no se está pidiendo. En Bash el diálogo pinta el comando tal cual: su
 * comienzo tiene que verse. Para el resto de herramientas no hay una forma fiable de comparar (rutas relativas o
 * absolutas), y se fía del hook.
 */
function hookCasaConPantalla(hook: Extract<PromptHook, { kind: 'permission' }>, dialogo: TuiPermissionDialog): boolean {
  if (hook.tool !== 'Bash') return true;
  const comienzo = normalizeTuiText(hook.input.target).slice(0, 12);
  return comienzo === '' || normalizeTuiText(dialogo.signature).includes(comienzo);
}

export type PromptDeps = {
  cargaPendiente: () => Promise<PendingWork>;
  /** Mensaje del último aviso de la sesión. Antes nombraba la herramienta («…to use X»); ahora solo dice «Claude needs your permission». */
  aviso: string;
  /** Lo pendiente que dejó el hook (`prompts/<session_id>.json`); null en sesiones sin esos hooks o si no hay nada. */
  hook?: PromptHook | null;
  /** Directorio de trabajo de la sesión, para decir dónde se ejecuta lo que pide un permiso si es otro. */
  cwd?: string;
};

/**
 * Qué hay abierto en la pantalla y el chat puede contestar: una pregunta de `AskUserQuestion` (solo si sus
 * pestañas casan con la pregunta pendiente: la del hook o, sin ella, la de la transcripción), un diálogo de permiso
 * con sus opciones (leídas de la pantalla) y, si hay hook, la herramienta y su entrada, otra ventana o menú
 * de Claude (`other`) o nada (null). La pantalla manda: el hook solo da el detalle que la TUI no deja leer entero.
 */
export async function describePrompt(pantalla: string, deps: PromptDeps): Promise<PromptInfo | null> {
  let pendiente: Promise<PendingWork> | null = null;
  const pendientes = () => (pendiente ??= deps.cargaPendiente());
  const hook = deps.hook ?? null;
  const ventana = detectTuiWindow(pantalla);

  const menu = readQuestionScreen(pantalla);
  if (menu) {
    const question = pendingQuestionOf(await pendientes(), hook);
    if (question !== null && pestanasCasan(menu, question.questions)) {
      const activa = menu.kind === 'menu' ? question.questions.findIndex((q) => tuiTextMatches(menu.question, q.question)) : -1;
      return {
        kind: 'question',
        id: question.id,
        questions: question.questions,
        screen: menu.kind,
        tabs: menu.tabs.map((t) => ({ header: t.header, answered: t.answered })),
        active: activa >= 0 ? activa : null,
      };
    }
    return { kind: 'other', hint: ventana?.hint ?? '' };
  }

  const dialogo: TuiPermissionDialog | null = readPermissionDialog(pantalla);
  if (dialogo) {
    const permiso = hook?.kind === 'permission' && hookCasaConPantalla(hook, dialogo) ? hook : null;
    const tool = permiso?.tool ?? PERMISO_DEL_HOOK.exec(deps.aviso.trim())?.[1] ?? null;
    let toolUseId: string | undefined;
    if (tool !== null) {
      // Con varias llamadas pendientes de la misma herramienta no se sabe cuál pide el permiso.
      const mias = (await pendientes()).tools.filter((t) => t.tool === tool);
      if (mias.length === 1) toolUseId = mias[0]!.id;
    }
    const donde = permiso ? relativeCwd(permiso.cwd, deps.cwd ?? '') : undefined;
    return {
      kind: 'permission',
      tool,
      ...(permiso ? { input: { ...permiso.input, ...(donde === undefined ? {} : { where: donde }) } } : {}),
      title: dialogo.title,
      question: dialogo.question,
      options: dialogo.options.map((o) => ({ n: o.n, label: o.label })),
      ...(toolUseId === undefined ? {} : { toolUseId }),
    };
  }
  return ventana ? { kind: 'other', hint: ventana.hint } : null;
}

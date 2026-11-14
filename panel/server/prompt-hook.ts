// Lo que Claude espera de la persona, según los hooks: bin/session-state guarda el JSON del hook tal cual en
// ${XDG_STATE_HOME:-~/.local/state}/jdev-ai/prompts/<session_id>.json mientras la pregunta (`PreToolUse` de
// `AskUserQuestion`) o el permiso (`PermissionRequest` de otra herramienta) esperan, y lo borra al terminar la herramienta,
// al escribir la persona, al acabar el turno y al terminar la sesión. La transcripción no trae el `tool_use` hasta que se
// contesta (comprobado con Claude Code 2.1.325), así que este archivo es el origen; la transcripción y la pantalla son el respaldo.
//
// El archivo lo escribe el shell sin interpretarlo: aquí se valida (forma, topes, `session_id` igual al del nombre).

import type { PermissionInput } from '../shared/chat.ts';
import type { PendingWork } from './follow.ts';
import { describeTool, leePreguntas } from './follow.ts';
import type { AgentEvent } from './follow.ts';

/** Tope de tamaño del archivo; es el mismo que aplica bin/session-state al escribirlo. */
export const PROMPT_HOOK_MAX_BYTES = 256 * 1024;

const MAX_TEXT = 2000;
const MAX_FIELD = 500;
const MAX_CWD = 400;
const ID_HERRAMIENTA = /^[\w-]{1,200}$/;
const NOMBRE_HERRAMIENTA = /^[\w.:-]{1,200}$/;

type QuestionEvent = Extract<AgentEvent, { type: 'question' }>;

export type PromptHook =
  | {
      kind: 'question';
      sessionId: string;
      /** `tool_use_id` de la pregunta: es el `id` de su `tool_use` y de su `tool_result` en la transcripción. */
      toolUseId: string;
      questions: QuestionEvent['questions'];
      /** Última escritura del archivo (ms desde la época). */
      at: number;
    }
  | {
      kind: 'permission';
      sessionId: string;
      tool: string;
      /** Lo que va a hacer, resumido con `describeTool` y con el texto completo para enseñarlo. */
      input: PermissionInput;
      /** Directorio de trabajo que traía el hook ('' si no venía). */
      cwd: string;
      at: number;
    };

const objeto = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const cadena = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const recorta = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/**
 * Interpreta el archivo de la sesión `id`. null si no es JSON, no es de esa sesión, no es un evento que se guarde
 * (pregunta de `AskUserQuestion` con topes admitidos, o permiso de otra herramienta) o no tiene la forma esperada.
 */
export function parsePromptHook(contenido: string, mtimeMs: number, id: string): PromptHook | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(contenido);
  } catch {
    return null;
  }
  const o = objeto(bruto);
  if (!o || o.session_id !== id) return null;
  const herramienta = typeof o.tool_name === 'string' ? o.tool_name : '';
  const entrada = objeto(o.tool_input);
  if (o.hook_event_name === 'PreToolUse' && herramienta === 'AskUserQuestion') {
    const toolUseId = o.tool_use_id;
    if (typeof toolUseId !== 'string' || !ID_HERRAMIENTA.test(toolUseId)) return null;
    const questions = leePreguntas(entrada);
    return questions ? { kind: 'question', sessionId: id, toolUseId, questions, at: mtimeMs } : null;
  }
  // Una AskUserQuestion también dispara un PermissionRequest: no es un permiso, su pregunta la registró PreToolUse.
  if (o.hook_event_name === 'PermissionRequest' && herramienta !== 'AskUserQuestion' && NOMBRE_HERRAMIENTA.test(herramienta)) {
    const cwd = typeof o.cwd === 'string' ? o.cwd : '';
    return { kind: 'permission', sessionId: id, tool: herramienta, input: describeInput(herramienta, entrada, cwd), cwd: recorta(cwd, MAX_CWD), at: mtimeMs };
  }
  return null;
}

/** Resumen de lo que pide una herramienta: verbo, objetivo y detalle (`describeTool`), el texto completo y la descripción si la trae. */
function describeInput(herramienta: string, entrada: Record<string, unknown> | null, cwd: string): PermissionInput {
  const h = describeTool(herramienta, entrada, cwd || null);
  // En Bash el objetivo es solo la primera línea: el diálogo enseña el comando entero.
  const completo = herramienta === 'Bash' ? cadena(entrada?.command)?.trim() : undefined;
  const descripcion = cadena(entrada?.description)?.trim();
  return {
    verb: h.verb,
    target: recorta(h.target, MAX_FIELD),
    ...(h.detail ? { detail: h.detail } : {}),
    text: recorta(completo ?? h.target, MAX_TEXT),
    ...(descripcion ? { description: recorta(descripcion, MAX_FIELD) } : {}),
  };
}

/**
 * Dónde se ejecuta lo que pide el permiso, si no es el directorio de la sesión: la ruta relativa a este si cuelga de él, o la
 * ruta tal cual si queda fuera. undefined si es el mismo, o falta alguno.
 */
export function relativeCwd(hookCwd: string, sessionCwd: string): string | undefined {
  if (hookCwd === '' || hookCwd === sessionCwd) return undefined;
  const base = sessionCwd.replace(/\/+$/, '');
  if (base !== '' && hookCwd.startsWith(`${base}/`)) return hookCwd.slice(base.length + 1).replace(/\/+$/, '') || undefined;
  return hookCwd;
}

/**
 * La pregunta pendiente. Manda la del hook mientras su `tool_use_id` no tenga resultado en la transcripción (el archivo solo
 * existe mientras espera, y la transcripción puede arrastrar una pregunta antigua sin cerrar); si la transcripción ya trae
 * esa misma línea, se usa esa (con su hora real). Sin hook (sesiones sin esos hooks, o ya contestada), la última pregunta sin
 * resultado de la transcripción.
 */
export function pendingQuestionOf(trabajo: PendingWork, hook: PromptHook | null): QuestionEvent | null {
  if (hook?.kind === 'question' && !trabajo.resolved.has(hook.toolUseId)) {
    if (trabajo.question?.id === hook.toolUseId) return trabajo.question;
    return { type: 'question', id: hook.toolUseId, questions: hook.questions, at: hook.at };
  }
  return trabajo.question;
}

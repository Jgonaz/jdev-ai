import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Estado de cada conversación: abierta o hecha. Vive fuera del título, en un
// archivo por conversación en ${XDG_STATE_HOME:-~/.local/state}/jdev-ai/conversations/
// que escriben bin/session-done (el agente), el hook de bin/session-title (la
// persona al escribir) y este servidor (la persona desde el panel):
//
//   <clave>.json   {"state":"done"|"open","at":"<ISO>","by":"user"|"agent","note":"…"}
//
// La clave es el id de la conversación de Claude (UUID, el de sus transcripts y
// «Anteriores») o, en sesiones del panel sin conversación de Claude (Codex,
// terminal…), `tmux-<nombre>-<creación en milisegundos>`: así un nombre de tmux
// reutilizado, aunque sea en el mismo segundo, no hereda el estado de la sesión
// anterior. Las claves con la creación en segundos (formato anterior) se siguen leyendo.

/** Longitud máxima de la nota, en caracteres. */
export const CONVERSATION_NOTE_MAX = 500;
/** Tamaño máximo que se lee de un archivo (500 caracteres escapados caben de sobra). */
export const CONVERSATION_MAX_BYTES = 8 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TMUX_KEY = /^tmux-jdev-[a-z0-9_-]+-[0-9]+-[0-9]+$/;
// Caracteres de control (saltos incluidos) y separadores de línea o párrafo.
const PROHIBIDO = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export type ConversationEntry = {
  state: 'done' | 'open';
  /** ISO 8601. */
  at: string;
  by: 'user' | 'agent';
  note: string | null;
};

/** Hecha: cuándo (null si solo consta la marca antigua del título), quién y la nota. */
export type Done = { at: string | null; by: 'user' | 'agent'; note: string | null };

export function isConversationKey(clave: unknown): clave is string {
  return typeof clave === 'string' && (UUID.test(clave) || TMUX_KEY.test(clave));
}

export function isConversationId(clave: unknown): clave is string {
  return typeof clave === 'string' && UUID.test(clave);
}

/** Clave de una sesión del panel sin conversación de Claude (`created` en milisegundos). */
export function tmuxConversationKey(nombre: string, created: number): string {
  return `tmux-${nombre}-${Math.floor(created)}`;
}

/** Clave con la creación en segundos, la del formato anterior: solo se lee, nunca se escribe. */
export function legacyTmuxConversationKey(nombre: string, created: number): string {
  return `tmux-${nombre}-${Math.floor(created / 1000)}`;
}

/** Nota válida (sin espacios en los extremos, sin caracteres de control ni saltos de línea) o el motivo por el que no vale. */
export function checkNote(valor: unknown): { ok: true; note: string | null } | { ok: false; error: string } {
  if (valor === undefined || valor === null) return { ok: true, note: null };
  if (typeof valor !== 'string') return { ok: false, error: 'La nota debe ser un texto.' };
  const note = valor.trim();
  if (note === '') return { ok: true, note: null };
  if (Array.from(note).length > CONVERSATION_NOTE_MAX) {
    return { ok: false, error: `La nota es demasiado larga (máximo ${CONVERSATION_NOTE_MAX} caracteres).` };
  }
  if (PROHIBIDO.test(note)) return { ok: false, error: 'La nota no puede contener caracteres de control ni saltos de línea.' };
  return { ok: true, note };
}

/** Contenido de un archivo de estado; null si no es válido (entonces es como si no existiera). */
export function parseConversation(contenido: string): ConversationEntry | null {
  let obj: unknown;
  try {
    obj = JSON.parse(contenido);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o.state !== 'done' && o.state !== 'open') return null;
  if (o.by !== 'user' && o.by !== 'agent') return null;
  if (typeof o.at !== 'string') return null;
  const ms = Date.parse(o.at);
  if (Number.isNaN(ms)) return null;
  // Una nota que no vale se omite, pero no invalida el estado.
  const nota = checkNote(o.note);
  return { state: o.state, at: new Date(ms).toISOString(), by: o.by, note: nota.ok ? nota.note : null };
}

/**
 * «Hecha» de una conversación. Si tiene archivo de estado, manda el archivo; si
 * no, la marca antigua `[Closed] ` del título cuenta como hecha por el agente y
 * sin fecha.
 */
export function resolveDone(entry: ConversationEntry | undefined, legacyClosed: boolean): Done | null {
  if (entry) return entry.state === 'done' ? { at: entry.at, by: entry.by, note: entry.note } : null;
  return legacyClosed ? { at: null, by: 'agent', note: null } : null;
}

/**
 * Escribe el estado de una conversación de forma atómica: temporal con punto
 * inicial en el mismo directorio (para que no se lea como una conversación) y
 * rename. Crea el directorio si hace falta.
 */
export async function writeConversation(dir: string, clave: string, entry: ConversationEntry): Promise<void> {
  if (!isConversationKey(clave)) throw new Error('clave de conversación no válida');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const destino = join(dir, `${clave}.json`);
  const temporal = join(dir, `.${clave}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const cuerpo: Record<string, unknown> = { state: entry.state, at: entry.at, by: entry.by };
  if (entry.note !== null) cuerpo.note = entry.note;
  try {
    const fh = await open(temporal, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await fh.writeFile(`${JSON.stringify(cuerpo)}\n`, 'utf8');
    } finally {
      await fh.close();
    }
    await chmod(temporal, 0o600);
    await rename(temporal, destino);
  } catch (e) {
    await unlink(temporal).catch(() => {});
    throw e;
  }
}

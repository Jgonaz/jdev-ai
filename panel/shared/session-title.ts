// Validación del título de una sesión que comparten el servidor (que la exige)
// y el cliente (que avisa antes de enviar). Módulo sin dependencias de Node.

/** Longitud máxima del título, en caracteres (puntos de código, no unidades UTF-16). */
export const SESSION_TITLE_MAX = 80;
/**
 * Marca antigua con la que bin/session-title señalaba una sesión cerrada. Ya no
 * se escribe (el estado es el de la conversación), pero las que la llevan siguen
 * contando como hechas y el panel la quita del título que muestra.
 */
export const CLOSED_MARK = '[Closed] ';

// Caracteres de control (tabuladores y saltos incluidos) y separadores de línea o párrafo.
const PROHIBIDO = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export type TitleCheck = { ok: true; title: string } | { ok: false; error: string };

/** Título limpio (sin espacios en los extremos) o el motivo por el que no vale. */
export function checkSessionTitle(valor: unknown): TitleCheck {
  if (typeof valor !== 'string') return { ok: false, error: 'El título debe ser un texto.' };
  const title = valor.trim();
  if (title === '') return { ok: false, error: 'Escribe un título.' };
  if (Array.from(title).length > SESSION_TITLE_MAX) {
    return { ok: false, error: `El título es demasiado largo (máximo ${SESSION_TITLE_MAX} caracteres).` };
  }
  if (PROHIBIDO.test(title)) return { ok: false, error: 'El título no puede contener caracteres de control ni saltos de línea.' };
  return { ok: true, title };
}

/** true si el texto empieza por la marca antigua: se guarda como texto, pero el panel lo leería como «hecha». */
export function startsWithClosedMark(titulo: string): boolean {
  return titulo.trimStart().startsWith(CLOSED_MARK);
}

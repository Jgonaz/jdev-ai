// Validación del título de una sesión que comparten el servidor (que la exige)
// y el cliente (que avisa antes de enviar). Módulo sin dependencias de Node.

/** Longitud máxima del título, en caracteres (puntos de código, no unidades UTF-16). */
export const SESSION_TITLE_MAX = 80;
/** Marca con la que bin/session-title señala una sesión cerrada; la gestiona el panel, no el título. */
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
  if (title.startsWith(CLOSED_MARK.trim())) {
    return { ok: false, error: `El título no puede empezar por «${CLOSED_MARK.trim()}»: esa marca la gestiona el panel.` };
  }
  return { ok: true, title };
}

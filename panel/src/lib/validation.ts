import { PROFILE_NAME_MAX, cleanProfileName, isValidProfileName } from '../../shared/settings-schema.ts';

/** Mensaje de error de un entero en un rango, o null si el texto es válido. */
export function integerError(texto: string, min: number, max: number): string | null {
  if (/^\d+$/.test(texto.trim()) && Number(texto) >= min && Number(texto) <= max) return null;
  return `Escribe un número entero entre ${min} y ${max}.`;
}

/**
 * «Tu nombre» mientras se escribe: `text` es lo que queda en el campo (limpio,
 * con los caracteres no admitidos como espacios), `value` lo que se guardaría
 * (sin espacios en los extremos) y `error`, si no se puede guardar. La regla es
 * la misma que valida el servidor (`isValidProfileName`).
 */
export function profileNameInput(raw: string): { text: string; value: string; error: string | null } {
  const text = cleanProfileName(raw);
  const value = text.trim();
  const error = isValidProfileName(value) ? null : `Como mucho ${PROFILE_NAME_MAX} caracteres: acórtalo para guardarlo.`;
  return { text, value, error };
}

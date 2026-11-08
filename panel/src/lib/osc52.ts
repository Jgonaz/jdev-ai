// OSC 52: la aplicación (aquí, tmux al copiar una selección) pide escribir en el
// portapapeles del terminal. Formato: «<selección>;<base64>», p. ej. «c;aG9sYQ==».

/**
 * Devuelve el texto que hay que copiar, o null si la secuencia no es una escritura
 * válida. Las consultas («?») se ignoran a propósito: dejarían a cualquier programa
 * de la terminal leer el portapapeles del usuario.
 */
export function decodeOsc52(data: string): string | null {
  const sep = data.indexOf(';');
  if (sep < 0) return null;
  const carga = data.slice(sep + 1);
  if (carga === '' || carga === '?') return null;
  try {
    const binario = atob(carga);
    // El base64 lleva bytes UTF-8: atob los da como caracteres latin-1.
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

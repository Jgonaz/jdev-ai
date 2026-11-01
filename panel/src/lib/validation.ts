/** Mensaje de error de un entero en un rango, o null si el texto es válido. */
export function integerError(texto: string, min: number, max: number): string | null {
  if (/^\d+$/.test(texto.trim()) && Number(texto) >= min && Number(texto) <= max) return null;
  return `Escribe un número entero entre ${min} y ${max}.`;
}

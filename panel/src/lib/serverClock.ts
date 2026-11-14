/**
 * Desfase entre el reloj del servidor y el del navegador. Las horas que enseña el panel (transcripts, sesiones,
 * límites) salen del reloj del servidor; si el navegador corre en otra máquina (Windows frente a WSL, que suele
 * adelantarse o atrasarse), restarlas de `Date.now()` da tiempos negativos que se quedan en «0 s».
 */
let desfase = 0;

/** Ignora desfases menores: son ruido de la propia petición. */
const UMBRAL_MS = 1000;

/**
 * Anota la hora del servidor de una respuesta (`X-Server-Time`, en ms). `antes` y `despues` acotan la petición:
 * se toma el punto medio como el instante en que el servidor la sirvió.
 */
export function noteServerTime(cabecera: string | null, antes: number, despues: number): void {
  const servidor = Number(cabecera);
  if (cabecera === null || !Number.isFinite(servidor) || servidor <= 0) return;
  const d = servidor - (antes + despues) / 2;
  desfase = Math.abs(d) < UMBRAL_MS ? 0 : d;
}

/** Hora actual según el reloj del servidor. */
export const serverNow = (): number => Date.now() + desfase;

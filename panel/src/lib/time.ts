const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Tiempo relativo breve para la barra lateral: «ahora», «3 min», «2 h», «ayer», «2 d». */
export function formatRelative(desde: number, ahora: number): string {
  const dif = Math.max(0, ahora - desde);
  if (dif < 45_000) return 'ahora';
  if (dif < HORA) return `${Math.max(1, Math.round(dif / MIN))} min`;
  if (dif < DIA) return `${Math.floor(dif / HORA)} h`;
  const dias = Math.floor(dif / DIA);
  if (dias === 1) return 'ayer';
  if (dias < 30) return `${dias} d`;
  const meses = Math.floor(dias / 30);
  return meses < 12 ? `${meses} mes` : `${Math.floor(meses / 12)} a`;
}

/** Saludo según la hora local. */
export function greeting(fecha: Date): string {
  const h = fecha.getHours();
  if (h >= 6 && h < 13) return 'Buenos días';
  if (h >= 13 && h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

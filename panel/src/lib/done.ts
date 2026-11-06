import type { Done } from '../types.ts';

// Texto de una conversación hecha: lo que dicen el tooltip y Inicio. Puro, para probarlo sin montar nada.

export const DONE_LABEL = 'Hecha';
export const MARK_DONE_LABEL = 'Marcar como hecha';
export const REOPEN_LABEL = 'Reabrir';

/** Nota máxima que acepta el servidor, en caracteres. */
export const DONE_NOTE_MAX = 500;

/** «5 nov a las 15:20», con el año si no es el de `ahora`. `zona` solo se usa en las pruebas. */
export function doneWhen(at: string, ahora: number, zona?: string): string | null {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  const fecha = new Date(ms);
  const otroAnio = zona
    ? new Intl.DateTimeFormat('es-ES', { year: 'numeric', timeZone: zona }).format(fecha) !==
      new Intl.DateTimeFormat('es-ES', { year: 'numeric', timeZone: zona }).format(new Date(ahora))
    : fecha.getFullYear() !== new Date(ahora).getFullYear();
  const dia = fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', ...(otroAnio ? { year: 'numeric' } : {}), timeZone: zona });
  const hora = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona });
  return `${dia} a las ${hora}`;
}

/** Quién la marcó, en el texto del tooltip: «por ti» o «por el agente». */
export const doneBy = (by: Done['by']): string => (by === 'user' ? 'por ti' : 'por el agente');

/** «Hecha el 5 nov a las 15:20 · por ti». Sin fecha (marca antigua del título): «Hecha · por el agente». */
export function doneLine(done: Done, ahora: number, zona?: string): string {
  const cuando = done.at === null ? null : doneWhen(done.at, ahora, zona);
  return `${DONE_LABEL}${cuando ? ` el ${cuando}` : ''} · ${doneBy(done.by)}`;
}

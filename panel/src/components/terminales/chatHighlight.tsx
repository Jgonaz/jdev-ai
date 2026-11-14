import type { ReactNode } from 'react';
import { splitHighlight } from '../../lib/chat.ts';

/** Un texto con las coincidencias de la búsqueda dentro de `<mark>`; el mismo texto si no hay búsqueda. */
export function resalta(texto: string, consulta: string): ReactNode {
  if (consulta.trim() === '') return texto;
  const partes = splitHighlight(texto, consulta);
  if (partes.length === 1 && !partes[0]!.hit) return texto;
  return partes.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text));
}

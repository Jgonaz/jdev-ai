// Respuestas de `/btw` (preguntas al margen) de la vista chat. Claude Code no las guarda en la
// transcripción, así que viven solo aquí, en memoria y por sesión: no sobreviven a recargar el panel.
// Cada bloque recuerda en qué punto de la conversación se envió (`anchor`: elementos que había).

import { useSyncExternalStore } from 'react';
import type { ChatSendResponse } from '../../shared/chat.ts';

export type BtwState = 'waiting' | 'done' | 'pending' | 'empty';

export type BtwBlock = {
  id: string;
  question: string;
  /** Sesión de Claude (transcripción) en la que se preguntó: si cambia (/clear, otra sesión), el bloque deja de verse. */
  sessionId: string | null;
  /** Número de elementos de la conversación cuando se envió: el bloque va tras ellos. */
  anchor: number;
  state: BtwState;
  answer: string;
  /** La respuesta puede estar incompleta (solo se pudo leer lo visible de la ventana). */
  truncated: boolean;
};

const MAX_PER_SESSION = 20;
const EMPTY: readonly BtwBlock[] = [];
const bloques = new Map<string, readonly BtwBlock[]>();
const oyentes = new Set<() => void>();
let contador = 0;

const emite = () => oyentes.forEach((o) => o());

/** Añade un bloque «esperando» y devuelve su id. */
export function addBtw(sesion: string, datos: { question: string; sessionId: string | null; anchor: number }): string {
  const id = `btw${++contador}`;
  const nuevo: BtwBlock = { id, ...datos, state: 'waiting', answer: '', truncated: false };
  bloques.set(sesion, [...(bloques.get(sesion) ?? EMPTY), nuevo].slice(-MAX_PER_SESSION));
  emite();
  return id;
}

/** Cambia un bloque (no hace nada si ya no existe). */
export function updateBtw(sesion: string, id: string, parche: Partial<Pick<BtwBlock, 'state' | 'answer' | 'truncated'>>): void {
  const lista = bloques.get(sesion);
  if (!lista?.some((b) => b.id === id)) return;
  bloques.set(sesion, lista.map((b) => (b.id === id ? { ...b, ...parche } : b)));
  emite();
}

/** Quita un bloque (el envío falló: no hay nada que enseñar). */
export function removeBtw(sesion: string, id: string): void {
  const lista = bloques.get(sesion);
  if (!lista?.some((b) => b.id === id)) return;
  bloques.set(sesion, lista.filter((b) => b.id !== id));
  emite();
}

/** Olvida los bloques de una sesión (al cerrar su pestaña). */
export function forgetBtw(sesion: string): void {
  if (bloques.delete(sesion)) emite();
}

/** Cómo queda un bloque con la respuesta del servidor al envío. */
export function btwOutcome(r: ChatSendResponse): Pick<BtwBlock, 'state' | 'answer' | 'truncated'> {
  if (r.btw) return { state: 'done', answer: r.btw.answer, truncated: r.btw.truncated };
  return { state: r.pending ? 'pending' : 'empty', answer: '', truncated: false };
}

/** Los bloques de la sesión de Claude `sessionId`, agrupados por el punto de la conversación donde van (acotado a `total` elementos). */
export function groupBtwByAnchor(lista: readonly BtwBlock[], sessionId: string | null, total: number): Map<number, BtwBlock[]> {
  const grupos = new Map<number, BtwBlock[]>();
  for (const b of lista) {
    if (b.sessionId !== sessionId) continue;
    const pos = Math.min(b.anchor, total);
    const g = grupos.get(pos);
    if (g) g.push(b);
    else grupos.set(pos, [b]);
  }
  return grupos;
}

const suscribe = (f: () => void): (() => void) => {
  oyentes.add(f);
  return () => oyentes.delete(f);
};

/** Los bloques de /btw de una sesión; se actualiza solo. */
export function useBtwBlocks(sesion: string): readonly BtwBlock[] {
  return useSyncExternalStore(suscribe, () => bloques.get(sesion) ?? EMPTY);
}

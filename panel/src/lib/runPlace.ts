import type { ProjectInfo } from '../types.ts';
import { safeStorage } from './workspace.ts';

// Dónde se arrancó por última vez cada proyecto con ▶ ('' es el checkout principal),
// para proponerlo la vez siguiente en el diálogo de elección.

export const RUN_PLACE_KEY = 'jdev-panel:run-place';

/** Lugares recordados por proyecto; vacío si no hay nada o está corrupto. */
function leer(storage: Pick<Storage, 'getItem'> | null): Record<string, string> {
  try {
    const v = JSON.parse(storage?.getItem(RUN_PLACE_KEY) ?? 'null') as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

/** Lugar que se propone: el último usado si el worktree sigue abierto; si no, el checkout principal. */
export function suggestRunPlace(project: Pick<ProjectInfo, 'id' | 'worktrees'>, storage: Pick<Storage, 'getItem'> | null = safeStorage()): string {
  const ultimo = leer(storage)[project.id] ?? '';
  return project.worktrees.some((w) => w.name === ultimo) ? ultimo : '';
}

export function saveRunPlace(
  proyecto: string,
  worktree: string,
  storage: (Pick<Storage, 'getItem'> & Pick<Storage, 'setItem'>) | null = safeStorage(),
): void {
  try {
    storage?.setItem(RUN_PLACE_KEY, JSON.stringify({ ...leer(storage), [proyecto]: worktree }));
  } catch {
    // Almacenamiento bloqueado o lleno: se propondrá el checkout principal.
  }
}

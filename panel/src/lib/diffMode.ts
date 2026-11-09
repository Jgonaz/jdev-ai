import { safeStorage } from './workspace.ts';

/** Formato del diff: dos columnas (antes y después) o una sola. */
export type DiffMode = 'split' | 'unified';
export const DIFF_MODE_KEY = 'jdev-panel:diff-mode';

/** Preferencia recordada en este navegador; lado a lado si no hay ninguna válida. */
export function loadDiffMode(storage: Pick<Storage, 'getItem'> | null = safeStorage()): DiffMode {
  try {
    return storage?.getItem(DIFF_MODE_KEY) === 'unified' ? 'unified' : 'split';
  } catch {
    return 'split';
  }
}

export function saveDiffMode(modo: DiffMode, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(DIFF_MODE_KEY, modo);
  } catch {
    // Almacenamiento bloqueado o lleno: el diff funciona igual, sin recordar la elección.
  }
}

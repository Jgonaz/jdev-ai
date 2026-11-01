import type { CommitResponse } from '../api.ts';
import type { CommitFile, CommitPhase, CommitPreview } from '../types.ts';
import { safeStorage } from './workspace.ts';

// Lógica pura del diálogo «Confirmar cambios» del backlog.

const PUSH_KEY = 'jdev-panel:proyectos:push';

/** «Subir también al remoto»: marcado por defecto; se recuerda lo último elegido. */
export function loadPushPreference(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(PUSH_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function savePushPreference(push: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(PUSH_KEY, push ? 'true' : 'false');
  } catch {
    // Almacenamiento bloqueado: solo se pierde el recuerdo.
  }
}

const stateOf = (ruta: string) => /^docs\/backlog\/([^/]+)\/[^/]+$/.exec(ruta)?.[1] ?? null;

/** Qué le pasa a un archivo, para la lista del diálogo. */
export function fileChangeLabel(f: CommitFile): string {
  if (f.status === 'moved') {
    const de = stateOf(f.from ?? '');
    const a = stateOf(f.path);
    return de && a && de !== a ? `movido desde ${de} a ${a}` : `renombrado desde ${f.from ?? '?'}`;
  }
  return { modified: 'modificado', added: 'añadido', deleted: 'eliminado' }[f.status];
}

/** Aviso sobre el destino del push, o null si la rama ya tiene seguimiento. */
export function pushTargetNote(p: Pick<CommitPreview, 'upstream' | 'remote' | 'detached'>): string | null {
  if (p.detached || p.upstream) return null;
  return p.remote ? `Se creará la rama en ${p.remote}.` : 'El proyecto no tiene remoto: solo se puede hacer el commit en local.';
}

/** Texto del botón mientras se confirma, según la última fase recibida. */
export function phaseLabel(fase: CommitPhase | null): string {
  if (fase === 'push') return 'Subiendo…';
  if (fase === 'commit' || fase === null) return 'Haciendo commit…';
  return 'Terminando…';
}

export type CommitOutcome = { tone: 'ok' | 'warning' | 'error'; text: string; output: string; done: boolean };

/** Mensaje final del diálogo. `done`: el commit está hecho y el diálogo puede cerrarse. */
export function commitOutcome(r: CommitResponse): CommitOutcome {
  if (r.kind === 'ok') {
    return { tone: 'ok', text: r.pushed ? `Commit ${r.commit} hecho y subido.` : `Commit ${r.commit} hecho en local.`, output: r.output, done: true };
  }
  if (r.kind === 'push-failed') {
    return { tone: 'warning', text: `Commit ${r.commit} hecho en local; el push falló.`, output: r.output, done: true };
  }
  return { tone: 'error', text: r.error, output: r.output, done: false };
}

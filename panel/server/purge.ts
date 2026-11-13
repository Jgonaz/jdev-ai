import { lstat, rm, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isConversationId, isConversationKey } from './conversations.ts';
import { resolveTranscript } from './titles.ts';

// Borrado definitivo de una conversación archivada: su transcript de Claude
// (<slug>/<id>.jsonl), la carpeta hermana <slug>/<id>/ con los transcripts de
// sus subagentes y su estado de conversación en el panel. No se puede deshacer:
// el endpoint solo lo permite con confirmación explícita y sobre archivadas.

/**
 * Borra el transcript de la conversación `id` y su carpeta de subagentes.
 * `ruta` tiene que resolver dentro de `projectsDir` y llamarse `<id>.jsonl`;
 * si no, lanza sin borrar nada. Devuelve false si el transcript ya no existía.
 */
export async function deleteTranscript(ruta: string, id: string, projectsDir: string): Promise<boolean> {
  if (!isConversationId(id)) throw new Error('id de conversación no válido');
  const real = await resolveTranscript(ruta, projectsDir);
  if (real === null) return false;
  if (basename(real) !== `${id}.jsonl`) throw new Error('El transcript no corresponde a la conversación.');
  await unlink(real);
  const subagentes = join(dirname(real), id);
  try {
    // lstat: un enlace simbólico con ese nombre no se sigue (rm lo borraría como enlace, no su destino).
    const st = await lstat(subagentes);
    if (st.isDirectory()) await rm(subagentes, { recursive: true, force: true });
  } catch {
    // Sin carpeta de subagentes.
  }
  return true;
}

/** Borra el estado de conversación guardado por el panel (hecha/abierta), si lo hay. */
export async function deleteConversationState(dir: string, clave: string): Promise<void> {
  if (!isConversationKey(clave)) return;
  await unlink(join(dir, `${clave}.json`)).catch(() => {});
}

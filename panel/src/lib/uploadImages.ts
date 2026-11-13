import { uploadImage } from '../api.ts';
import type { UploadedImage } from '../api.ts';
import { validateUpload } from './attachments.ts';

export type UploadResult = {
  /** Imágenes subidas, en el orden en que llegaron los archivos. */
  subidas: UploadedImage[];
  /** Un motivo en castellano por cada archivo rechazado o que no se pudo subir. */
  motivos: string[];
};

/**
 * Valida y sube los archivos que la persona pega o suelta (en la terminal y en la caja del chat).
 * Los inválidos no se suben y cada fallo se cuenta aparte: una imagen mala no impide adjuntar las demás.
 * `subir` solo se cambia en los tests.
 */
export async function uploadImages(archivos: readonly File[], subir: typeof uploadImage = uploadImage): Promise<UploadResult> {
  const validos: { archivo: File; tipo: string }[] = [];
  const motivos: string[] = [];
  for (const archivo of archivos) {
    const r = validateUpload(archivo);
    if (r.ok) validos.push({ archivo, tipo: r.type });
    else motivos.push(r.reason);
  }
  const subidas: UploadedImage[] = [];
  for (const { archivo, tipo } of validos) {
    try {
      subidas.push(await subir(archivo, tipo));
    } catch (e) {
      const detalle = e instanceof Error ? e.message : 'No se pudo subir la imagen.';
      motivos.push(`«${archivo.name || 'La imagen'}»: ${detalle}`);
    }
  }
  return { subidas, motivos };
}

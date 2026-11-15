import type { AgentEvent } from '../../shared/follow.ts';
import { findImagePaths } from './imageLinks.ts';

/** Imágenes compartidas en la conversación de una sesión, por quién las compartió, en orden de aparición y sin repetir. */
export type SharedImages = { mine: readonly string[]; agent: readonly string[] };

export const EMPTY_SHARED_IMAGES: SharedImages = { mine: [], agent: [] };

/** Máximo por apartado: en conversaciones muy largas se quedan las más recientes. */
export const MAX_SHARED_IMAGES = 200;

const recorta = (lista: string[]) => (lista.length > MAX_SHARED_IMAGES ? lista.slice(-MAX_SHARED_IMAGES) : lista);

/**
 * Añade a `previas` las imágenes de `eventos`. Son tuyas las que pegas en Claude Code (evento `image`) y las rutas de
 * tus mensajes (lo que pegas o arrastras en la terminal del panel llega como ruta); del agente, las rutas de sus
 * mensajes. Las que solo lee con una herramienta no cuentan: no te las enseña. Una ruta cuenta una vez, para quien la
 * compartió primero (el agente suele citar las capturas que le pasas).
 */
export function collectSharedImages(previas: SharedImages, eventos: readonly AgentEvent[]): SharedImages {
  let mine: string[] | null = null;
  let agent: string[] | null = null;
  const vistas = new Set([...previas.mine, ...previas.agent]);
  const anade = (path: string, deLaPersona: boolean) => {
    // Un nombre suelto («logo.png») suele ser una mención, no una imagen que enseñar: se pide al menos una carpeta.
    // Con «…» es una ruta abreviada para leerla, no un archivo.
    if (!path.includes('/') || path.includes('…') || vistas.has(path)) return;
    vistas.add(path);
    if (deLaPersona) (mine ??= [...previas.mine]).push(path);
    else (agent ??= [...previas.agent]).push(path);
  };
  for (const e of eventos) {
    if (e.type === 'image') anade(e.path, true);
    else if (e.type === 'user') for (const m of findImagePaths(e.text)) anade(m.path, true);
    else if (e.type === 'message') for (const m of findImagePaths(e.text)) anade(m.path, false);
  }
  if (mine === null && agent === null) return previas;
  return { mine: mine ? recorta(mine) : previas.mine, agent: agent ? recorta(agent) : previas.agent };
}

/** Nombre del archivo de una ruta, para el pie de la miniatura y el título del modal. */
export function imageName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

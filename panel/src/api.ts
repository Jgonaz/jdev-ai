import type { ProjectInfo, RecentSession, SessionInfo, SessionRequest, Settings } from './types.ts';
import type { SettingsPatch } from './lib/settingsPatch.ts';
import { parseImageHeaders } from './lib/imageZoom.ts';
import type { ImageMeta } from './lib/imageZoom.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Mensaje de error de una respuesta no satisfactoria: el `error` del JSON del servidor, si lo hay.
async function errorMessage(res: Response): Promise<string> {
  if (res.status === 401) return 'Acceso no autorizado: abre de nuevo la URL con el token que imprime bin/panel.';
  try {
    const cuerpo = (await res.json()) as { error?: unknown };
    if (typeof cuerpo.error === 'string') return cuerpo.error;
  } catch {
    // Cuerpo no JSON: se queda el mensaje genérico.
  }
  return `Error ${res.status}`;
}

async function request<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ruta, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'No se pudo contactar con el panel.');
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}

export const api = {
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (parche: SettingsPatch) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(parche) }),
  projects: () => request<{ projects: ProjectInfo[] }>('/api/projects').then((r) => r.projects),
  sessions: () => request<{ sessions: SessionInfo[]; tmuxSocket?: string; home?: string }>('/api/sessions'),
  previewSession: (entrada: SessionRequest, signal?: AbortSignal) =>
    request<{ command: string; args: string[] }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ ...entrada, dryRun: true }),
      signal,
    }),
  createSession: (entrada: SessionRequest) =>
    request<{ session: SessionInfo; command: string }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(entrada),
    }),
  recent: () => request<{ recent: RecentSession[] }>('/api/recent').then((r) => r.recent),
  killSession: (nombre: string) =>
    request<{ deleted: boolean }>(`/api/sessions/${encodeURIComponent(nombre)}`, {
      method: 'DELETE',
      headers: { 'X-Jdev-Confirm': 'yes' },
    }),
};

/** URL de un WebSocket del propio origen (ws o wss según la página). */
export function wsUrl(ruta: string): string {
  const base = new URL(ruta, window.location.href);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  return base.toString();
}

/** URL de una imagen servida por el panel. Una ruta relativa se resuelve en el directorio de la sesión. */
export function imageUrl(path: string, session?: string | null): string {
  const params = new URLSearchParams();
  if (session) params.set('session', session);
  params.set('path', path);
  return `/api/image?${params.toString()}`;
}

/**
 * Comprueba una imagen con HEAD y devuelve sus datos (tamaño y dimensiones). HEAD
 * no lleva cuerpo, así que ante un error se repite como GET para leer el motivo
 * (403, 404, 413, 415…) que el servidor explica en castellano.
 */
export async function probeImage(path: string, session: string | null, signal?: AbortSignal): Promise<ImageMeta> {
  const url = imageUrl(path, session);
  try {
    const head = await fetch(url, { method: 'HEAD', signal });
    if (head.ok) return parseImageHeaders(head.headers);
    const res = await fetch(url, { signal });
    throw new ApiError(res.status, await errorMessage(res));
  } catch (e) {
    if (e instanceof ApiError || signal?.aborted) throw e;
    throw new ApiError(0, 'No se pudo contactar con el panel.');
  }
}

export type UploadedImage = { path: string; name: string; size: number };

/** Sube una imagen a POST /api/uploads. Un fallo de red se trata como un rechazo más. */
export async function uploadImage(archivo: Blob, tipo: string): Promise<UploadedImage> {
  let res: Response;
  try {
    res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': tipo }, body: archivo });
  } catch {
    throw new ApiError(0, 'No se pudo contactar con el panel para subir la imagen.');
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as UploadedImage;
}

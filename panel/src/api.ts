import type {
  BacklogDetail,
  BacklogList,
  BacklogState,
  CommitPreview,
  Guide,
  GuideContent,
  HistoryDetail,
  HistoryEntry,
  ProjectInfo,
  RecentSession,
  SessionInfo,
  SessionRequest,
  Settings,
  WorktreeList,
} from './types.ts';
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
  backlog: (proyecto: string, signal?: AbortSignal) => request<BacklogList>(`${projectBase(proyecto)}/backlog`, { signal }),
  backlogItem: (proyecto: string, item: string, signal?: AbortSignal) =>
    request<{ item: BacklogDetail }>(`${projectBase(proyecto)}/backlog/${encodeURIComponent(item)}`, { signal }).then((r) => r.item),
  commitPreview: (proyecto: string, signal?: AbortSignal) => request<CommitPreview>(`${projectBase(proyecto)}/backlog/commit-preview`, { signal }),
  guides: (proyecto: string, signal?: AbortSignal) =>
    request<{ guides: Guide[] }>(`${projectBase(proyecto)}/guides`, { signal }).then((r) => r.guides),
  guide: (proyecto: string, ruta: string, signal?: AbortSignal) =>
    request<GuideContent>(`${projectBase(proyecto)}/guides/content?${new URLSearchParams({ path: ruta }).toString()}`, { signal }),
  worktrees: (proyecto: string, signal?: AbortSignal) => request<WorktreeList>(`${projectBase(proyecto)}/worktrees`, { signal }),
  history: (signal?: AbortSignal) => request<{ entries: HistoryEntry[] }>('/api/history', { signal }).then((r) => r.entries),
  historyEntry: (proyecto: string, archivo: string, signal?: AbortSignal) =>
    request<{ entry: HistoryDetail }>(historyBase(proyecto, archivo), { signal }).then((r) => r.entry),
};

const historyBase = (proyecto: string, archivo: string) => `/api/history/${encodeURIComponent(proyecto)}/${encodeURIComponent(archivo)}`;

/** Resultado de marcar un pendiente: el 409 trae la versión actual de la entrada. */
export type PendingResult =
  | { ok: true; entry: HistoryDetail }
  | { ok: false; status: number; error: string; entry?: HistoryDetail };

/** POST /api/history/:project/:file/pending. No lanza: los rechazos y los fallos de red vuelven como resultado. */
export async function setHistoryPending(proyecto: string, archivo: string, index: number, done: boolean, etag: string): Promise<PendingResult> {
  let res: Response;
  try {
    res = await fetch(`${historyBase(proyecto, archivo)}/pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, done, etag }),
    });
  } catch {
    return { ok: false, status: 0, error: 'No se pudo contactar con el panel.' };
  }
  if (res.status === 401) return { ok: false, status: 401, error: await errorMessage(res) };
  try {
    const cuerpo = (await res.json()) as { error?: unknown; entry?: HistoryDetail };
    if (res.ok && cuerpo.entry) return { ok: true, entry: cuerpo.entry };
    return {
      ok: false,
      status: res.status,
      error: typeof cuerpo.error === 'string' ? cuerpo.error : `Error ${res.status}`,
      ...(cuerpo.entry ? { entry: cuerpo.entry } : {}),
    };
  } catch {
    return { ok: false, status: res.status, error: res.ok ? 'Respuesta del panel ilegible.' : `Error ${res.status}` };
  }
}

const projectBase = (proyecto: string) => `/api/projects/${encodeURIComponent(proyecto)}`;

/** Resultado de mover un elemento: el 409 trae la versión actual del elemento. */
export type MoveResult =
  | { ok: true; item: BacklogDetail }
  | { ok: false; status: number; error: string; item?: BacklogDetail };

/** POST …/backlog/:itemId/move. No lanza: los rechazos (400, 409, 422, red) vuelven como resultado. */
export async function moveBacklogItem(proyecto: string, item: string, to: BacklogState, etag: string): Promise<MoveResult> {
  let res: Response;
  try {
    res = await fetch(`${projectBase(proyecto)}/backlog/${encodeURIComponent(item)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, etag }),
    });
  } catch {
    return { ok: false, status: 0, error: 'No se pudo contactar con el panel.' };
  }
  if (res.ok) {
    try {
      return { ok: true, item: ((await res.json()) as { item: BacklogDetail }).item };
    } catch {
      return { ok: false, status: res.status, error: 'Respuesta del panel ilegible.' };
    }
  }
  if (res.status === 401) return { ok: false, status: 401, error: await errorMessage(res) };
  try {
    const cuerpo = (await res.json()) as { error?: unknown; item?: BacklogDetail };
    return {
      ok: false,
      status: res.status,
      error: typeof cuerpo.error === 'string' ? cuerpo.error : `Error ${res.status}`,
      ...(cuerpo.item ? { item: cuerpo.item } : {}),
    };
  } catch {
    return { ok: false, status: res.status, error: `Error ${res.status}` };
  }
}

/** Resultado del commit del backlog: 200 hecho, 207 commit sin push, otro estado rechazado (sin commit). */
export type CommitResponse =
  | { kind: 'ok'; commit: string; pushed: boolean; output: string }
  | { kind: 'push-failed'; commit: string; error: string; output: string }
  | { kind: 'failed'; status: number; error: string; output: string };

/** POST …/backlog/commit. No lanza: los rechazos y los fallos de red vuelven como resultado. */
export async function commitBacklog(
  proyecto: string,
  cuerpo: { message: string; push: boolean; fingerprint: string },
): Promise<CommitResponse> {
  let res: Response;
  try {
    res = await fetch(`${projectBase(proyecto)}/backlog/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    return { kind: 'failed', status: 0, error: 'No se pudo contactar con el panel; revisa el estado del repositorio antes de reintentar.', output: '' };
  }
  if (res.status === 401) return { kind: 'failed', status: 401, error: await errorMessage(res), output: '' };
  let datos: { commit?: unknown; pushed?: unknown; output?: unknown; error?: unknown } = {};
  try {
    datos = (await res.json()) as typeof datos;
  } catch {
    // Cuerpo ilegible: se trata con el estado HTTP.
  }
  const output = typeof datos.output === 'string' ? datos.output : '';
  const error = typeof datos.error === 'string' ? datos.error : `Error ${res.status}`;
  const commit = typeof datos.commit === 'string' ? datos.commit : '';
  if (res.status === 200) return { kind: 'ok', commit, pushed: datos.pushed === true, output };
  if (res.status === 207) return { kind: 'push-failed', commit, error, output };
  return { kind: 'failed', status: res.status, error, output };
}

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

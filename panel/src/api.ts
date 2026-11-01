import type { ProjectInfo, RecentSession, SessionInfo, SessionRequest, Settings } from './types.ts';
import type { SettingsPatch } from './lib/settingsPatch.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
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
  if (!res.ok) {
    let mensaje = `Error ${res.status}`;
    if (res.status === 401) mensaje = 'Acceso no autorizado: abre de nuevo la URL con el token que imprime bin/panel.';
    else {
      try {
        const cuerpo = (await res.json()) as { error?: unknown };
        if (typeof cuerpo.error === 'string') mensaje = cuerpo.error;
      } catch {
        // Cuerpo no JSON: se queda el mensaje genérico.
      }
    }
    throw new ApiError(res.status, mensaje);
  }
  return (await res.json()) as T;
}

export const api = {
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (parche: SettingsPatch) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(parche) }),
  projects: () => request<{ projects: ProjectInfo[] }>('/api/projects').then((r) => r.projects),
  sessions: () => request<{ sessions: SessionInfo[]; tmuxSocket?: string }>('/api/sessions'),
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

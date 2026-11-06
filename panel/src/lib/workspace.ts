// Estado puro del espacio de trabajo: pestañas abiertas, la activa, la
// distribución y qué pestañas se ven. Sin React, para poder probarlo.
//
// Las pestañas son nombres de sesión de tmux o, para el seguimiento de un
// subagente o una shell, claves `follow:<sesión>:<tipo>:<id>` (ver lib/follow.ts).
// Estas últimas no son sesiones: pertenecen a la sesión que las lanzó.

import { isFollowKey, ownerSession, parseFollowKey } from './follow.ts';

export type Layout = 1 | 2 | 4;

export type Workspace = {
  /** Pestañas abiertas, en orden: nombres de sesión y claves de seguimiento. */
  tabs: string[];
  active: string | null;
  layout: Layout;
  /** Índice de la primera pestaña visible. */
  start: number;
};

export const EMPTY_WORKSPACE: Workspace = { tabs: [], active: null, layout: 1, start: 0 };

export type WorkspaceAction =
  | { type: 'open'; name: string; nextToActive?: boolean; minLayout?: Layout }
  /** Abre (o activa) una pestaña de seguimiento junto a la última de la sesión que la lanzó. */
  | { type: 'openFollow'; key: string }
  | { type: 'activate'; name: string }
  | { type: 'close'; name: string }
  | { type: 'move'; delta: number }
  | { type: 'layout'; layout: Layout }
  | { type: 'cycleLayout' }
  | { type: 'prune'; alive: ReadonlySet<string> };

/** Ajusta `start` para que la pestaña activa quede dentro de la ventana visible. */
function normalize(w: Workspace): Workspace {
  const n = w.tabs.length;
  if (n === 0) return { ...w, active: null, start: 0 };
  const active = w.active !== null && w.tabs.includes(w.active) ? w.active : w.tabs[0]!;
  const idx = w.tabs.indexOf(active);
  let start = w.start;
  if (idx < start) start = idx;
  if (idx >= start + w.layout) start = idx - w.layout + 1;
  start = Math.max(0, Math.min(start, Math.max(0, n - w.layout)));
  // Si tras acotar la ventana la activa se queda fuera, prevalece la activa.
  if (idx < start) start = idx;
  return { ...w, active, start };
}

export function workspaceReducer(w: Workspace, a: WorkspaceAction): Workspace {
  switch (a.type) {
    case 'open': {
      if (w.tabs.includes(a.name)) return normalize({ ...w, active: a.name });
      const at = a.nextToActive && w.active !== null ? w.tabs.indexOf(w.active) + 1 : w.tabs.length;
      const tabs = [...w.tabs.slice(0, at), a.name, ...w.tabs.slice(at)];
      const layout = a.minLayout && a.minLayout > w.layout ? a.minLayout : w.layout;
      return normalize({ ...w, tabs, active: a.name, layout });
    }
    case 'openFollow': {
      if (w.tabs.includes(a.key)) return normalize({ ...w, active: a.key });
      const dueño = ownerSession(a.key);
      let ultima = -1;
      w.tabs.forEach((t, i) => {
        if (dueño !== null && ownerSession(t) === dueño) ultima = i;
      });
      const at = ultima >= 0 ? ultima + 1 : w.tabs.length;
      return normalize({ ...w, tabs: [...w.tabs.slice(0, at), a.key, ...w.tabs.slice(at)], active: a.key });
    }
    case 'activate':
      return w.tabs.includes(a.name) ? normalize({ ...w, active: a.name }) : w;
    case 'close': {
      const idx = w.tabs.indexOf(a.name);
      if (idx < 0) return w;
      const tabs = w.tabs.filter((t) => t !== a.name);
      const active = w.active === a.name ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : w.active;
      return normalize({ ...w, tabs, active });
    }
    case 'move': {
      if (w.tabs.length === 0) return w;
      const idx = w.active === null ? 0 : w.tabs.indexOf(w.active);
      const next = (((idx + a.delta) % w.tabs.length) + w.tabs.length) % w.tabs.length;
      return normalize({ ...w, active: w.tabs[next]! });
    }
    case 'layout':
      return normalize({ ...w, layout: a.layout });
    case 'cycleLayout': {
      const siguiente: Layout = w.layout === 1 ? 2 : w.layout === 2 ? 4 : 1;
      return normalize({ ...w, layout: siguiente });
    }
    case 'prune': {
      // Una pestaña de seguimiento vive mientras viva la sesión que la lanzó.
      const tabs = w.tabs.filter((t) => {
        const dueño = ownerSession(t);
        return dueño !== null && a.alive.has(dueño);
      });
      if (tabs.length === w.tabs.length) return w;
      const active = w.active !== null && tabs.includes(w.active) ? w.active : (tabs[0] ?? null);
      return normalize({ ...w, tabs, active });
    }
  }
}

/** Pestañas que se ven ahora (tantas como indica la distribución). */
export function visibleTabs(w: Workspace): string[] {
  return w.tabs.slice(w.start, w.start + w.layout);
}

// ---------------------------------------------------------------- Persistencia

export const STORAGE_KEY = 'jdev-panel:workspace';

/** Valida lo leído de localStorage: puede estar corrupto o venir de otra versión. */
export function parseWorkspace(crudo: string | null): Workspace | null {
  if (crudo === null) return null;
  try {
    const v = JSON.parse(crudo) as Partial<Workspace> | null;
    if (typeof v !== 'object' || v === null || !Array.isArray(v.tabs)) return null;
    const tabs = [...new Set(v.tabs.filter((t): t is string => typeof t === 'string' && (!isFollowKey(t) || parseFollowKey(t) !== null)))];
    const layout: Layout = v.layout === 2 || v.layout === 4 ? v.layout : 1;
    const active = typeof v.active === 'string' ? v.active : null;
    return normalize({ tabs, active, layout, start: typeof v.start === 'number' ? v.start : 0 });
  } catch {
    return null;
  }
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Workspace | null {
  try {
    return parseWorkspace(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveWorkspace(w: Workspace, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    // Almacenamiento bloqueado o lleno: el panel funciona igual, sin recordar.
  }
}

/** localStorage puede lanzar al acceder a él (cookies bloqueadas, modo privado). */
export function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Preferencias de interfaz que se recuerdan en este navegador. */
export type UiPrefs = { contextOpen: boolean; hideDone: boolean };
const UI_KEY = 'jdev-panel:ui';

export function loadUiPrefs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): UiPrefs {
  const defecto: UiPrefs = { contextOpen: true, hideDone: false };
  try {
    // `hideClosed` es el nombre anterior de `hideDone` («Ocultar cerradas»): se migra al leer.
    const v = JSON.parse(storage?.getItem(UI_KEY) ?? 'null') as (Partial<UiPrefs> & { hideClosed?: unknown }) | null;
    const oculta = typeof v?.hideDone === 'boolean' ? v.hideDone : typeof v?.hideClosed === 'boolean' ? v.hideClosed : defecto.hideDone;
    return {
      contextOpen: typeof v?.contextOpen === 'boolean' ? v.contextOpen : defecto.contextOpen,
      hideDone: oculta,
    };
  } catch {
    return defecto;
  }
}

export function saveUiPrefs(p: UiPrefs, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(UI_KEY, JSON.stringify(p));
  } catch {
    // Ver saveWorkspace.
  }
}

import type { RecentSession, SessionInfo } from '../types.ts';
import { safeStorage } from './workspace.ts';

/** Pestaña de sesión cerrada, con lo necesario para retomarla si la sesión ya no existe. */
export type ClosedTab = {
  name: string;
  /** `created` de la sesión: distingue una sesión nueva que reutilice el nombre. */
  created: number;
  project: string;
  worktree: string;
  agent: string;
  title: string;
  /** Id de la conversación de Claude (UUID) si lo tenía; sin él no se puede retomar. */
  conversation: string | null;
};

export const CLOSED_TABS_KEY = 'jdev-panel:closed-tabs';
/** Pestañas cerradas que se recuerdan (las más antiguas se olvidan). */
export const CLOSED_TABS_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function closedTabOf(s: SessionInfo): ClosedTab {
  return {
    name: s.name,
    created: s.created,
    project: s.project,
    worktree: s.worktree,
    agent: s.agent,
    title: s.title,
    conversation: s.agent === 'claude' && UUID.test(s.conversationKey) ? s.conversationKey : null,
  };
}

/** Apila la pestaña cerrada (la última va al final), sin duplicados y con el tope de CLOSED_TABS_MAX. */
export function pushClosed(pila: readonly ClosedTab[], t: ClosedTab): ClosedTab[] {
  return [...pila.filter((x) => x.name !== t.name), t].slice(-CLOSED_TABS_MAX);
}

/** Qué hacer con Ctrl+Mayús+T. */
export type ReopenPlan =
  | { kind: 'open'; name: string }
  | { kind: 'resume'; recent: RecentSession }
  | { kind: 'none' };

/**
 * Decide qué pestaña reabrir: la cerrada más recientemente que se pueda recuperar.
 * Si su sesión sigue viva (mismo nombre y creación), se abre; si ya no existe y era
 * una conversación de Claude, se propone retomarla. Las que ya están abiertas o no
 * se pueden recuperar (una shell o un agente sin conversación terminados) se saltan
 * y se quitan de la pila (`rest`), igual que la elegida.
 */
export function planReopen(
  pila: readonly ClosedTab[],
  sessions: readonly SessionInfo[],
  openTabs: readonly string[],
  recent: readonly RecentSession[],
  ahora: number,
): { plan: ReopenPlan; rest: ClosedTab[] } {
  const abiertas = new Set(openTabs);
  for (let i = pila.length - 1; i >= 0; i--) {
    const t = pila[i]!;
    const rest = pila.slice(0, i);
    if (abiertas.has(t.name)) continue;
    // Con el mismo nombre pero otra creación es otra sesión: la cerrada ya no existe.
    const sesion = sessions.find((s) => s.name === t.name && s.created === t.created);
    if (sesion && sesion.alive && sesion.state !== 'ended') return { plan: { kind: 'open', name: t.name }, rest };
    if (t.conversation === null) {
      // Sin conversación que retomar, una que sigue en la lista (p. ej. una shell que acabó) se abre tal cual.
      if (sesion) return { plan: { kind: 'open', name: t.name }, rest };
      continue;
    }
    const conocida = recent.find((r) => r.id === t.conversation);
    return {
      plan: {
        kind: 'resume',
        recent: conocida ?? {
          id: t.conversation,
          project: t.project,
          worktree: t.worktree,
          title: t.title,
          done: null,
          lastActivity: ahora,
          possiblyOpen: false,
          sizeBytes: 0,
          archived: false,
        },
      },
      rest,
    };
  }
  return { plan: { kind: 'none' }, rest: [] };
}

function esClosedTab(v: unknown): v is ClosedTab {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    typeof o.created === 'number' &&
    typeof o.project === 'string' &&
    typeof o.worktree === 'string' &&
    typeof o.agent === 'string' &&
    typeof o.title === 'string' &&
    (o.conversation === null || (typeof o.conversation === 'string' && UUID.test(o.conversation)))
  );
}

/** Pila recordada; vacía si no hay nada o está corrupta (se descartan las entradas ilegibles). */
export function loadClosedTabs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): ClosedTab[] {
  try {
    const v: unknown = JSON.parse(storage?.getItem(CLOSED_TABS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(esClosedTab).slice(-CLOSED_TABS_MAX) : [];
  } catch {
    return [];
  }
}

export function saveClosedTabs(pila: readonly ClosedTab[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(CLOSED_TABS_KEY, JSON.stringify(pila));
  } catch {
    // Almacenamiento bloqueado o lleno: Ctrl+Mayús+T solo recuerda lo de esta carga.
  }
}

import { describe, expect, it } from 'vitest';
import type { RecentSession, SessionInfo } from '../types.ts';
import { CLOSED_TABS_KEY, CLOSED_TABS_MAX, closedTabOf, loadClosedTabs, planReopen, pushClosed, saveClosedTabs } from './closedTabs.ts';
import type { ClosedTab } from './closedTabs.ts';

const UUID = '0b6f7c1e-3f1a-4c2b-9d1e-5a6b7c8d9e0f';

const sesion = (name: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  name,
  project: 'a',
  agent: 'claude',
  worktree: '',
  branch: 'main',
  state: 'idle',
  tracked: true,
  title: `Título ${name}`,
  done: null,
  conversationKey: UUID,
  alive: true,
  updatedAt: 1000,
  created: 1,
  notice: '',
  usage: null,
  activity: null,
  archived: false,
  run: null,
  chat: { available: false, reason: null },
  ...extra,
});

const cerrada = (name: string, extra: Partial<ClosedTab> = {}): ClosedTab => ({ ...closedTabOf(sesion(name)), ...extra });

describe('closedTabOf', () => {
  it('guarda la conversación solo si es de Claude y tiene id', () => {
    expect(closedTabOf(sesion('s')).conversation).toBe(UUID);
    expect(closedTabOf(sesion('s', { conversationKey: 'tmux-jdev-s-1' })).conversation).toBeNull();
    expect(closedTabOf(sesion('s', { agent: 'shell' })).conversation).toBeNull();
  });
});

describe('pushClosed', () => {
  it('la última cerrada va al final, sin duplicados y con tope', () => {
    expect(pushClosed([cerrada('a'), cerrada('b')], cerrada('a')).map((t) => t.name)).toEqual(['b', 'a']);
    let pila: ClosedTab[] = [];
    for (let i = 0; i < CLOSED_TABS_MAX + 5; i++) pila = pushClosed(pila, cerrada(`s${i}`));
    expect(pila).toHaveLength(CLOSED_TABS_MAX);
    expect(pila.at(-1)?.name).toBe(`s${CLOSED_TABS_MAX + 4}`);
  });
});

describe('planReopen', () => {
  it('abre la última cerrada si sigue viva en segundo plano', () => {
    const r = planReopen([cerrada('a'), cerrada('b')], [sesion('a'), sesion('b')], [], [], 0);
    expect(r.plan).toEqual({ kind: 'open', name: 'b' });
    expect(r.rest.map((t) => t.name)).toEqual(['a']);
  });

  it('salta las que ya vuelven a estar abiertas', () => {
    const r = planReopen([cerrada('a'), cerrada('b')], [sesion('a'), sesion('b')], ['b'], [], 0);
    expect(r.plan).toEqual({ kind: 'open', name: 'a' });
    expect(r.rest).toEqual([]);
  });

  it('propone retomar una de Claude terminada, con los datos de la lista de recientes si está', () => {
    const reciente: RecentSession = {
      id: UUID,
      project: 'a',
      worktree: '',
      title: 'Desde recientes',
      done: null,
      lastActivity: 50,
      possiblyOpen: true,
      sizeBytes: 10,
      archived: false,
    };
    expect(planReopen([cerrada('a')], [], [], [reciente], 99).plan).toEqual({ kind: 'resume', recent: reciente });
    const sinLista = planReopen([cerrada('a', { worktree: 'wt' })], [], [], [], 99).plan;
    expect(sinLista).toMatchObject({ kind: 'resume', recent: { id: UUID, project: 'a', worktree: 'wt', title: 'Título a', lastActivity: 99 } });
  });

  it('una sesión con el mismo nombre pero otra creación es otra: la cerrada se retoma', () => {
    expect(planReopen([cerrada('a')], [sesion('a', { created: 2 })], [], [], 0).plan.kind).toBe('resume');
  });

  it('una de Claude cuyo agente terminó se retoma aunque tmux siga', () => {
    expect(planReopen([cerrada('a')], [sesion('a', { state: 'ended' })], [], [], 0).plan.kind).toBe('resume');
  });

  it('salta las terminadas sin conversación y las quita de la pila', () => {
    const shell = cerrada('sh', { agent: 'shell', conversation: null });
    const r = planReopen([cerrada('a'), shell], [sesion('a')], [], [], 0);
    expect(r.plan).toEqual({ kind: 'open', name: 'a' });
    expect(planReopen([shell], [], [], [], 0)).toEqual({ plan: { kind: 'none' }, rest: [] });
  });

  it('sin pestañas cerradas no hace nada', () => {
    expect(planReopen([], [sesion('a')], [], [], 0).plan.kind).toBe('none');
  });
});

describe('persistencia', () => {
  it('guarda y recupera la pila, descartando entradas ilegibles', () => {
    const datos = new Map<string, string>();
    const storage = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
    saveClosedTabs([cerrada('a')], storage);
    expect(loadClosedTabs(storage)).toEqual([cerrada('a')]);
    datos.set(CLOSED_TABS_KEY, JSON.stringify([{ name: 'x' }, cerrada('b'), { ...cerrada('c'), conversation: 'no-uuid' }]));
    expect(loadClosedTabs(storage).map((t) => t.name)).toEqual(['b']);
    datos.set(CLOSED_TABS_KEY, '{roto');
    expect(loadClosedTabs(storage)).toEqual([]);
    expect(loadClosedTabs(null)).toEqual([]);
  });
});

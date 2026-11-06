import { describe, expect, it } from 'vitest';
import type { ProjectInfo, RecentSession, SessionInfo } from '../types.ts';
import { formatPercent } from './statusline.ts';
import { TIP_DELAY_MS, recentTip, sessionTip, workSummary } from './sidebarTip.ts';

const MIN = 60_000;
const AHORA = 1_800_000_000_000;

const proyecto: Pick<ProjectInfo, 'name' | 'color' | 'branch' | 'worktrees'> = {
  name: 'fitnessia',
  color: '#8ab4f8',
  branch: 'main',
  worktrees: [{ name: 'ts7', path: '/x/ts7', branch: 'feat/ts7' }],
};

const sesion = (extra: Partial<SessionInfo> = {}): SessionInfo => ({
  name: 'jdev-fitnessia-1',
  project: 'fitnessia',
  agent: 'claude',
  worktree: '',
  branch: 'main',
  state: 'idle',
  tracked: true,
  title: 'Un título largo que no cabe en la barra lateral',
  done: null,
  conversationKey: 'tmux-jdev-x-1-1',
  alive: true,
  updatedAt: AHORA - MIN,
  created: AHORA - 134 * MIN,
  notice: '',
  usage: null,
  activity: null,
  archived: false,
  ...extra,
});

const uso = (extra: Partial<NonNullable<SessionInfo['usage']>> = {}): NonNullable<SessionInfo['usage']> => ({
  model: 'Opus 5.5',
  effort: 'medium',
  context: { used: 620000, size: 1000000, percent: 62 },
  worktree: null,
  updatedAt: AHORA - MIN,
  ...extra,
});

describe('tooltip de una conversación hecha', () => {
  const hecha = { at: '2026-11-05T15:20:00Z', by: 'user', note: 'Integrada en main' } as const;

  it('dice cuándo y quién la marcó, y lleva su nota', () => {
    const v = sessionTip(sesion({ done: hecha }), proyecto, Date.parse('2026-11-06T10:00:00Z'));
    expect(v.done?.note).toBe('Integrada en main');
    expect(v.done?.line).toMatch(/^Hecha el \d+ nov a las \d\d:\d\d · por ti$/);
  });

  it('con la marca antigua no hay fecha', () => {
    expect(sessionTip(sesion({ done: { at: null, by: 'agent', note: null } }), proyecto, AHORA).done).toEqual({ line: 'Hecha · por el agente', note: null });
  });
});

describe('sessionTip', () => {
  it('sin statusline solo lleva título, proyecto, lugar y agente', () => {
    const v = sessionTip(sesion(), proyecto, AHORA);
    expect(v).toEqual({
      title: 'Un título largo que no cabe en la barra lateral',
      project: { name: 'fitnessia', color: '#8ab4f8' },
      place: 'main',
      agent: 'Claude',
      live: null,
      activity: null,
      done: null,
    });
  });

  it('el lugar de un worktree lleva su rama', () => {
    expect(sessionTip(sesion({ worktree: 'ts7', branch: 'feat/ts7' }), proyecto, AHORA).place).toBe('wt ts7 · feat/ts7');
    expect(sessionTip(sesion({ agent: 'codex', branch: null }), proyecto, AHORA)).toMatchObject({ place: 'principal', agent: 'Codex' });
    // Una terminal sin agente: título, lugar y «Terminal», sin datos de statusline.
    expect(sessionTip(sesion({ agent: 'shell', tracked: false, state: 'alive', title: 'Terminal' }), proyecto, AHORA)).toMatchObject({
      title: 'Terminal',
      place: 'main',
      agent: 'Terminal',
      live: null,
    });
  });

  it('sesión viva de Claude con el contexto al 62 % y dos subagentes: modelo, esfuerzo, barra ámbar, tiempo y trabajo', () => {
    const v = sessionTip(
      sesion({
        usage: uso(),
        activity: { subagents: [{ id: 'a', type: 'x', since: null }, { id: 'b', type: 'y', since: null }], shells: [], artifacts: [] },
      }),
      proyecto,
      AHORA,
    );
    expect(v.live).toMatchObject({
      model: 'Opus 5.5 · medium',
      elapsed: '2 h 14 min',
      stale: false,
      ago: '',
      work: '2 subagentes',
    });
    // Los mismos umbrales que la cabecera: el 62 % es aviso.
    expect(v.live!.context).toMatchObject({ percent: 62, level: 'warn', text: formatPercent(62) });
  });

  it('el nivel de la barra de contexto del tooltip usa el porcentaje redondeado que se muestra', () => {
    const nivel = (percent: number) =>
      sessionTip(sesion({ usage: uso({ context: { used: null, size: null, percent } }) }), proyecto, AHORA).live!.context!.level;
    expect([49.4, 49.6, 79.4, 79.6].map(nivel)).toEqual(['neutral', 'warn', 'warn', 'critical']);
  });

  it('con datos de hace más de 15 min y la sesión parada, marca los datos como desactualizados', () => {
    const v = sessionTip(sesion({ usage: uso({ updatedAt: AHORA - 20 * MIN }) }), proyecto, AHORA);
    expect(v.live).toMatchObject({ stale: true, ago: 'hace 20 min' });
    // Trabajando no se atenúa.
    expect(sessionTip(sesion({ state: 'working', usage: uso({ updatedAt: AHORA - 20 * MIN }) }), proyecto, AHORA).live!.stale).toBe(false);
  });

  it('una statusline sin modelo no inventa la línea de modelo', () => {
    expect(sessionTip(sesion({ usage: uso({ model: null, effort: null }) }), proyecto, AHORA).live!.model).toBeNull();
  });

  it('una sesión terminada no muestra datos de la statusline aunque queden', () => {
    expect(sessionTip(sesion({ usage: uso(), alive: false, state: 'ended' }), proyecto, AHORA).live).toBeNull();
  });
});

describe('workSummary', () => {
  it('cuenta con concordancia y se omite sin trabajo', () => {
    expect(workSummary({ subagents: 0, shells: 0, artifacts: 0 })).toBe('');
    expect(workSummary({ subagents: 1, shells: 0, artifacts: 0 })).toBe('1 subagente');
    expect(workSummary({ subagents: 2, shells: 1, artifacts: 3 })).toBe('2 subagentes · 1 shell · 3 artifacts');
  });
});

describe('recentTip', () => {
  const reciente = (extra: Partial<RecentSession> = {}): RecentSession => ({
    id: 'c1',
    project: 'fitnessia',
    worktree: '',
    title: 'Conversación anterior con un título largo',
    done: null,
    lastActivity: AHORA - 5 * MIN,
    possiblyOpen: false,
    sizeBytes: 10,
    archived: false,
    ...extra,
  });

  it('lleva título, proyecto, lugar, agente y la última actividad, sin datos de statusline', () => {
    expect(recentTip(reciente(), proyecto, AHORA)).toEqual({
      title: 'Conversación anterior con un título largo',
      project: { name: 'fitnessia', color: '#8ab4f8' },
      place: 'main',
      agent: 'Claude',
      live: null,
      activity: 'Actividad hace 5 min',
      done: null,
    });
  });

  it('una conversación hecha lleva cuándo y quién la marcó, sin nota', () => {
    const hecha = { at: '2026-11-05T15:20:00Z', by: 'agent', note: null } as const;
    const r = recentTip(reciente({ done: hecha }), proyecto, Date.parse('2026-11-06T10:00:00Z'));
    expect(r.done).toEqual({ line: expect.stringMatching(/^Hecha el \d+ nov a las \d\d:\d\d · por el agente$/), note: null });
  });

  it('en un worktree muestra su rama, si se conoce', () => {
    expect(recentTip(reciente({ worktree: 'ts7' }), proyecto, AHORA).place).toBe('wt ts7 · feat/ts7');
    expect(recentTip(reciente({ worktree: 'borrado' }), proyecto, AHORA).place).toBe('wt borrado');
  });

  it('lo más reciente dice «menos de 1 min»', () => {
    expect(recentTip(reciente({ lastActivity: AHORA - 10_000 }), proyecto, AHORA).activity).toBe('Actividad hace menos de 1 min');
  });
});

it('el tooltip del ratón espera 400 ms', () => {
  expect(TIP_DELAY_MS).toBe(400);
});

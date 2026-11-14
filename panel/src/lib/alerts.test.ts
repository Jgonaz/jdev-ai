import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../types.ts';
import { detectAlerts, documentTitle, stateMap } from './alerts.ts';

function s(name: string, state: SessionInfo['state'], parche: Partial<SessionInfo> = {}): SessionInfo {
  return {
    name,
    project: 'p',
    agent: 'claude',
    worktree: '',
    branch: null,
    state,
    tracked: true,
    title: name,
    done: null,
    conversationKey: 'tmux-jdev-x-1-1',
    alive: true,
    updatedAt: 0,
    created: 0,
    notice: '',
    usage: null,
    activity: null,
    archived: false,
    run: null,
    chat: { available: false, reason: null },
    ...parche,
  };
}

describe('detectAlerts', () => {
  it('la primera instantánea no avisa de nada', () => {
    expect(detectAlerts(null, [s('a', 'waiting')])).toEqual([]);
  });

  it('avisa al pasar a «te espera» una sola vez', () => {
    const antes = stateMap([s('a', 'working'), s('b', 'idle')]);
    expect(detectAlerts(antes, [s('a', 'waiting'), s('b', 'idle')])).toEqual([{ name: 'a', kind: 'waiting' }]);
    expect(detectAlerts(stateMap([s('a', 'waiting')]), [s('a', 'waiting')])).toEqual([]);
  });

  it('avisa de terminar (trabajando → reposo) y no de otras transiciones', () => {
    const antes = stateMap([s('a', 'working'), s('b', 'idle'), s('c', 'working')]);
    const ahora = [s('a', 'idle'), s('b', 'working'), s('c', 'idle', { done: { at: null, by: 'agent', note: null } })];
    expect(detectAlerts(antes, ahora)).toEqual([{ name: 'a', kind: 'finished' }]);
  });

  it('una sesión nueva no avisa', () => {
    expect(detectAlerts(stateMap([]), [s('nueva', 'waiting')])).toEqual([]);
  });

  it('una terminal sin agente nunca avisa, ni al terminar', () => {
    const term = (state: SessionInfo['state'], alive = true) => s('t', state, { agent: 'shell', tracked: false, alive });
    const previo = stateMap([term('alive')]);
    expect(detectAlerts(previo, [term('waiting')])).toEqual([]);
    expect(detectAlerts(previo, [term('ended', false)])).toEqual([]);
    expect(documentTitle(0, true)).toBe('Jdev-ai');
  });

  it('las sesiones sin seguimiento de turnos nunca avisan', () => {
    const antes = stateMap([s('a', 'alive', { tracked: false })]);
    expect(detectAlerts(antes, [s('a', 'alive', { tracked: false })])).toEqual([]);
  });
});

describe('documentTitle', () => {
  it('cuenta las sesiones que esperan si el contador está activado', () => {
    expect(documentTitle(2, true)).toBe('(2) Jdev-ai');
    expect(documentTitle(0, true)).toBe('Jdev-ai');
    expect(documentTitle(3, false)).toBe('Jdev-ai');
  });
});

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
    closed: false,
    alive: true,
    updatedAt: 0,
    created: 0,
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
    const ahora = [s('a', 'idle'), s('b', 'working'), s('c', 'idle', { closed: true })];
    expect(detectAlerts(antes, ahora)).toEqual([{ name: 'a', kind: 'finished' }]);
  });

  it('una sesión nueva no avisa', () => {
    expect(detectAlerts(stateMap([]), [s('nueva', 'waiting')])).toEqual([]);
  });

  it('las sesiones sin seguimiento de turnos nunca avisan', () => {
    const antes = stateMap([s('a', 'alive', { tracked: false })]);
    expect(detectAlerts(antes, [s('a', 'alive', { tracked: false })])).toEqual([]);
  });
});

describe('documentTitle', () => {
  it('cuenta las sesiones que esperan si el contador está activado', () => {
    expect(documentTitle(2, true)).toBe('(2) jdev-ai');
    expect(documentTitle(0, true)).toBe('jdev-ai');
    expect(documentTitle(3, false)).toBe('jdev-ai');
  });
});

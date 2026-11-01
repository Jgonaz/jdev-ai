import { describe, expect, it } from 'vitest';
import type { ProjectInfo, SessionInfo } from '../types.ts';
import {
  attachCommand,
  effectiveProject,
  groupSessions,
  sessionMeta,
  sessionPlace,
  stateChip,
  visualState,
  waitingCount,
  waitingLabel,
} from './sessions.ts';

function sesion(parche: Partial<SessionInfo> = {}): SessionInfo {
  return {
    name: 'jdev-balanz-io-1',
    project: 'balanz.io',
    agent: 'claude',
    worktree: '',
    branch: 'main',
    state: 'idle',
    tracked: true,
    title: 'Título',
    closed: false,
    alive: true,
    updatedAt: 0,
    created: 0,
    ...parche,
  };
}

function proyecto(id: string, parche: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    path: `/p/${id}`,
    harness: false,
    branch: 'main',
    worktrees: [],
    mono: id.slice(0, 2).toUpperCase(),
    color: '#6fb7ff',
    visible: true,
    defaultMono: id.slice(0, 2).toUpperCase(),
    defaultColor: '#6fb7ff',
    ...parche,
  };
}

describe('visualState', () => {
  it('traduce los estados de turno de Claude', () => {
    expect(visualState(sesion({ state: 'waiting' }))).toBe('waiting');
    expect(visualState(sesion({ state: 'working' }))).toBe('working');
    expect(visualState(sesion({ state: 'idle' }))).toBe('idle');
    expect(visualState(sesion({ state: 'ended', alive: false }))).toBe('ended');
  });

  it('cerrada prevalece sobre reposo, pero no sobre «te espera» ni «trabajando»', () => {
    expect(visualState(sesion({ closed: true }))).toBe('closed');
    expect(visualState(sesion({ closed: true, state: 'waiting' }))).toBe('waiting');
    expect(visualState(sesion({ closed: true, state: 'working' }))).toBe('working');
  });

  it('sin seguimiento de turnos solo hay viva o terminada', () => {
    expect(visualState(sesion({ tracked: false, state: 'alive' }))).toBe('alive');
    expect(visualState(sesion({ tracked: false, state: 'ended', alive: false }))).toBe('ended');
    // Aunque llegara un estado de turno, no se fía de él.
    expect(visualState(sesion({ tracked: false, state: 'waiting' }))).toBe('alive');
  });

  it('un proceso muerto es terminada aunque el último estado fuera reposo', () => {
    expect(visualState(sesion({ alive: false, state: 'idle' }))).toBe('ended');
  });
});

describe('groupSessions', () => {
  const proyectos = [proyecto('jdev-ai', { harness: true }), proyecto('balanz.io'), proyecto('fitnessia'), proyecto('oculto', { visible: false })];

  it('respeta el orden de proyectos, omite los vacíos y los ocultos', () => {
    const grupos = groupSessions(
      [
        sesion({ name: 'a', project: 'fitnessia' }),
        sesion({ name: 'b', project: 'jdev-ai' }),
        sesion({ name: 'c', project: 'fitnessia' }),
        sesion({ name: 'd', project: 'oculto' }),
      ],
      proyectos,
    );
    expect(grupos.map((g) => g.project.id)).toEqual(['jdev-ai', 'fitnessia']);
    expect(grupos[1]!.sessions.map((s) => s.name)).toEqual(['a', 'c']);
  });

  it('las sesiones de proyectos desconocidos van al final con un proyecto de reserva', () => {
    const grupos = groupSessions([sesion({ name: 'x', project: 'borrado' }), sesion({ name: 'y', project: 'balanz.io' })], proyectos);
    expect(grupos.map((g) => g.project.id)).toEqual(['balanz.io', 'borrado']);
    expect(grupos[1]!.project.mono).toBe('BO');
  });

  it('puede ocultar las cerradas', () => {
    const grupos = groupSessions([sesion({ name: 'a', closed: true }), sesion({ name: 'b' })], proyectos, { hideClosed: true });
    expect(grupos[0]!.sessions.map((s) => s.name)).toEqual(['b']);
  });
});

describe('textos de sesión', () => {
  it('meta y lugar', () => {
    expect(sessionMeta(sesion({ branch: 'main', agent: 'codex' }))).toBe('main · codex');
    expect(sessionMeta(sesion({ worktree: 'zona-segura-ios', branch: 'feat/zona-segura-ios' }))).toBe('wt zona-segura-ios · claude');
    expect(sessionMeta(sesion({ branch: null }))).toBe('principal · claude');
    expect(sessionPlace(sesion({ worktree: 'x', branch: 'feat/x' }))).toBe('wt feat/x');
    expect(sessionPlace(sesion({ worktree: 'x', branch: null }))).toBe('wt feat/x');
  });

  it('contador y etiqueta de «te esperan»', () => {
    const lista = [sesion({ state: 'waiting' }), sesion({ state: 'working' }), sesion({ state: 'waiting', name: 'b' })];
    expect(waitingCount(lista)).toBe(2);
    expect(waitingLabel(1)).toBe('1 sesión te espera');
    expect(waitingLabel(3)).toBe('3 sesiones te esperan');
  });

  it('chip de estado con y sin tiempo', () => {
    expect(stateChip(sesion({ state: 'working' }), '3 min')).toBe('Trabajando · 3 min');
    expect(stateChip(sesion({ state: 'waiting' }), '1 min')).toBe('Te espera · 1 min');
    expect(stateChip(sesion({ closed: true }), '2 d')).toBe('Cerrada');
    expect(stateChip(sesion({ tracked: false, state: 'alive' }), '1 h')).toBe('Viva');
  });

  it('comando para adjuntar', () => {
    expect(attachCommand('jdev-x-1', 'jdev')).toBe('tmux -L jdev attach -t jdev-x-1');
    expect(attachCommand('jdev-x-1', 'jdev-test')).toBe('tmux -L jdev-test attach -t jdev-x-1');
  });
});

describe('effectiveProject', () => {
  it('aplica overrides de Ajustes y vuelve a los valores por defecto sin ellos', () => {
    const p = proyecto('balanz.io', { mono: 'BZ', color: '#111111' });
    expect(effectiveProject(p, { mono: 'XX', color: '#222222', visible: false })).toMatchObject({ mono: 'XX', color: '#222222', visible: false });
    expect(effectiveProject(p, undefined)).toMatchObject({ mono: 'BA', color: '#6fb7ff', visible: true });
  });
});

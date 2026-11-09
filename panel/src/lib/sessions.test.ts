import { describe, expect, it } from 'vitest';
import type { ProjectInfo, SessionInfo } from '../types.ts';
import {
  attachCommand,
  effectiveProject,
  groupSessions,
  runOf,
  runSessionOf,
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
    runCommand: null,
    runSource: null,
    runDetected: null,
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

  it('hecha prevalece sobre reposo, pero no sobre «te espera» ni «trabajando»', () => {
    expect(visualState(sesion({ done: { at: null, by: 'agent', note: null } }))).toBe('done');
    expect(visualState(sesion({ done: { at: null, by: 'agent', note: null }, state: 'waiting' }))).toBe('waiting');
    expect(visualState(sesion({ done: { at: null, by: 'agent', note: null }, state: 'working' }))).toBe('working');
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

  it('una terminal sin agente es «terminal» mientras vive y «terminada» después, sin turnos ni cierre', () => {
    const term = { agent: 'shell', tracked: false, state: 'alive' as const };
    expect(visualState(sesion(term))).toBe('shell');
    expect(visualState(sesion({ ...term, state: 'waiting' }))).toBe('shell');
    expect(visualState(sesion({ ...term, done: { at: null, by: 'agent', note: null } }))).toBe('shell');
    expect(visualState(sesion({ ...term, state: 'ended', alive: false }))).toBe('ended');
    expect(visualState(sesion({ ...term, alive: false }))).toBe('ended');
  });
});

describe('terminal sin agente', () => {
  const term = sesion({ agent: 'shell', tracked: false, state: 'alive', worktree: 'f1', branch: 'feat/f1' });

  it('su chip dice «Terminal» sin tiempo y su meta no muestra el id interno', () => {
    expect(stateChip(term, '3 min')).toBe('Terminal');
    expect(stateChip(sesion({ agent: 'shell', tracked: false, state: 'ended', alive: false }), '3 min')).toBe('Terminada');
    expect(sessionMeta(term)).toBe('wt f1 · terminal');
  });

  it('no cuenta en «te espera»', () => {
    expect(waitingCount([term, sesion({ agent: 'shell', state: 'waiting' })])).toBe(0);
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

  it('puede ocultar las hechas', () => {
    const grupos = groupSessions([sesion({ name: 'a', done: { at: null, by: 'agent', note: null } }), sesion({ name: 'b' })], proyectos, { hideDone: true });
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
    expect(stateChip(sesion({ done: { at: null, by: 'agent', note: null } }), '2 d')).toBe('Hecha');
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

describe('comando de arranque', () => {
  it('el comando propio de Ajustes manda sobre el detectado y se aplica al instante', () => {
    const p = proyecto('app', { runCommand: 'pnpm dev', runSource: 'detected', runDetected: 'pnpm dev' });
    expect(effectiveProject(p, { run: 'pnpm exec nuxt dev --port 3037' })).toMatchObject({ runCommand: 'pnpm exec nuxt dev --port 3037', runSource: 'custom', runDetected: 'pnpm dev' });
    expect(effectiveProject(p, undefined)).toMatchObject({ runCommand: 'pnpm dev', runSource: 'detected' });
    expect(effectiveProject(p, { mono: 'XX' })).toMatchObject({ runCommand: 'pnpm dev', runSource: 'detected' });
    // Sin ninguno de los dos no hay comando: el botón se desactiva.
    expect(effectiveProject(proyecto('app'), undefined)).toMatchObject({ runCommand: null, runSource: null });
  });

  it('runOf ignora un comando propio vacío', () => {
    expect(runOf('', 'npm run dev')).toEqual({ runCommand: 'npm run dev', runSource: 'detected' });
    expect(runOf('  ', null)).toEqual({ runCommand: null, runSource: null });
    expect(runOf(' make dev ', null)).toEqual({ runCommand: 'make dev', runSource: 'custom' });
  });

  it('la terminal de arranque viva de un proyecto es la que lleva run y no ha terminado', () => {
    const arranque = sesion({ name: 'jdev-app-2', project: 'app', agent: 'shell', run: 'pnpm dev' });
    const lista = [sesion({ name: 'jdev-app-1', project: 'app' }), arranque, sesion({ name: 'jdev-otro-1', project: 'otro', agent: 'shell', run: 'x' })];
    expect(runSessionOf(lista, 'app')?.name).toBe('jdev-app-2');
    expect(runSessionOf(lista, 'otro')?.name).toBe('jdev-otro-1');
    expect(runSessionOf(lista, 'ninguno')).toBeUndefined();
    // Una terminal normal, o una de arranque terminada, no cuenta.
    expect(runSessionOf([sesion({ project: 'app', agent: 'shell' })], 'app')).toBeUndefined();
    expect(runSessionOf([{ ...arranque, alive: false }], 'app')).toBeUndefined();
    expect(runSessionOf([{ ...arranque, state: 'ended' }], 'app')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../types.ts';
import { LAST_SESSION_KEY, loadLastSession, saveLastSession, suggestSession } from './lastSession.ts';

const proyecto = (id: string, harness = false): ProjectInfo => ({
  id,
  name: id,
  path: `/x/${id}`,
  harness,
  branch: 'main',
  worktrees: [],
  mono: 'XX',
  color: '#000',
  visible: true,
  defaultMono: 'XX',
  defaultColor: '#000',
  runCommand: null,
  runSource: null,
  runDetected: null,
});

const memoria = (inicial: Record<string, string> = {}) => {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
  };
};

describe('lastSession', () => {
  it('guarda y recupera el último proyecto y agente', () => {
    const m = memoria();
    saveLastSession({ project: 'a', agent: 'codex' }, m);
    expect(m.getItem(LAST_SESSION_KEY)).toContain('codex');
    expect(loadLastSession(m)).toEqual({ project: 'a', agent: 'codex' });
  });

  it('sin nada guardado, con datos corruptos o con un agente desconocido devuelve null', () => {
    expect(loadLastSession(memoria())).toBeNull();
    expect(loadLastSession(memoria({ [LAST_SESSION_KEY]: '{no es json' }))).toBeNull();
    expect(loadLastSession(memoria({ [LAST_SESSION_KEY]: '{"project":"a","agent":"nada"}' }))).toBeNull();
    expect(loadLastSession(memoria({ [LAST_SESSION_KEY]: '{"project":"","agent":"claude"}' }))).toBeNull();
    expect(loadLastSession(memoria({ [LAST_SESSION_KEY]: '{"project":"a","agent":"toString"}' }))).toBeNull();
  });

  it('un almacenamiento que lanza o no existe no rompe nada', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadLastSession(roto)).toBeNull();
    expect(() => saveLastSession({ project: 'a', agent: 'claude' }, roto)).not.toThrow();
    expect(loadLastSession(null)).toBeNull();
    expect(() => saveLastSession({ project: 'a', agent: 'claude' }, null)).not.toThrow();
  });
});

describe('suggestSession', () => {
  const proyectos = [proyecto('harness', true), proyecto('a'), proyecto('b')];
  const base = { projects: proyectos, last: null, settingsAgent: 'claude' as const };

  it('propone lo último usado, por encima de la terminal activa y de los ajustes', () => {
    expect(suggestSession({ ...base, last: { project: 'b', agent: 'codex' }, activeProject: 'a' })).toEqual({ project: 'b', agent: 'codex' });
  });

  it('los valores explícitos mandan sobre lo último usado', () => {
    expect(suggestSession({ ...base, last: { project: 'b', agent: 'codex' }, explicit: { project: 'a' } })).toEqual({ project: 'a', agent: 'codex' });
    expect(suggestSession({ ...base, last: { project: 'b', agent: 'codex' }, explicit: { agent: 'opencode' } })).toEqual({ project: 'b', agent: 'opencode' });
  });

  it('sin nada guardado, el proyecto de la terminal activa y el agente de Ajustes', () => {
    expect(suggestSession({ ...base, activeProject: 'b', settingsAgent: 'shell' })).toEqual({ project: 'b', agent: 'shell' });
  });

  it('si el proyecto guardado ya no existe, se olvida todo lo guardado', () => {
    expect(suggestSession({ ...base, last: { project: 'borrado', agent: 'codex' }, activeProject: 'a' })).toEqual({ project: 'a', agent: 'claude' });
  });

  it('sin terminal activa, el primer proyecto que no sea el harness; sin proyectos, vacío', () => {
    expect(suggestSession(base).project).toBe('a');
    expect(suggestSession({ ...base, projects: [] }).project).toBe('');
  });
});

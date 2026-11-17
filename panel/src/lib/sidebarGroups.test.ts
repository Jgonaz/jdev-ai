import { describe, expect, it } from 'vitest';
import type { ProjectInfo, RecentSession, SessionInfo } from '../types.ts';
import { mergeGroups } from './sidebarGroups.ts';

const proyecto = (id: string, visible = true): ProjectInfo => ({
  id,
  name: id,
  path: `/x/${id}`,
  harness: id === 'harness',
  branch: 'main',
  worktrees: [],
  mono: 'XX',
  color: '#000',
  visible,
  defaultMono: 'XX',
  defaultColor: '#000',
  runCommand: null,
  runSource: null,
  runDetected: null,
});

const sesion = (name: string, project: string) => ({ name, project }) as unknown as SessionInfo;
const reciente = (id: string, project: string, done: string | null) => ({ id, project, done }) as unknown as RecentSession;

describe('mergeGroups', () => {
  const proyectos = [proyecto('harness'), proyecto('a'), proyecto('b'), proyecto('oculto', false), proyecto('nuevo')];

  it('lista todos los proyectos visibles en su orden, también los que no tienen sesiones', () => {
    const grupos = mergeGroups([], [], proyectos);
    expect(grupos.map((g) => g.project.id)).toEqual(['harness', 'a', 'b', 'nuevo']);
    expect(grupos.every((g) => g.sessions.length === 0 && g.pending.length === 0 && g.done.length === 0)).toBe(true);
  });

  it('reparte sesiones y recientes en su proyecto sin alterar el orden fijo', () => {
    const b = proyectos[2]!;
    const a = proyectos[1]!;
    const grupos = mergeGroups(
      [{ project: b, sessions: [sesion('s1', 'b')] }],
      [{ project: a, items: [reciente('r1', 'a', null), reciente('r2', 'a', '2026-11-17')] }],
      proyectos,
    );
    expect(grupos.map((g) => g.project.id)).toEqual(['harness', 'a', 'b', 'nuevo']);
    expect(grupos[2]!.sessions.map((s) => s.name)).toEqual(['s1']);
    expect(grupos[1]!.pending.map((r) => r.id)).toEqual(['r1']);
    expect(grupos[1]!.done.map((r) => r.id)).toEqual(['r2']);
  });

  it('las sesiones de proyectos desconocidos van al final como grupo aparte', () => {
    const desconocido = proyecto('borrado');
    const grupos = mergeGroups([{ project: desconocido, sessions: [sesion('s9', 'borrado')] }], [], proyectos);
    expect(grupos.map((g) => g.project.id)).toEqual(['harness', 'a', 'b', 'nuevo', 'borrado']);
  });
});

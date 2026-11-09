import { describe, expect, it } from 'vitest';
import type { ProjectInfo, RecentSession } from '../types.ts';
import {
  POSSIBLY_OPEN_MS,
  RECENT_COLLAPSED,
  activityAgo,
  agoLabel,
  groupRecent,
  isPossiblyOpen,
  openElsewhereNotice,
  recentPlace,
  resumeRequest,
  sessionNamesKey,
  visibleRecent,
} from './recent.ts';

const AHORA = 1_800_000_000_000;
const MIN = 60_000;

const proyecto = (id: string, visible = true): ProjectInfo => ({
  id,
  name: id,
  path: `/x/${id}`,
  harness: false,
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

const reciente = (id: string, project: string, extra: Partial<RecentSession> = {}): RecentSession => ({
  id,
  project,
  worktree: '',
  title: `Sesión ${id}`,
  done: null,
  lastActivity: AHORA - 60 * MIN,
  possiblyOpen: false,
  sizeBytes: 100,
  archived: false,
  ...extra,
});

describe('groupRecent', () => {
  const proyectos = [proyecto('a'), proyecto('b'), proyecto('oculto', false), proyecto('vacio')];
  const lista = [
    reciente('1', 'b'),
    reciente('2', 'a'),
    reciente('3', 'a', { done: { at: null, by: 'agent', note: null } }),
    reciente('4', 'oculto'),
    reciente('5', 'desconocido'),
  ];

  it('agrupa por proyecto en el orden de la lista, sin proyectos ocultos, desconocidos ni vacíos', () => {
    const g = groupRecent(lista, proyectos);
    expect(g.map((x) => [x.project.id, x.items.map((r) => r.id)])).toEqual([
      ['a', ['2', '3']],
      ['b', ['1']],
    ]);
  });

  it('con «Ocultar hechas» omite las conversaciones hechas y los grupos que se quedan vacíos', () => {
    const g = groupRecent([...lista, reciente('6', 'vacio', { done: { at: null, by: 'agent', note: null } })], proyectos, { hideDone: true });
    expect(g.map((x) => [x.project.id, x.items.map((r) => r.id)])).toEqual([
      ['a', ['2']],
      ['b', ['1']],
    ]);
  });
});

describe('visibleRecent', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  it('muestra 3 y cuenta las ocultas; desplegado, todas', () => {
    expect(visibleRecent(items, false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 2 });
    expect(visibleRecent(items, true)).toEqual({ shown: items, hidden: 0 });
    expect(RECENT_COLLAPSED).toBe(3);
  });
  it('con 3 o menos no oculta nada', () => {
    expect(visibleRecent(['a', 'b', 'c'], false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 0 });
    expect(visibleRecent([], false)).toEqual({ shown: [], hidden: 0 });
  });
});

describe('actividad reciente', () => {
  it('considera posiblemente abierta la sesión con actividad en los últimos 3 minutos', () => {
    expect(isPossiblyOpen({ lastActivity: AHORA - POSSIBLY_OPEN_MS + 1 }, AHORA)).toBe(true);
    expect(isPossiblyOpen({ lastActivity: AHORA - POSSIBLY_OPEN_MS }, AHORA)).toBe(false);
  });

  it('redacta «Actividad hace X min» y el aviso solo si puede seguir abierta', () => {
    expect(activityAgo({ lastActivity: AHORA - 2 * MIN - 5000 }, AHORA)).toBe('Actividad hace 2 min');
    expect(agoLabel(AHORA - 10_000, AHORA)).toBe('ahora');
    expect(agoLabel(AHORA - 3 * 60 * MIN, AHORA)).toBe('hace 3 h');
    expect(agoLabel(AHORA - 30 * 60 * MIN, AHORA)).toBe('ayer');
    expect(activityAgo({ lastActivity: AHORA - 10_000 }, AHORA)).toBe('Actividad hace menos de 1 min');
    expect(activityAgo({ lastActivity: AHORA + 5000 }, AHORA)).toBe('Actividad hace menos de 1 min');
    expect(openElsewhereNotice({ lastActivity: AHORA - 2 * MIN }, AHORA)).toBe(
      'Actividad hace 2 min: puede seguir abierta en otra ventana.',
    );
    expect(openElsewhereNotice({ lastActivity: AHORA - 30 * MIN }, AHORA)).toBeNull();
  });
});

describe('resumeRequest y recentPlace', () => {
  it('retoma en el checkout principal o, si es de un worktree, en ese worktree existente', () => {
    expect(resumeRequest({ id: 'x', project: 'a', worktree: '' })).toEqual({ project: 'a', agent: 'claude', location: 'main', resume: 'x' });
    expect(resumeRequest({ id: 'y', project: 'a', worktree: 'feat' })).toEqual({
      project: 'a',
      agent: 'claude',
      location: 'existing-worktree',
      feature: 'feat',
      resume: 'y',
    });
  });

  it('indica dónde trabajó la sesión', () => {
    expect(recentPlace({ worktree: '' })).toBe('principal');
    expect(recentPlace({ worktree: 'feat' })).toBe('wt feat');
  });
});

describe('sessionNamesKey', () => {
  it('solo depende de qué sesiones hay, no del orden ni de su estado', () => {
    expect(sessionNamesKey([{ name: 'b' }, { name: 'a' }])).toBe(sessionNamesKey([{ name: 'a' }, { name: 'b' }]));
    expect(sessionNamesKey([{ name: 'a' }])).not.toBe(sessionNamesKey([{ name: 'a' }, { name: 'b' }]));
    expect(sessionNamesKey([])).toBe('');
  });
});

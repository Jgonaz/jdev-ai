import { describe, expect, it } from 'vitest';
import type { ProjectInfo, RecentSession, SessionInfo } from '../types.ts';
import {
  ARCHIVED_COLLAPSED_KEY,
  applyArchive,
  archivedEntries,
  archivedHeading,
  archivedKey,
  loadArchivedCollapsed,
  notArchived,
  saveArchivedCollapsed,
} from './archive.ts';

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

const sesion = (name: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  name,
  project: 'a',
  agent: 'claude',
  worktree: '',
  branch: 'main',
  state: 'idle',
  tracked: true,
  title: name,
  done: null,
  conversationKey: 'tmux-jdev-x-1-1',
  alive: true,
  updatedAt: 1000,
  created: 5,
  notice: '',
  usage: null,
  activity: null,
  archived: true,
  run: null,
  ...extra,
});

const reciente = (id: string, extra: Partial<RecentSession> = {}): RecentSession => ({
  id,
  project: 'a',
  worktree: '',
  title: `Conversación ${id}`,
  done: null,
  lastActivity: 1000,
  possiblyOpen: false,
  sizeBytes: 10,
  archived: true,
  ...extra,
});

const proyectos = [proyecto('a'), proyecto('oculto', false)];
const claves = (l: ReturnType<typeof archivedEntries>) => l.map(archivedKey);

describe('archivedEntries', () => {
  it('solo lista lo archivado, con las sesiones primero y las conversaciones más recientes antes', () => {
    const l = archivedEntries(
      [sesion('s-reposo'), sesion('s-normal', { archived: false }), sesion('s-espera', { state: 'waiting' }), sesion('s-trabaja', { state: 'working' })],
      [reciente('c-vieja', { lastActivity: 10 }), reciente('c-nueva', { lastActivity: 20 }), reciente('c-normal', { archived: false })],
      proyectos,
    );
    expect(claves(l)).toEqual(['s:s-espera', 's:s-trabaja', 's:s-reposo', 'c:c-nueva', 'c:c-vieja']);
    expect(l.filter((e) => e.kind === 'session').map((e) => e.state)).toEqual(['waiting', 'working', 'idle']);
  });

  it('incluye las sesiones terminadas, que se pueden archivar', () => {
    const l = archivedEntries([sesion('fin', { alive: false, state: 'ended' })], [], proyectos);
    expect(claves(l)).toEqual(['s:fin']);
    expect(l[0]!.kind === 'session' && l[0]!.state).toBe('ended');
  });

  it('los proyectos ocultos solo aportan las sesiones que esperan, marcadas; sus conversaciones no se ofrecen', () => {
    const l = archivedEntries(
      [sesion('o-reposo', { project: 'oculto' }), sesion('o-espera', { project: 'oculto', state: 'waiting' })],
      [reciente('c-oculta', { project: 'oculto' })],
      proyectos,
    );
    expect(claves(l)).toEqual(['s:o-espera']);
    expect(l[0]!.kind === 'session' && l[0]!.hiddenProject).toBe(true);
  });

  it('una sesión de un proyecto desconocido usa uno genérico; una conversación suya se omite', () => {
    const l = archivedEntries([sesion('x', { project: 'nuevo' })], [reciente('c', { project: 'nuevo' })], proyectos);
    expect(claves(l)).toEqual(['s:x']);
    expect(l[0]!.project.id).toBe('nuevo');
  });

  it('con hideDone omite lo hecho, salvo la sesión hecha que espera', () => {
    const sesiones = [sesion('c', { done: { at: null, by: 'agent', note: null } }), sesion('cw', { done: { at: null, by: 'agent', note: null }, state: 'waiting' })];
    const recientes = [reciente('rc', { done: { at: null, by: 'agent', note: null } }), reciente('rn')];
    expect(claves(archivedEntries(sesiones, recientes, proyectos, { hideDone: true }))).toEqual(['s:cw', 'c:rn']);
    expect(claves(archivedEntries(sesiones, recientes, proyectos))).toHaveLength(4);
  });

  it('sin nada archivado devuelve una lista vacía y no muta la entrada', () => {
    const entrada = [sesion('b', { archived: false }), sesion('a')];
    expect(archivedEntries([sesion('n', { archived: false })], [reciente('r', { archived: false })], proyectos)).toEqual([]);
    archivedEntries(entrada, [], proyectos);
    expect(entrada.map((s) => s.name)).toEqual(['b', 'a']);
  });
});

describe('notArchived', () => {
  it('deja lo que no está archivado', () => {
    expect(notArchived([sesion('a'), sesion('b', { archived: false })]).map((s) => s.name)).toEqual(['b']);
  });
});

describe('applyArchive', () => {
  it('marca las sesiones por nombre y creación, y las conversaciones por id', () => {
    const lista = { sessions: [{ name: 'jdev-a-1', created: 5 }], conversations: ['c1'] };
    const s = applyArchive([sesion('jdev-a-1', { archived: false }), sesion('jdev-a-2', { archived: false })], lista);
    expect(s.map((x) => x.archived)).toEqual([true, false]);
    const r = applyArchive([reciente('c1', { archived: false }), reciente('c2', { archived: true })], lista);
    expect(r.map((x) => x.archived)).toEqual([true, false]);
  });

  it('el nombre de tmux reutilizado (otra creación) no cuenta como archivado', () => {
    const lista = { sessions: [{ name: 'jdev-a-1', created: 5 }], conversations: [] };
    expect(applyArchive([sesion('jdev-a-1', { created: 99, archived: true })], lista)[0]!.archived).toBe(false);
  });

  it('devuelve la misma lista si nada cambia', () => {
    const entrada = [sesion('x', { archived: false })];
    expect(applyArchive(entrada, { sessions: [], conversations: [] })).toBe(entrada);
  });
});

describe('textos y plegado', () => {
  const memoria = () => {
    const d = new Map<string, string>();
    return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) };
  };

  it('el encabezado lleva el recuento', () => {
    expect(archivedHeading(3)).toBe('Archivadas (3)');
  });

  it('por defecto está desplegada y recuerda el plegado con su propia clave', () => {
    const s = memoria();
    expect(loadArchivedCollapsed(s)).toBe(false);
    saveArchivedCollapsed(true, s);
    expect(s.getItem(ARCHIVED_COLLAPSED_KEY)).toBe('1');
    expect(ARCHIVED_COLLAPSED_KEY).toBe('jdev-panel:archived-collapsed');
    expect(loadArchivedCollapsed(s)).toBe(true);
    saveArchivedCollapsed(false, s);
    expect(loadArchivedCollapsed(s)).toBe(false);
  });

  it('tolera un almacenamiento que lanza o inexistente', () => {
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadArchivedCollapsed(roto)).toBe(false);
    expect(() => saveArchivedCollapsed(true, roto)).not.toThrow();
    expect(loadArchivedCollapsed(null)).toBe(false);
    expect(() => saveArchivedCollapsed(true, null)).not.toThrow();
  });
});

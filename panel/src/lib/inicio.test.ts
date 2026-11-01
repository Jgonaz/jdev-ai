import { describe, expect, it } from 'vitest';
import type { OverviewProject, ProjectInfo, SessionInfo } from '../types.ts';
import {
  activityWhen,
  attentionItems,
  displayName,
  inicioTitle,
  lastEntryText,
  pendingSource,
  pendingText,
  preferredSession,
  projectCards,
  relativeText,
  restingChip,
  shiftLine,
  stateCounts,
  summaryLine,
  waitingChip,
} from './inicio.ts';
import { waitingCount } from './sessions.ts';

function sesion(name: string, parche: Partial<SessionInfo> = {}): SessionInfo {
  return {
    name,
    project: 'a',
    agent: 'claude',
    worktree: '',
    branch: 'main',
    state: 'idle',
    tracked: true,
    title: name,
    closed: false,
    alive: true,
    updatedAt: 0,
    created: 0,
    notice: '',
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

const resumen = (id: string, lastActivity: number): OverviewProject => ({
  id,
  branch: 'main',
  backlog: { backlog: 1, todo: 2, inProgress: 3 },
  worktrees: 0,
  lastActivity,
  lastEntry: null,
});

describe('saludo y franja horaria', () => {
  it.each([
    [6, 'Buenos días', 'mañana'],
    [13, 'Buenos días', 'mañana'],
    [14, 'Buenas tardes', 'tarde'],
    [20, 'Buenas tardes', 'tarde'],
    [21, 'Buenas noches', 'noche'],
    [0, 'Buenas noches', 'noche'],
    [5, 'Buenas noches', 'noche'],
  ])('a las %i h', (hora, saludo, turno) => {
    const fecha = new Date(2026, 10, 1, hora, 30);
    expect(inicioTitle(fecha, 'Jorge', true)).toBe(`${saludo}, Jorge`);
    expect(shiftLine(fecha)).toBe(`$ turno de ${turno} · dom 01 nov`);
  });

  it('sin nombre saluda solo y con el saludo desactivado titula «Inicio»', () => {
    const fecha = new Date(2026, 10, 1, 9);
    expect(inicioTitle(fecha, null, true)).toBe('Buenos días');
    expect(inicioTitle(fecha, 'Jorge', false)).toBe('Inicio');
  });

  it('el nombre de Ajustes manda sobre el de Git', () => {
    expect(displayName('  Ana ', 'Jorge')).toBe('Ana');
    expect(displayName('  ', 'Jorge')).toBe('Jorge');
    expect(displayName('', null)).toBeNull();
  });
});

describe('textos del resumen', () => {
  it('singular y plural', () => {
    expect(summaryLine(5, 8, 2)).toBe('5 proyectos en el taller · 8 sesiones · 2 worktrees abiertos');
    expect(summaryLine(1, 1, 1)).toBe('1 proyecto en el taller · 1 sesión · 1 worktree abierto');
    expect(summaryLine(0, 0, 0)).toBe('0 proyectos en el taller · 0 sesiones · 0 worktrees abiertos');
    expect(waitingChip(1)).toBe('1 te espera');
    expect(waitingChip(2)).toBe('2 te esperan');
    expect(restingChip(3)).toBe('3 en reposo');
    expect(pendingText(1)).toBe('1 pendiente de ti');
    expect(pendingText(3)).toBe('3 pendientes de ti');
    expect(pendingSource(1)).toBe('En la última entrada del historial de un proyecto.');
    expect(pendingSource(2)).toBe('En la última entrada del historial de cada proyecto (2 proyectos).');
  });

  it('tiempo relativo', () => {
    const ahora = 10 * 86_400_000;
    expect(relativeText(ahora - 10_000, ahora)).toBe('ahora');
    expect(relativeText(ahora - 3 * 60_000, ahora)).toBe('hace 3 min');
    expect(relativeText(ahora - 26 * 3_600_000, ahora)).toBe('ayer');
  });

  it('fecha de la actividad reciente', () => {
    const ahora = new Date(2026, 10, 1, 12);
    expect(activityWhen('2026-11-01 10:02', ahora)).toBe('hoy 10:02');
    expect(activityWhen('2026-11-01', ahora)).toBe('hoy');
    expect(activityWhen('2026-10-31 18:00', ahora)).toBe('31 oct');
    expect(activityWhen('2025-12-05', ahora)).toBe('5 dic 2025');
    expect(activityWhen('raro', ahora)).toBe('raro');
  });

  it('último registro', () => {
    expect(lastEntryText({ title: 'Swipe', state: 'en curso' })).toBe('Swipe · en curso');
    expect(lastEntryText({ title: 'Swipe', state: 'desconocido' })).toBe('Swipe');
  });
});

describe('recuentos de estado', () => {
  it('cuenta las que esperan, trabajan y reposan (cerradas incluidas)', () => {
    const c = stateCounts([
      sesion('w', { state: 'waiting' }),
      sesion('k1', { state: 'working' }),
      sesion('k2', { state: 'working', closed: true }),
      sesion('i', { state: 'idle' }),
      sesion('c', { state: 'idle', closed: true }),
      sesion('v', { tracked: false, state: 'alive' }),
      sesion('e', { state: 'ended', alive: false }),
    ]);
    expect(c).toEqual({ waiting: 1, working: 2, resting: 2 });
  });

  it('una cerrada cuyo proceso terminó no está en reposo', () => {
    const c = stateCounts([
      sesion('c-viva', { state: 'idle', closed: true }),
      sesion('c-muerta', { state: 'idle', closed: true, alive: false }),
      sesion('c-terminada', { state: 'ended', closed: true }),
    ]);
    expect(c).toEqual({ waiting: 0, working: 0, resting: 1 });
  });

  it('las que esperan cuentan también en proyectos ocultos, igual que la cabecera', () => {
    const lista = [
      sesion('w', { state: 'waiting' }),
      sesion('w-oculta', { state: 'waiting', project: 'oculto' }),
      sesion('k-oculta', { state: 'working', project: 'oculto' }),
      sesion('i-oculta', { state: 'idle', project: 'oculto' }),
      sesion('k', { state: 'working' }),
    ];
    const c = stateCounts(lista, new Set(['a']));
    expect(c).toEqual({ waiting: 2, working: 1, resting: 0 });
    expect(c.waiting).toBe(waitingCount(lista));
  });
});

describe('necesita tu atención', () => {
  const visibles = new Set(['a', 'b']);

  it('ordena: esperan (la más antigua primero), cerradas abiertas y pendientes', () => {
    const items = attentionItems(
      [
        sesion('w2', { state: 'waiting', updatedAt: 20 }),
        sesion('c1', { state: 'idle', closed: true, updatedAt: 5 }),
        sesion('w1', { state: 'waiting', updatedAt: 10, project: 'b' }),
        sesion('oculta', { state: 'waiting', project: 'x' }),
        sesion('muerta', { closed: true, alive: false }),
        sesion('i', { state: 'idle' }),
      ],
      visibles,
      { openPending: 3, entriesWithPending: 2 },
    );
    expect(items.map((i) => (i.kind === 'pending' ? `pending:${i.openPending}/${i.entries}` : `${i.kind}:${i.session.name}`))).toEqual([
      'waiting:oculta',
      'waiting:w1',
      'waiting:w2',
      'closed:c1',
      'pending:3/2',
    ]);
  });

  it('una sesión que espera en un proyecto oculto aparece con la marca; sus cerradas no', () => {
    const items = attentionItems(
      [
        sesion('w', { state: 'waiting', updatedAt: 2 }),
        sesion('w-oculta', { state: 'waiting', project: 'x', updatedAt: 1 }),
        sesion('c-oculta', { state: 'idle', closed: true, project: 'x' }),
      ],
      visibles,
      null,
      new Set(['x']),
    );
    expect(items.map((i) => (i.kind === 'waiting' ? `${i.session.name}:${i.hidden}` : i.kind))).toEqual(['w-oculta:true', 'w:false']);
  });

  it('sin nada que atender devuelve una lista vacía', () => {
    expect(attentionItems([sesion('i')], visibles, { openPending: 0, entriesWithPending: 0 })).toEqual([]);
    expect(attentionItems([], visibles, null)).toEqual([]);
  });
});

describe('tarjetas de proyecto', () => {
  it('ordena por actividad con las sesiones en vivo y omite ocultos y sin resumen', () => {
    const tarjetas = projectCards(
      [proyecto('a'), proyecto('b'), proyecto('c'), proyecto('oculto', { visible: false }), proyecto('nuevo')],
      [resumen('a', 100), resumen('b', 300), resumen('c', 100), resumen('oculto', 999)],
      [sesion('s1', { project: 'a', updatedAt: 500 }), sesion('s2', { project: 'c', updatedAt: 50 })],
    );
    expect(tarjetas.map((t) => [t.project.id, t.lastActivity])).toEqual([
      ['a', 500],
      ['b', 300],
      ['c', 100],
    ]);
    expect(tarjetas[0]!.sessions.map((s) => s.name)).toEqual(['s1']);
    expect(tarjetas[0]!.overview.backlog).toEqual({ backlog: 1, todo: 2, inProgress: 3 });
  });

  it('la sesión preferida al abrir las terminales', () => {
    expect(
      preferredSession([sesion('i', { updatedAt: 9 }), sesion('k', { state: 'working' }), sesion('w', { state: 'waiting' })])?.name,
    ).toBe('w');
    expect(preferredSession([sesion('i1', { updatedAt: 1 }), sesion('i2', { updatedAt: 2 })])?.name).toBe('i2');
    expect(preferredSession([])).toBeNull();
  });
});

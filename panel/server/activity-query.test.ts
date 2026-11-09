import { describe, expect, it } from 'vitest';
import { addDays, buildActivity, familyOf, mondayOf, periodOf, projectOf, unionSeconds } from './activity-query.ts';
import type { QueryInput, QueryProject } from './activity-query.ts';
import type { DayAgg, FileEntry } from './activity-index.ts';

const dia = (p: Partial<DayAgg> = {}): DayAgg => ({ r: 0, i: 0, o: 0, cr: 0, cw: 0, m: {}, p: {}, t: {}, a: {}, ...p });
const archivo = (agent: 'claude' | 'codex', days: Record<string, DayAgg>, extra: Partial<FileEntry> = {}): FileEntry => ({
  agent,
  sub: false,
  ino: 1,
  size: 1,
  mtimeMs: 0,
  offset: 1,
  lastTs: 0,
  cwd: '',
  model: '',
  lastTotal: -1,
  metaSeen: true,
  act: [],
  days,
  ids: {},
  ...extra,
});

const proyectos: QueryProject[] = [
  { id: 'jdev-ai', name: 'jdev-ai', path: '/h/jdev-ai', mono: 'JA', color: '#c79bff' },
  { id: 'alfa', name: 'alfa', path: '/h/jdev-ai/projects/alfa', mono: 'AL', color: '#6fb7ff' },
  { id: 'beta', name: 'beta', path: '/h/jdev-ai/projects/beta', mono: 'BE', color: '#ff8a6b' },
];

// Sábado 7 de noviembre de 2026, a mediodía (semana del lunes 2).
const AHORA = new Date(2026, 10, 7, 12, 0, 0);

const consulta = (files: FileEntry[], extra: Partial<QueryInput> = {}) =>
  buildActivity({ files, projects: proyectos, range: 'week', agent: 'all', now: AHORA, indexing: false, progress: null, updatedAt: 1, ...extra });

describe('fechas y periodos', () => {
  it('addDays y mondayOf trabajan con fechas locales y cruzan meses y años', () => {
    expect(addDays('2026-11-07', 1)).toBe('2026-11-08');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(mondayOf('2026-11-07')).toBe('2026-11-02');
    expect(mondayOf('2026-11-02')).toBe('2026-11-02');
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2027-01-01')).toBe('2026-12-28');
  });

  it('semana natural frente a la anterior hasta el mismo día; 30 días frente a los 30 previos; todo sin comparación', () => {
    expect(periodOf('week', '2026-11-04', null)).toEqual({ from: '2026-11-02', to: '2026-11-04', days: 7, previous: { from: '2026-10-26', to: '2026-10-28' } });
    expect(periodOf('30d', '2026-11-07', null)).toEqual({ from: '2026-10-09', to: '2026-11-07', days: 30, previous: { from: '2026-09-09', to: '2026-10-08' } });
    expect(periodOf('all', '2026-11-07', '2026-11-01')).toMatchObject({ days: 7, previous: null });
  });

  it('unionSeconds junta los solapes entre sesiones y recorta al periodo', () => {
    expect(unionSeconds([[0, 100, 200, 300], [50, 150]], 0, 1000)).toBe(250);
    expect(unionSeconds([[0, 100]], 40, 60)).toBe(20);
    expect(unionSeconds([[], []], 0, 10)).toBe(0);
  });
});

describe('projectOf y familyOf', () => {
  it('elige el proyecto de ruta más larga, incluidos sus worktrees (aunque ya no existan)', () => {
    expect(projectOf('/h/jdev-ai/projects/alfa', proyectos)?.id).toBe('alfa');
    expect(projectOf('/h/jdev-ai/projects/alfa/docs/x', proyectos)?.id).toBe('alfa');
    expect(projectOf('/h/jdev-ai/projects/alfa.worktrees/rama', proyectos)?.id).toBe('alfa');
    expect(projectOf('/h/jdev-ai/rules', proyectos)?.id).toBe('jdev-ai');
    // «alfa-otro» no es «alfa».
    expect(projectOf('/h/jdev-ai/projects/alfa-otro', proyectos)?.id).toBe('jdev-ai');
    expect(projectOf('/tmp/ajeno', proyectos)).toBeNull();
    expect(projectOf('', proyectos)).toBeNull();
  });

  it('familia de modelo', () => {
    expect(familyOf('claude', 'claude-opus-5-5')).toBe('opus');
    expect(familyOf('claude', 'claude-haiku-4-5-20251001')).toBe('haiku');
    expect(familyOf('claude', 'sonnet')).toBe('sonnet');
    expect(familyOf('claude', 'otro-modelo')).toBe('other');
    expect(familyOf('codex', 'gpt-6-luna')).toBe('codex');
  });
});

describe('buildActivity', () => {
  const claude = archivo(
    'claude',
    {
      // Semana en curso (lunes 2 a sábado 7).
      '2026-11-02': dia({ r: 10, o: 1000, i: 5, cr: 100, cw: 10, m: { 'claude-opus-5-5': 8, 'claude-sonnet-5-5': 2 }, p: { '/h/jdev-ai/projects/alfa': [10, 1000] }, t: { Bash: 4 }, a: { implementer: 1 } }),
      '2026-11-03': dia({ r: 20, o: 3000, m: { 'claude-opus-5-5': 20 }, p: { '/h/jdev-ai/projects/alfa.worktrees/x': [15, 2000], '/ajeno': [5, 1000] }, t: { Bash: 6, Read: 2 } }),
      // Semana anterior (26 oct a 1 nov).
      '2026-10-27': dia({ r: 5, o: 500, m: { 'claude-opus-5-5': 5 }, p: { '/h/jdev-ai/projects/beta': [5, 500] } }),
      '2026-10-30': dia({ r: 5, o: 500, m: { 'claude-opus-4-7': 5 } }),
      // Más atrás (fuera de 30 días).
      '2026-08-01': dia({ r: 100, o: 9000, m: { 'claude-opus-5-5': 100 } }),
    },
    { act: [1000, 1600, 5000, 5100] },
  );
  const sub = archivo('claude', { '2026-11-03': dia({ r: 4, o: 400, m: { 'claude-haiku-5-5': 4 } }) }, { sub: true });
  const codex = archivo('codex', { '2026-11-03': dia({ r: 6, o: 600, i: 50, m: { 'gpt-6-luna': 6 }, p: { '/h/jdev-ai/projects/beta': [6, 600] }, t: { exec: 9 } }) });
  const todos = [claude, sub, codex];

  it('cifras de la semana frente a la anterior, y sesiones sin contar subagentes', () => {
    const r = consulta(todos);
    expect(r.totals).toMatchObject({ responses: 40, output: 5000, input: 55, sessions: 2, activeDays: 2 });
    expect(r.previous).toMatchObject({ responses: 10, output: 1000, sessions: 1 });
    expect(r.sessionsByAgent).toEqual({ claude: 1, codex: 1 });
    expect(r.period).toEqual({ from: '2026-11-02', to: '2026-11-07', days: 7 });
  });

  it('el filtro de agente limita todo a ese agente', () => {
    const r = consulta(todos, { agent: 'codex' });
    expect(r.totals).toMatchObject({ responses: 6, output: 600, sessions: 1 });
    expect(r.byModel.map((m) => m.family)).toEqual(['codex']);
    expect(r.tools).toEqual([{ name: 'exec', count: 9 }]);
    expect(r.days.reduce((n, d) => n + d.responses, 0)).toBe(6);
    const c = consulta(todos, { agent: 'claude' });
    expect(c.sessionsByAgent.codex).toBe(0);
    expect(c.byModel.some((m) => m.family === 'codex')).toBe(false);
  });

  it('30 días y todo', () => {
    const r30 = consulta(todos, { range: '30d' });
    expect(r30.totals.responses).toBe(10 + 20 + 4 + 6 + 5 + 5);
    expect(r30.previous?.responses).toBe(0);
    const todo = consulta(todos, { range: 'all' });
    expect(todo.totals.responses).toBe(150);
    expect(todo.previous).toBeNull();
    expect(todo.period.from).toBe('2026-08-01');
  });

  it('las horas activas son la unión de las sesiones, recortada al periodo', () => {
    const noviembre = (s: string) => new Date(s).getTime() / 1000;
    const a = archivo('claude', { '2026-11-03': dia({ r: 1 }) }, { act: [noviembre('2026-11-03T10:00:00'), noviembre('2026-11-03T10:30:00')] });
    const b = archivo('claude', { '2026-11-03': dia({ r: 1 }) }, { act: [noviembre('2026-11-03T10:15:00'), noviembre('2026-11-03T10:45:00')] });
    expect(consulta([a, b]).totals.activeSeconds).toBe(45 * 60);
    // Fuera del periodo no cuenta.
    const fuera = archivo('claude', { '2026-10-03': dia({ r: 1 }) }, { act: [noviembre('2026-10-03T10:00:00'), noviembre('2026-10-03T11:00:00')] });
    expect(consulta([fuera]).totals.activeSeconds).toBe(0);
  });

  it('calendario de 12 semanas de lunes a domingo, racha y mejor día', () => {
    const f = archivo('claude', {
      '2026-11-07': dia({ r: 3 }),
      '2026-11-06': dia({ r: 9 }),
      '2026-11-05': dia({ r: 1 }),
      '2026-11-03': dia({ r: 9 }),
      '2026-08-17': dia({ r: 2 }),
    });
    const r = consulta([f]);
    expect(r.days).toHaveLength(84);
    expect(r.days[0]!.date).toBe('2026-08-17');
    expect(r.days[83]!.date).toBe('2026-11-08');
    expect(r.today).toBe('2026-11-07');
    expect(r.days.find((d) => d.date === '2026-11-07')!.responses).toBe(3);
    // El domingo 8 aún no ha llegado.
    expect(r.days[83]!.responses).toBe(0);
    expect(r.streak).toBe(3);
    // Empate a 9: gana el más reciente.
    expect(r.bestDay).toEqual({ date: '2026-11-06', responses: 9 });
  });

  it('la racha sigue viva si hoy aún no hay respuestas, y es 0 si faltó ayer', () => {
    const ayer = archivo('claude', { '2026-11-06': dia({ r: 1 }), '2026-11-05': dia({ r: 1 }) });
    expect(consulta([ayer]).streak).toBe(2);
    const antes = archivo('claude', { '2026-11-05': dia({ r: 1 }) });
    expect(consulta([antes]).streak).toBe(0);
  });

  it('por proyecto: resuelve worktrees, agrupa lo ajeno en «Otros» y deja el top 5', () => {
    const r = consulta(todos);
    // Lo ajeno al panel queda en «Otros», que va siempre el último.
    expect(r.byProject.map((p) => [p.id, p.output])).toEqual([
      ['alfa', 3000],
      ['beta', 600],
      [null, 1000],
    ]);
    const muchos = archivo(
      'claude',
      { '2026-11-03': dia({ r: 7, o: 70, p: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/h/p${i}`, [1, 10 * (i + 1)]])) }) },
    );
    const proys: QueryProject[] = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `p${i}`, path: `/h/p${i}`, mono: 'PX', color: '#ffffff' }));
    const r2 = consulta([muchos], { projects: proys });
    expect(r2.byProject).toHaveLength(6);
    expect(r2.byProject.slice(0, 5).map((p) => p.id)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2']);
    expect(r2.byProject[5]).toMatchObject({ id: null, name: 'Otros', output: 10 + 20 });
  });

  it('por modelo: color por familia, versión más usada como etiqueta y desglose', () => {
    const r = consulta(todos, { range: '30d' });
    expect(r.byModel.map((m) => [m.family, m.label, m.responses])).toEqual([
      ['opus', 'Opus 5.5', 38],
      ['codex', 'Codex', 6],
      ['haiku', 'Haiku 5.5', 4],
      ['sonnet', 'Sonnet 5.5', 2],
    ]);
    const opus = r.byModel.find((m) => m.family === 'opus')!;
    expect(opus.versions.map((v) => v.label)).toEqual(['Opus 5.5', 'Opus 4.7']);
  });

  it('subagentes y herramientas: top 5 por uso', () => {
    const r = consulta(todos);
    expect(r.agents).toEqual([{ name: 'implementer', count: 1 }]);
    expect(r.tools).toEqual([
      { name: 'Bash', count: 10 },
      { name: 'exec', count: 9 },
      { name: 'Read', count: 2 },
    ]);
  });

  it('sin datos devuelve ceros y listas vacías', () => {
    const r = consulta([]);
    expect(r.totals).toMatchObject({ responses: 0, output: 0, sessions: 0, activeSeconds: 0 });
    expect(r.byProject).toEqual([]);
    expect(r.byModel).toEqual([]);
    expect(r.bestDay).toBeNull();
    expect(r.streak).toBe(0);
    expect(r.days).toHaveLength(84);
  });
});

import { describe, expect, it } from 'vitest';
import type { ActivityResponse, ActivityTotals } from '../../shared/activity.ts';
import { modelLabel } from '../../shared/activity.ts';
import {
  barPercents,
  bestDayText,
  calendarCells,
  compact,
  countDelta,
  dayText,
  exact,
  hoursDelta,
  hoursText,
  indexingText,
  isEmpty,
  levelOf,
  levelThresholds,
  loadActivityFilters,
  modelShares,
  modelTip,
  moveCell,
  percentDelta,
  projectTip,
  saveActivityFilters,
  streakText,
  tiles,
  updatedText,
  weekRows,
} from './activity.ts';

const NB = ' ';

const totales = (p: Partial<ActivityTotals> = {}): ActivityTotals => ({ responses: 0, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, sessions: 0, activeSeconds: 0, activeDays: 0, ...p });
const respuesta = (p: Partial<ActivityResponse> = {}): ActivityResponse => ({
  range: 'week',
  agent: 'all',
  indexing: false,
  progress: null,
  updatedAt: 1,
  period: { from: '2026-11-02', to: '2026-11-07', days: 7 },
  totals: totales({ responses: 3180, output: 1_240_000, input: 41_000, cacheRead: 310_000_000, cacheWrite: 5_200_000, sessions: 23, activeSeconds: 31 * 3600, activeDays: 6 }),
  previous: totales({ responses: 2917, output: 1_050_000, sessions: 27, activeSeconds: 28 * 3600 }),
  sessionsByAgent: { claude: 19, codex: 4 },
  days: [],
  today: '2026-11-07',
  streak: 12,
  bestDay: { date: '2026-11-03', responses: 1412 },
  byProject: [],
  byModel: [],
  agents: [],
  tools: [],
  ...p,
});

describe('formato de cifras', () => {
  it('exact agrupa los millares con espacio fino', () => {
    expect(exact(0)).toBe('0');
    expect(exact(999)).toBe('999');
    expect(exact(3180)).toBe(`3${NB}180`);
    expect(exact(1234567)).toBe(`1${NB}234${NB}567`);
  });

  it('compact da tres cifras significativas con coma y la unidad', () => {
    expect(compact(0)).toBe('0');
    expect(compact(999)).toBe('999');
    expect(compact(41_000)).toBe(`41${NB}k`);
    expect(compact(612_345)).toBe(`612${NB}k`);
    expect(compact(1_240_000)).toBe(`1,24${NB}M`);
    expect(compact(5_200_000)).toBe(`5,2${NB}M`);
    expect(compact(310_000_000)).toBe(`310${NB}M`);
    expect(compact(14_300_000_000)).toBe(`14,3${NB}G`);
    // 999 999 se redondea a 1000 k y pasa a millones.
    expect(compact(999_999)).toBe(`1${NB}M`);
    expect(compact(1500)).toBe(`1,5${NB}k`);
  });

  it('hoursText', () => {
    expect(hoursText(0)).toBe('0 min');
    expect(hoursText(20)).toBe('< 1 min');
    expect(hoursText(42 * 60)).toBe('42 min');
    // 59,7 min redondea a una hora, no a «60 min».
    expect(hoursText(3580)).toBe(`1${NB}h`);
    expect(hoursText(3.5 * 3600)).toBe(`3,5${NB}h`);
    expect(hoursText(31 * 3600 + 600)).toBe(`31${NB}h`);
  });
});

describe('variaciones', () => {
  it('porcentual, con casos sin periodo anterior', () => {
    expect(percentDelta(118, 100)).toMatchObject({ dir: 'up', text: '▲ 18 %' });
    expect(percentDelta(50, 100)).toMatchObject({ dir: 'down', text: '▼ 50 %' });
    expect(percentDelta(100, 100)).toMatchObject({ dir: 'same' });
    expect(percentDelta(5, 0)).toMatchObject({ dir: 'up', text: 'nuevo' });
    expect(percentDelta(0, 0)).toMatchObject({ dir: 'same', text: '—' });
  });

  it('absoluta y de horas', () => {
    expect(countDelta(19, 23)).toMatchObject({ dir: 'down', text: '▼ 4' });
    expect(countDelta(23, 19)).toMatchObject({ dir: 'up', text: '▲ 4' });
    expect(countDelta(3, 3).dir).toBe('same');
    expect(hoursDelta(31 * 3600, 28 * 3600)).toMatchObject({ dir: 'up', text: `▲ 3${NB}h` });
    expect(hoursDelta(3600, 3600 + 30).dir).toBe('same');
    expect(hoursDelta(0, 1500)).toMatchObject({ dir: 'down', text: '▼ 25 min' });
  });
});

describe('tiles', () => {
  it('cuatro cifras con detalle y comparación', () => {
    const t = tiles(respuesta());
    expect(t.map((x) => x.id)).toEqual(['output', 'sessions', 'responses', 'hours']);
    expect(t[0]).toMatchObject({ value: `1,24${NB}M`, compare: 'frente a la semana pasada' });
    expect(t[0]!.detail).toBe(`entrada 41${NB}k · caché leída 310${NB}M · escrita 5,2${NB}M`);
    expect(t[1]).toMatchObject({ value: '23', detail: '19 de Claude · 4 de Codex' });
    expect(t[1]!.delta).toMatchObject({ dir: 'down', text: '▼ 4' });
    expect(t[2]!.detail).toBe('media de 138 por sesión');
    expect(t[3]).toMatchObject({ value: `31${NB}h`, detail: 'días activos: 6 de 7' });
    expect(t[3]!.note).toContain('5 minutos');
  });

  it('en «todo» no hay comparación; con un agente, el detalle de sesiones es solo el suyo', () => {
    const t = tiles(respuesta({ range: 'all', previous: null, agent: 'codex' }));
    expect(t.every((x) => x.delta === null && x.compare === null)).toBe(true);
    expect(t[1]!.detail).toBe('4 de Codex');
    expect(tiles(respuesta({ agent: 'claude' }))[1]!.detail).toBe('19 de Claude');
  });

  it('sin sesiones no divide por cero', () => {
    const t = tiles(respuesta({ totals: totales(), previous: totales() }));
    expect(t[2]!.detail).toBe('sin sesiones');
    expect(t[0]!.value).toBe('0');
  });
});

describe('calendario', () => {
  it('niveles por cuartiles de los días con actividad', () => {
    const th = levelThresholds([0, 0, 10, 20, 30, 40, 50, 60, 70, 80]);
    expect(levelOf(0, th)).toBe(0);
    expect(th[0]).toBeLessThan(th[2]);
    const niveles = [10, 20, 30, 40, 50, 60, 70, 80].map((v) => levelOf(v, th));
    expect(niveles[0]).toBe(1);
    expect(niveles[niveles.length - 1]).toBe(4);
    expect([...niveles].sort()).toEqual(niveles);
    expect(levelThresholds([0, 0])).toEqual([0, 0, 0]);
    expect(levelOf(5, [0, 0, 0])).toBe(4);
    // Un día aislado enorme no apaga el resto.
    const sesgado = levelThresholds([1, 2, 3, 4, 1000]);
    expect(levelOf(3, sesgado)).toBeGreaterThan(0);
  });

  it('textos de día, con el año solo si no es el actual', () => {
    expect(dayText('2026-11-03', '2026-11-07')).toBe('mar 3 nov');
    expect(dayText('2025-12-29', '2026-01-05')).toBe('lun 29 dic 2025');
    expect(bestDayText({ date: '2026-11-03', responses: 1412 }, '2026-11-07')).toBe(`mar 3 nov (1${NB}412)`);
    expect(bestDayText(null, '2026-11-07')).toBe('ninguno');
    expect(streakText(12)).toBe('12 días');
    expect(streakText(1)).toBe('1 día');
    expect(streakText(0)).toBe('sin racha');
  });

  it('celdas: texto accesible, futuros apagados', () => {
    const celdas = calendarCells(
      [
        { date: '2026-11-06', responses: 1412 },
        { date: '2026-11-07', responses: 0 },
        { date: '2026-11-08', responses: 0 },
      ],
      '2026-11-07',
    );
    expect(celdas[0]).toMatchObject({ text: `vie 6 nov: 1${NB}412 respuestas`, future: false });
    expect(celdas[1]).toMatchObject({ text: 'sáb 7 nov: sin actividad', level: 0 });
    expect(celdas[2]).toMatchObject({ future: true, level: 0, text: 'dom 8 nov: aún no ha llegado' });
    expect(calendarCells([{ date: '2026-11-06', responses: 1 }], '2026-11-07')[0]!.text).toBe('vie 6 nov: 1 respuesta');
  });

  it('vista en tabla: una fila por semana y vacío en los días futuros', () => {
    const dias = Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${String(2 + i).padStart(2, '0')}`, responses: i }));
    const filas = weekRows(dias, '2026-11-09');
    expect(filas).toHaveLength(2);
    expect(filas[0]!.label).toBe('Semana del 2 nov');
    expect(filas[0]!.days.map((d) => d.text)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(filas[1]!.days.map((d) => d.text)).toEqual(['7', '', '', '', '', '', '']);
  });

  it('flechas: ±1 día en vertical, ±1 semana en horizontal, con tope', () => {
    expect(moveCell(10, 'ArrowDown', 84)).toBe(11);
    expect(moveCell(10, 'ArrowUp', 84)).toBe(9);
    expect(moveCell(10, 'ArrowRight', 84)).toBe(17);
    expect(moveCell(10, 'ArrowLeft', 84)).toBe(3);
    expect(moveCell(2, 'ArrowLeft', 84)).toBe(0);
    expect(moveCell(80, 'ArrowRight', 84)).toBe(83);
    expect(moveCell(10, 'Home', 84)).toBe(0);
    expect(moveCell(10, 'End', 84)).toBe(83);
    expect(moveCell(10, 'x', 84)).toBe(10);
  });
});

describe('repartos', () => {
  it('barras relativas a la mayor, con un mínimo visible', () => {
    const p = (output: number) => ({ id: 'a', name: 'a', mono: 'A', color: '#fff', output });
    expect(barPercents([p(612), p(306), p(1), p(0)])).toEqual([100, 50, 2, 0]);
    expect(barPercents([])).toEqual([]);
    expect(projectTip(p(612_345), 1_224_690)).toBe(`a: 612${NB}345 tokens de salida · 50 % del total`);
  });

  it('porcentajes de modelos que suman 100', () => {
    const m = (family: 'opus' | 'sonnet' | 'haiku' | 'codex', responses: number) => ({ family, label: family, responses, versions: [] });
    const s = modelShares([m('opus', 71), m('sonnet', 18), m('haiku', 8), m('codex', 3)]);
    expect(s.map((x) => x.percent)).toEqual([71, 18, 8, 3]);
    const tres = modelShares([m('opus', 1), m('sonnet', 1), m('haiku', 1)]);
    expect(tres.reduce((n, x) => n + x.percent, 0)).toBe(100);
    expect(modelShares([])).toEqual([]);
    expect(modelTip({ ...s[0]!, versions: [{ label: 'Opus 5.5', responses: 60 }, { label: 'Opus 4.7', responses: 11 }] })).toBe('opus: 71 respuestas (71 %) · Opus 5.5 60, Opus 4.7 11');
  });

  it('etiquetas de modelo', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelLabel('sonnet')).toBe('Sonnet');
    expect(modelLabel('x'.repeat(60))).toHaveLength(40);
  });
});

describe('estado y filtros', () => {
  it('texto de progreso y de actualización', () => {
    expect(indexingText({ progress: null })).toBe('Calculando…');
    expect(indexingText({ progress: { done: 50, total: 200 } })).toBe('Calculando… 25 %');
    expect(indexingText({ progress: { done: 200, total: 200 } })).toBe('Calculando… 99 %');
    expect(updatedText(null, 1000)).toBe('');
    expect(updatedText(1000, 1000 + 20_000)).toBe('actualizado ahora');
    expect(updatedText(1000, 1000 + 60_000)).toBe('actualizado hace 1 min');
    expect(updatedText(1000, 1000 + 3 * 3_600_000)).toBe('actualizado hace 3 h');
  });

  it('isEmpty', () => {
    expect(isEmpty(respuesta({ totals: totales(), days: [{ date: '2026-11-01', responses: 0 }] }))).toBe(true);
    expect(isEmpty(respuesta({ totals: totales(), days: [{ date: '2026-11-01', responses: 2 }] }))).toBe(false);
  });

  it('filtros recordados: valores ilegibles vuelven a los de por defecto', () => {
    const mem = new Map<string, string>();
    const almacen = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadActivityFilters(almacen)).toEqual({ range: 'week', agent: 'all' });
    saveActivityFilters({ range: '30d', agent: 'codex' }, almacen);
    expect(loadActivityFilters(almacen)).toEqual({ range: '30d', agent: 'codex' });
    mem.set([...mem.keys()][0]!, '{"range":"siempre","agent":3}');
    expect(loadActivityFilters(almacen)).toEqual({ range: 'week', agent: 'all' });
    mem.set([...mem.keys()][0]!, 'no json');
    expect(loadActivityFilters(almacen)).toEqual({ range: 'week', agent: 'all' });
    expect(loadActivityFilters(null)).toEqual({ range: 'week', agent: 'all' });
    // Almacenamiento que lanza: no falla.
    const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(loadActivityFilters(roto)).toEqual({ range: 'week', agent: 'all' });
    expect(() => saveActivityFilters({ range: 'all', agent: 'all' }, roto)).not.toThrow();
  });
});

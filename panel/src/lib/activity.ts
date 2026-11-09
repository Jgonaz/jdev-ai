import type { ActivityAgent, ActivityDay, ActivityModel, ActivityProject, ActivityRange, ActivityResponse, ActivityTotals, ModelFamily } from '../../shared/activity.ts';
import { safeStorage } from './workspace.ts';

// Lógica pura de «tu actividad» en Inicio: formato de cifras, comparaciones,
// niveles del calendario, repartos y filtros recordados.

const NBSP = ' ';
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** Cifra exacta con espacio de millares: «3 180». */
export function exact(n: number): string {
  const s = String(Math.round(n));
  return s.length <= 3 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Tres cifras significativas con coma decimal y sin ceros sobrantes: «1,24», «5,2», «310». */
function sig3(v: number): string {
  const t = Number(v.toPrecision(3));
  return String(t).replace('.', ',');
}

/** Cifra compacta: «41 k», «1,24 M», «3,1 G». Por debajo de 1 000, exacta. */
export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const unidades = [
    [1e3, 'k'],
    [1e6, 'M'],
    [1e9, 'G'],
  ] as const;
  for (let i = 0; i < unidades.length; i++) {
    const [factor, letra] = unidades[i]!;
    const siguiente = unidades[i + 1]?.[0] ?? Infinity;
    if (n < siguiente) {
      const v = Number((n / factor).toPrecision(3));
      // 999,9 k se redondea a 1000 k: pasa a la unidad siguiente.
      if (v >= 1000 && i + 1 < unidades.length) return `${sig3(n / unidades[i + 1]![0])}${NBSP}${unidades[i + 1]![1]}`;
      return `${sig3(n / factor)}${NBSP}${letra}`;
    }
  }
  return exact(n);
}

/** Tiempo activo: «42 min», «3,5 h», «31 h». */
export function hoursText(segundos: number): string {
  const min = segundos / 60;
  if (min < 1 && segundos > 0) return '< 1 min';
  // Se compara ya redondeado: 59,7 min debe pasar a «1 h», no quedarse en «60 min».
  if (Math.round(min) < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  return h < 10 ? `${String(Math.round(h * 10) / 10).replace('.', ',')}${NBSP}h` : `${Math.round(h)}${NBSP}h`;
}

export type Delta = { dir: 'up' | 'down' | 'same'; text: string; label: string };

/** Variación relativa: «▲ 18 %». Sin periodo anterior con datos, «nuevo» o «igual». */
export function percentDelta(actual: number, previo: number): Delta {
  if (previo <= 0) return actual > 0 ? { dir: 'up', text: 'nuevo', label: 'Sin actividad en el periodo anterior' } : { dir: 'same', text: '—', label: 'Sin cambios' };
  const p = Math.round(((actual - previo) / previo) * 100);
  if (p === 0) return { dir: 'same', text: '= 0 %', label: 'Igual que antes' };
  return p > 0 ? { dir: 'up', text: `▲ ${exact(p)} %`, label: `Sube un ${exact(p)} %` } : { dir: 'down', text: `▼ ${exact(-p)} %`, label: `Baja un ${exact(-p)} %` };
}

/** Variación absoluta: «▲ 3» o «▼ 4». */
export function countDelta(actual: number, previo: number): Delta {
  const d = actual - previo;
  if (d === 0) return { dir: 'same', text: '= 0', label: 'Igual que antes' };
  return d > 0 ? { dir: 'up', text: `▲ ${exact(d)}`, label: `Sube en ${exact(d)}` } : { dir: 'down', text: `▼ ${exact(-d)}`, label: `Baja en ${exact(-d)}` };
}

/** Variación del tiempo activo: «▲ 3 h» o «▼ 25 min». */
export function hoursDelta(actual: number, previo: number): Delta {
  const d = actual - previo;
  if (Math.abs(d) < 60) return { dir: 'same', text: '= 0', label: 'Igual que antes' };
  const t = hoursText(Math.abs(d));
  return d > 0 ? { dir: 'up', text: `▲ ${t}`, label: `Sube ${t}` } : { dir: 'down', text: `▼ ${t}`, label: `Baja ${t}` };
}

export const COMPARE_TEXT: Record<ActivityRange, string | null> = {
  week: 'frente a la semana pasada',
  '30d': 'frente a los 30 días previos',
  all: null,
};

export type Tile = {
  id: 'output' | 'sessions' | 'responses' | 'hours';
  label: string;
  value: string;
  delta: Delta | null;
  compare: string | null;
  detail: string;
  /** Explicación de las cifras aproximadas, para el tooltip del título. */
  note: string | null;
};

const plural = (n: number, uno: string, varios: string) => `${exact(n)} ${n === 1 ? uno : varios}`;

/** Las cuatro cifras con su variación frente al periodo anterior. */
export function tiles(r: ActivityResponse): Tile[] {
  const t = r.totals;
  const p = r.previous;
  const compare = COMPARE_TEXT[r.range];
  const media = t.sessions > 0 ? Math.round(t.responses / t.sessions) : 0;
  const porAgente = [
    r.agent !== 'codex' ? `${exact(r.sessionsByAgent.claude)} de Claude` : null,
    r.agent !== 'claude' ? `${exact(r.sessionsByAgent.codex)} de Codex` : null,
  ].filter((x): x is string => x !== null);
  return [
    {
      id: 'output',
      label: 'Tokens de salida',
      value: compact(t.output),
      delta: p ? percentDelta(t.output, p.output) : null,
      compare,
      detail: `entrada ${compact(t.input)} · caché leída ${compact(t.cacheRead)} · escrita ${compact(t.cacheWrite)}`,
      note: null,
    },
    {
      id: 'sessions',
      label: 'Sesiones',
      value: exact(t.sessions),
      delta: p ? countDelta(t.sessions, p.sessions) : null,
      compare,
      detail: porAgente.join(' · '),
      note: 'Conversaciones principales con alguna respuesta en el periodo: los subagentes no cuentan como sesión.',
    },
    {
      id: 'responses',
      label: 'Respuestas',
      value: exact(t.responses),
      delta: p ? percentDelta(t.responses, p.responses) : null,
      compare,
      detail: t.sessions > 0 ? `media de ${exact(media)} por sesión` : 'sin sesiones',
      note: null,
    },
    {
      id: 'hours',
      label: 'Horas activas',
      value: hoursText(t.activeSeconds),
      delta: p ? hoursDelta(t.activeSeconds, p.activeSeconds) : null,
      compare,
      detail: `días activos: ${exact(t.activeDays)} de ${exact(r.period.days)}`,
      note: 'Aproximación: se suman los huecos de 5 minutos o menos entre respuestas seguidas de una sesión, y un hueco mayor cuenta como 5 minutos. El tiempo en que coinciden varias sesiones se cuenta una vez.',
    },
  ];
}

// ---------- Calendario ----------

/** Umbrales (cuartiles de los días con actividad) que reparten los días en 4 niveles. */
export function levelThresholds(valores: readonly number[]): [number, number, number] {
  const v = valores.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [0, 0, 0];
  const q = (f: number) => v[Math.min(v.length - 1, Math.floor(f * v.length))]!;
  return [q(0.25), q(0.5), q(0.75)];
}

/** Nivel 0 (sin actividad) a 4 (el más intenso) de un día. */
export function levelOf(valor: number, [a, b, c]: readonly [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (valor <= 0) return 0;
  if (valor <= a) return 1;
  if (valor <= b) return 2;
  if (valor <= c) return 3;
  return 4;
}

const parse = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)), 12);

/** «mar 3 nov»; con el año si no es el de `hoy`. */
export function dayText(k: string, hoy: string): string {
  const d = parse(k);
  const anio = k.slice(0, 4) === hoy.slice(0, 4) ? '' : ` ${k.slice(0, 4)}`;
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}${anio}`;
}

export type CalendarCell = { date: string; responses: number; level: 0 | 1 | 2 | 3 | 4; future: boolean; text: string };

/** Celdas del calendario en orden de semana (lunes a domingo); los días futuros no cuentan. */
export function calendarCells(days: readonly ActivityDay[], hoy: string): CalendarCell[] {
  const t = levelThresholds(days.map((d) => d.responses));
  return days.map((d) => {
    const future = d.date > hoy;
    return {
      date: d.date,
      responses: d.responses,
      level: future ? 0 : levelOf(d.responses, t),
      future,
      text: future ? `${dayText(d.date, hoy)}: aún no ha llegado` : d.responses > 0 ? `${dayText(d.date, hoy)}: ${plural(d.responses, 'respuesta', 'respuestas')}` : `${dayText(d.date, hoy)}: sin actividad`,
    };
  });
}

/** Racha y mejor día de la cabecera del calendario. */
export function streakText(streak: number): string {
  return streak > 0 ? plural(streak, 'día', 'días') : 'sin racha';
}

export function bestDayText(best: ActivityDay | null, hoy: string): string {
  return best ? `${dayText(best.date, hoy)} (${exact(best.responses)})` : 'ninguno';
}

/** Semanas (filas de 7 días) para la vista en tabla. */
export function weekRows(days: readonly ActivityDay[], hoy: string): { label: string; days: { date: string; text: string; future: boolean }[] }[] {
  const filas = [];
  for (let i = 0; i + 6 < days.length; i += 7) {
    const sem = days.slice(i, i + 7);
    filas.push({
      label: `Semana del ${dayText(sem[0]!.date, hoy).replace(/^\S+ /, '')}`,
      days: sem.map((d) => ({ date: d.date, future: d.date > hoy, text: d.date > hoy ? '' : exact(d.responses) })),
    });
  }
  return filas;
}

/** Movimiento del foco en el calendario con las flechas: ±1 día en vertical, ±1 semana en horizontal. */
export function moveCell(indice: number, tecla: string, total: number): number {
  const paso = tecla === 'ArrowUp' ? -1 : tecla === 'ArrowDown' ? 1 : tecla === 'ArrowLeft' ? -7 : tecla === 'ArrowRight' ? 7 : tecla === 'Home' ? -indice : tecla === 'End' ? total : 0;
  return Math.max(0, Math.min(total - 1, indice + paso));
}

// ---------- Repartos ----------

/** Anchura de cada barra de proyecto, de 0 a 100 respecto a la mayor. */
export function barPercents(proyectos: readonly ActivityProject[]): number[] {
  const max = Math.max(0, ...proyectos.map((p) => p.output));
  return proyectos.map((p) => (max > 0 ? Math.max(p.output > 0 ? 2 : 0, (p.output / max) * 100) : 0));
}

export function projectTip(p: ActivityProject, total: number): string {
  const pct = total > 0 ? ` · ${Math.round((p.output / total) * 100)} % del total` : '';
  return `${p.name}: ${exact(p.output)} tokens de salida${pct}`;
}

export type ModelShare = ActivityModel & { percent: number };

/** Porcentaje de respuestas de cada modelo (el redondeo reparte para que sumen 100). */
export function modelShares(modelos: readonly ActivityModel[]): ModelShare[] {
  const total = modelos.reduce((n, m) => n + m.responses, 0);
  if (total === 0) return [];
  const bruto = modelos.map((m) => (m.responses / total) * 100);
  const piso = bruto.map(Math.floor);
  let resto = 100 - piso.reduce((a, b) => a + b, 0);
  // Los que más decimales pierden al bajar ganan el punto sobrante (método del mayor resto).
  const orden = bruto.map((v, i) => [v - piso[i]!, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of orden) {
    if (resto <= 0) break;
    piso[i]!++;
    resto--;
  }
  return modelos.map((m, i) => ({ ...m, percent: piso[i]! }));
}

export function modelTip(m: ModelShare): string {
  const base = `${m.label}: ${plural(m.responses, 'respuesta', 'respuestas')} (${m.percent} %)`;
  return m.versions.length > 1 ? `${base} · ${m.versions.map((v) => `${v.label} ${exact(v.responses)}`).join(', ')}` : base;
}

export const FAMILY_NAMES: Record<ModelFamily, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', codex: 'Codex', other: 'Otros' };

/** Texto alternativo del reparto: «Opus 5.5 71 %, Sonnet 5.5 18 %». */
export function modelSummary(shares: readonly ModelShare[]): string {
  return shares.map((m) => `${m.label} ${m.percent} %`).join(', ');
}

// ---------- Estado y filtros recordados ----------

export function rangeLabel(r: ActivityRange): string {
  return r === 'week' ? 'Esta semana' : r === '30d' ? '30 días' : 'Todo';
}
export function agentLabel(a: ActivityAgent): string {
  return a === 'all' ? 'Todos' : a === 'claude' ? 'Claude' : 'Codex';
}

/** «Calculando… 42 %» mientras la primera pasada lee los transcripts. */
export function indexingText(r: Pick<ActivityResponse, 'progress'>): string {
  const p = r.progress;
  if (!p || p.total <= 0) return 'Calculando…';
  return `Calculando… ${Math.min(99, Math.floor((p.done / p.total) * 100))} %`;
}

/** «actualizado hace 1 min», o vacío si aún no hubo ninguna pasada. */
export function updatedText(updatedAt: number | null, ahora: number): string {
  if (updatedAt === null) return '';
  const min = Math.floor(Math.max(0, ahora - updatedAt) / 60000);
  if (min < 1) return 'actualizado ahora';
  if (min < 60) return `actualizado hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `actualizado hace ${h} h` : `actualizado hace ${Math.floor(h / 24)} d`;
}

export type ActivityFilters = { range: ActivityRange; agent: ActivityAgent };
export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { range: 'week', agent: 'all' };
const FILTERS_KEY = 'jdev-panel:inicio:actividad';

export function loadActivityFilters(storage: Pick<Storage, 'getItem'> | null = safeStorage()): ActivityFilters {
  try {
    const v: unknown = JSON.parse(storage?.getItem(FILTERS_KEY) ?? 'null');
    if (typeof v !== 'object' || v === null) return DEFAULT_ACTIVITY_FILTERS;
    const o = v as Record<string, unknown>;
    return {
      range: o.range === 'week' || o.range === '30d' || o.range === 'all' ? o.range : DEFAULT_ACTIVITY_FILTERS.range,
      agent: o.agent === 'all' || o.agent === 'claude' || o.agent === 'codex' ? o.agent : DEFAULT_ACTIVITY_FILTERS.agent,
    };
  } catch {
    return DEFAULT_ACTIVITY_FILTERS;
  }
}

export function saveActivityFilters(f: ActivityFilters, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // Almacenamiento bloqueado: solo se pierde el recuerdo.
  }
}

/** ¿Hay algo que enseñar? (con el filtro actual y sin pasada en curso, vacío es «sin actividad»). */
export function isEmpty(r: ActivityResponse): boolean {
  return r.totals.responses === 0 && r.days.every((d) => d.responses === 0);
}

export type { ActivityTotals };

import { CALENDAR_WEEKS, modelLabel } from '../shared/activity.ts';
import type {
  ActivityAgent,
  ActivityCount,
  ActivityDay,
  ActivityModel,
  ActivityProject,
  ActivityRange,
  ActivityResponse,
  ActivityTotals,
  ModelFamily,
} from '../shared/activity.ts';
import type { DayAgg, FileEntry } from './activity-index.ts';

// Consultas sobre el índice: periodos, comparación con el anterior y repartos.
// Es pura (recibe los archivos del índice y los proyectos), así que se prueba sin disco.

export type QueryProject = { id: string; name: string; path: string; mono: string; color: string };

export type QueryInput = {
  files: Iterable<FileEntry>;
  projects: readonly QueryProject[];
  range: ActivityRange;
  agent: ActivityAgent;
  now: Date;
  indexing: boolean;
  progress: { done: number; total: number } | null;
  updatedAt: number | null;
};

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Fecha local a mediodía (a salvo de los saltos de hora) a partir de AAAA-MM-DD. */
const fromKey = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)), 12);
export function addDays(k: string, n: number): string {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return key(d);
}
const dayStartMs = (k: string) => new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10))).getTime();
/** Lunes de la semana de `k`. */
export function mondayOf(k: string): string {
  const dow = (fromKey(k).getDay() + 6) % 7;
  return addDays(k, -dow);
}
const daysBetween = (a: string, b: string) => Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86400000);

const FIRST_DAY = '0000-00-00';

export type Period = { from: string; to: string; days: number; previous: { from: string; to: string } | null };

/**
 * Periodo pedido y su anterior equivalente: la semana natural (lunes a hoy) frente
 * a la anterior hasta el mismo día de la semana, o los últimos 30 días frente a
 * los 30 anteriores. «Todo» no tiene comparación.
 */
export function periodOf(range: ActivityRange, hoy: string, primerDia: string | null): Period {
  if (range === 'week') {
    const from = mondayOf(hoy);
    return { from, to: hoy, days: 7, previous: { from: addDays(from, -7), to: addDays(hoy, -7) } };
  }
  if (range === '30d') {
    const from = addDays(hoy, -29);
    return { from, to: hoy, days: 30, previous: { from: addDays(from, -30), to: addDays(from, -1) } };
  }
  return { from: FIRST_DAY, to: hoy, days: primerDia ? daysBetween(primerDia, hoy) + 1 : 1, previous: null };
}

function emptyTotals(): ActivityTotals {
  return { responses: 0, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, sessions: 0, activeSeconds: 0, activeDays: 0 };
}

/** Segundos que cubre la unión de los intervalos [ini, fin) recortados a [desde, hasta). */
export function unionSeconds(intervalos: readonly number[][], desde: number, hasta: number): number {
  const lista: [number, number][] = [];
  for (const act of intervalos) {
    for (let i = 0; i + 1 < act.length; i += 2) {
      const s = Math.max(act[i]!, desde);
      const f = Math.min(act[i + 1]!, hasta);
      if (f > s) lista.push([s, f]);
    }
  }
  lista.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let fin = -Infinity;
  for (const [s, f] of lista) {
    if (s > fin) {
      total += f - s;
      fin = f;
    } else if (f > fin) {
      total += f - fin;
      fin = f;
    }
  }
  return total;
}

function totalsFor(files: readonly FileEntry[], from: string, to: string): ActivityTotals {
  const t = emptyTotals();
  const dias = new Set<string>();
  for (const e of files) {
    let activo = false;
    for (const [dk, d] of Object.entries(e.days)) {
      if (dk < from || dk > to || d.r === 0) continue;
      activo = true;
      t.responses += d.r;
      t.output += d.o;
      t.input += d.i;
      t.cacheRead += d.cr;
      t.cacheWrite += d.cw;
      dias.add(dk);
    }
    if (activo && !e.sub) t.sessions++;
  }
  t.activeDays = dias.size;
  const desde = from === FIRST_DAY ? 0 : dayStartMs(from) / 1000;
  const hasta = dayStartMs(addDays(to, 1)) / 1000;
  t.activeSeconds = unionSeconds(
    files.map((e) => e.act),
    desde,
    hasta,
  );
  return t;
}

/** Proyecto del panel al que pertenece un directorio de trabajo (checkout o worktree), o null. */
export function projectOf(cwd: string, projects: readonly QueryProject[]): QueryProject | null {
  let mejor: QueryProject | null = null;
  let largo = -1;
  for (const p of projects) {
    for (const base of [p.path, `${p.path}.worktrees`]) {
      if ((cwd === base || cwd.startsWith(`${base}/`)) && base.length > largo) {
        // `<projects>/<id>.worktrees/<nombre>` es del proyecto <id>, también si el worktree ya no existe.
        mejor = p;
        largo = base.length;
      }
    }
  }
  return mejor;
}

/** Familia (y color) de un modelo: Claude por su nombre, Codex para todo lo de ese agente. */
export function familyOf(agent: 'claude' | 'codex', model: string): ModelFamily {
  if (agent === 'codex') return 'codex';
  const m = /(opus|sonnet|haiku)/.exec(model.toLowerCase());
  return m ? (m[1] as ModelFamily) : 'other';
}

const TOP_PROJECTS = 5;
const TOP_LIST = 5;

function top(rec: Map<string, number>, n: number): ActivityCount[] {
  return [...rec]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

export function buildActivity(q: QueryInput): ActivityResponse {
  const hoy = key(q.now);
  const files = [...q.files].filter((e) => q.agent === 'all' || e.agent === q.agent);

  let primerDia: string | null = null;
  const porDia = new Map<string, number>();
  for (const e of files) {
    for (const [dk, d] of Object.entries(e.days)) {
      if (d.r === 0) continue;
      porDia.set(dk, (porDia.get(dk) ?? 0) + d.r);
      if (primerDia === null || dk < primerDia) primerDia = dk;
    }
  }
  const periodo = periodOf(q.range, hoy, primerDia);
  const totals = totalsFor(files, periodo.from, periodo.to);
  const previous = periodo.previous ? totalsFor(files, periodo.previous.from, periodo.previous.to) : null;

  const sessionsByAgent = {
    claude: totalsFor(
      files.filter((e) => e.agent === 'claude'),
      periodo.from,
      periodo.to,
    ).sessions,
    codex: totalsFor(
      files.filter((e) => e.agent === 'codex'),
      periodo.from,
      periodo.to,
    ).sessions,
  };

  // Calendario: 12 semanas de lunes a domingo, la última la actual.
  const inicio = addDays(mondayOf(hoy), -7 * (CALENDAR_WEEKS - 1));
  const days: ActivityDay[] = [];
  let mejor: ActivityDay | null = null;
  for (let i = 0; i < CALENDAR_WEEKS * 7; i++) {
    const date = addDays(inicio, i);
    const responses = date > hoy ? 0 : (porDia.get(date) ?? 0);
    days.push({ date, responses });
    // Si dos días empatan, gana el más reciente.
    if (responses > 0 && (mejor === null || responses >= mejor.responses)) mejor = { date, responses };
  }

  // Racha: días seguidos con actividad hasta hoy (o hasta ayer, si hoy aún no hay).
  let racha = 0;
  let d = (porDia.get(hoy) ?? 0) > 0 ? hoy : addDays(hoy, -1);
  while ((porDia.get(d) ?? 0) > 0) {
    racha++;
    d = addDays(d, -1);
  }

  // Repartos del periodo.
  const salidaPorProyecto = new Map<string | null, number>();
  const cache = new Map<string, QueryProject | null>();
  const modelos = new Map<ModelFamily, Map<string, number>>();
  const subagentes = new Map<string, number>();
  const herramientas = new Map<string, number>();
  for (const e of files) {
    for (const [dk, dia] of Object.entries(e.days) as [string, DayAgg][]) {
      if (dk < periodo.from || dk > periodo.to) continue;
      for (const [cwd, [, o]] of Object.entries(dia.p)) {
        if (o === 0) continue;
        let p = cache.get(cwd);
        if (p === undefined) {
          p = projectOf(cwd, q.projects);
          cache.set(cwd, p);
        }
        const id = p?.id ?? null;
        salidaPorProyecto.set(id, (salidaPorProyecto.get(id) ?? 0) + o);
      }
      for (const [modelo, n] of Object.entries(dia.m)) {
        const fam = familyOf(e.agent, modelo);
        const etiqueta = fam === 'codex' ? 'Codex' : modelLabel(modelo);
        const f = modelos.get(fam) ?? new Map<string, number>();
        f.set(etiqueta, (f.get(etiqueta) ?? 0) + n);
        modelos.set(fam, f);
      }
      for (const [k, n] of Object.entries(dia.a)) subagentes.set(k, (subagentes.get(k) ?? 0) + n);
      for (const [k, n] of Object.entries(dia.t)) herramientas.set(k, (herramientas.get(k) ?? 0) + n);
    }
  }

  const proyectos = [...salidaPorProyecto]
    .filter((x): x is [string, number] => x[0] !== null)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const byProject: ActivityProject[] = proyectos.slice(0, TOP_PROJECTS).map(([id, output]) => {
    const p = q.projects.find((x) => x.id === id)!;
    return { id, name: p.name, mono: p.mono, color: p.color, output };
  });
  const otros = proyectos.slice(TOP_PROJECTS).reduce((n, x) => n + x[1], 0) + (salidaPorProyecto.get(null) ?? 0);
  if (otros > 0) byProject.push({ id: null, name: 'Otros', mono: null, color: null, output: otros });

  const byModel: ActivityModel[] = [...modelos]
    .map(([family, versiones]) => {
      const lista = [...versiones].map(([label, responses]) => ({ label, responses })).sort((a, b) => b.responses - a.responses);
      return {
        family,
        label: lista[0]!.label,
        responses: lista.reduce((n, v) => n + v.responses, 0),
        versions: lista.length > 1 ? lista : [],
      };
    })
    // «Otros» siempre al final, aunque sea mayor que alguna familia con nombre.
    .sort((a, b) => (a.family === 'other' ? 1 : b.family === 'other' ? -1 : b.responses - a.responses));

  return {
    range: q.range,
    agent: q.agent,
    indexing: q.indexing,
    progress: q.progress,
    updatedAt: q.updatedAt,
    period: { from: periodo.from === FIRST_DAY ? (primerDia ?? hoy) : periodo.from, to: periodo.to, days: periodo.days },
    totals,
    previous,
    sessionsByAgent,
    days,
    today: hoy,
    streak: racha,
    bestDay: mejor,
    byProject,
    byModel,
    agents: top(subagentes, TOP_LIST),
    tools: top(herramientas, TOP_LIST),
  };
}

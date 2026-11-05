import type { AccountLimits, RateLimit, SessionActivity, SessionInfo } from '../types.ts';
import { visualState } from './sessions.ts';

// Lógica pura de la cabecera de la terminal (contexto, trabajo en curso) y de los
// límites de la cuenta de la cabecera global. Los datos llegan de la statusline
// de Claude y de los hooks de actividad (server/usage.ts).

const SEG = 1000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

/** Contexto y límites: neutro por debajo del 50 %, aviso desde el 50 % y crítico desde el 80 %. */
export type Level = 'neutral' | 'warn' | 'critical';
export const WARN_AT = 50;
export const CRITICAL_AT = 80;

/**
 * Nivel de un porcentaje. Se decide con el mismo valor que se muestra (redondeado,
 * como `formatPercent`): con 49,6 % se ve «50 %» y es ámbar; con 79,6 %, «80 %» y rojo.
 */
export function levelOf(percent: number | null): Level {
  if (percent === null) return 'neutral';
  const mostrado = Math.round(percent);
  if (mostrado >= CRITICAL_AT) return 'critical';
  if (mostrado >= WARN_AT) return 'warn';
  return 'neutral';
}

/** Datos más viejos que esto, con la sesión sin trabajar, se muestran atenuados. */
export const STALE_AFTER_MS = 15 * MIN;

/** Los datos están desactualizados: llevan más de 15 min sin cambiar y la sesión no está trabajando. */
export function isStale(updatedAt: number, ahora: number, trabajando: boolean): boolean {
  return !trabajando && ahora - updatedAt > STALE_AFTER_MS;
}

/** «hace 12 s», «hace 20 min», «hace 3 h», «hace 2 d». */
export function formatAgo(desde: number, ahora: number): string {
  const dif = Math.max(0, ahora - desde);
  if (dif < MIN) return `hace ${Math.floor(dif / SEG)} s`;
  if (dif < HORA) return `hace ${Math.floor(dif / MIN)} min`;
  if (dif < DIA) return `hace ${Math.floor(dif / HORA)} h`;
  return `hace ${Math.floor(dif / DIA)} d`;
}

/** Tiempo de sesión: «< 1 min», «48 min», «2 h 14 min», «3 h 05 min», «1 d 3 h». */
export function formatDuration(ms: number): string {
  const dif = Math.max(0, ms);
  if (dif < MIN) return '< 1 min';
  if (dif < HORA) return `${Math.floor(dif / MIN)} min`;
  if (dif < DIA) return `${Math.floor(dif / HORA)} h ${String(Math.floor((dif % HORA) / MIN)).padStart(2, '0')} min`;
  return `${Math.floor(dif / DIA)} d ${Math.floor((dif % DIA) / HORA)} h`;
}

/** Tiempo que lleva un subagente: «22 s», «4 m», «1 m 12 s», «1 h 05 min». */
export function formatElapsed(ms: number): string {
  const dif = Math.max(0, ms);
  if (dif < MIN) return `${Math.floor(dif / SEG)} s`;
  if (dif < 10 * MIN) {
    const s = Math.floor((dif % MIN) / SEG);
    return s === 0 ? `${Math.floor(dif / MIN)} m` : `${Math.floor(dif / MIN)} m ${s} s`;
  }
  if (dif < HORA) return `${Math.floor(dif / MIN)} m`;
  return `${Math.floor(dif / HORA)} h ${String(Math.floor((dif % HORA) / MIN)).padStart(2, '0')} min`;
}

/** Tokens abreviados como en la barra de contexto: «950», «194k», «1,0M». */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** Tokens completos con separador de miles, para el texto accesible: «194 000». */
export function formatTokensFull(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Porcentaje como se escribe en el panel: «19 %». */
export function formatPercent(percent: number): string {
  return `${Math.round(percent)} %`;
}

const EFFORT_SHORT: Record<string, string> = { medium: 'med' };

/** Esfuerzo abreviado para la columna estrecha («medium» → «med»). */
export function shortEffort(effort: string): string {
  return EFFORT_SHORT[effort] ?? effort;
}

/** Hora local «14:02». */
export function formatClock(ms: number): string {
  return hora(new Date(ms));
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function hora(f: Date): string {
  return `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
}

function inicioDeDia(f: Date): number {
  return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();
}

/**
 * Hora de reinicio de un límite en la hora local: «hoy a las 21:20», «mañana a
 * las 05:00», «el viernes a las 05:00» (dentro de la semana) o «el 14 nov a las 05:00».
 */
export function formatReset(resetsAt: number, ahora: number): string {
  const cuando = new Date(resetsAt);
  // Se cuentan días de calendario locales (un día de verano puede durar 23 o 25 horas).
  const dias = Math.round((inicioDeDia(cuando) - inicioDeDia(new Date(ahora))) / DIA);
  const a = `a las ${hora(cuando)}`;
  if (dias <= 0) return `hoy ${a}`;
  if (dias === 1) return `mañana ${a}`;
  if (dias < 7) return `el ${DIAS[cuando.getDay()]} ${a}`;
  return `el ${cuando.getDate()} ${MESES[cuando.getMonth()]} ${a}`;
}

function limiteDe(valor: unknown): RateLimit | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const { percent, resetsAt } = valor as Record<string, unknown>;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  return { percent: Math.min(100, Math.max(0, percent)), resetsAt: typeof resetsAt === 'number' && Number.isFinite(resetsAt) ? resetsAt : null };
}

/** Límites de la cuenta de un mensaje del servidor (GET /api/account o evento `account`), leídos con cuidado. */
export function parseAccount(valor: unknown): AccountLimits | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const { fiveHour, sevenDay, updatedAt } = valor as Record<string, unknown>;
  const a: AccountLimits = {
    fiveHour: limiteDe(fiveHour),
    sevenDay: limiteDe(sevenDay),
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0,
  };
  return a.fiveHour || a.sevenDay ? a : null;
}

export type LimitView = {
  /** Porcentaje a pintar; null si la ventana ya se reinició y no hay dato nuevo. */
  percent: number | null;
  level: Level;
  /** «91 %» o «—». */
  text: string;
  /** «hoy a las 21:20», «ya se reinició» o '' si no se conoce. */
  reset: string;
};

export function limitView(limite: RateLimit, ahora: number): LimitView {
  const reiniciada = limite.resetsAt !== null && limite.resetsAt <= ahora;
  if (reiniciada) return { percent: null, level: 'neutral', text: '—', reset: 'ya se reinició' };
  return {
    percent: limite.percent,
    level: levelOf(limite.percent),
    text: formatPercent(limite.percent),
    reset: limite.resetsAt === null ? '' : formatReset(limite.resetsAt, ahora),
  };
}

export type LimitsView = {
  fiveHour: LimitView | null;
  sevenDay: LimitView | null;
  /** El más grave de los dos, para el borde del botón. */
  level: Level;
  /** Texto accesible del botón: «Límites de la cuenta: 5 horas al 3 %, se reinicia hoy a las 21:20; …». */
  label: string;
};

const NIVELES: Level[] = ['neutral', 'warn', 'critical'];

/** Vista de los límites de la cuenta; null si no hay ninguna ventana (el botón se oculta). */
export function limitsView(cuenta: AccountLimits | null, ahora: number): LimitsView | null {
  if (!cuenta || (!cuenta.fiveHour && !cuenta.sevenDay)) return null;
  const fiveHour = cuenta.fiveHour ? limitView(cuenta.fiveHour, ahora) : null;
  const sevenDay = cuenta.sevenDay ? limitView(cuenta.sevenDay, ahora) : null;
  const partes: string[] = [];
  for (const [nombre, v] of [
    ['5 horas', fiveHour],
    ['7 días', sevenDay],
  ] as const) {
    if (!v) continue;
    const reinicio = v.reset === 'ya se reinició' ? 'ya se reinició' : v.reset ? `se reinicia ${v.reset}` : '';
    partes.push(`${nombre}${v.percent === null ? ' sin dato' : ` al ${v.text}`}${reinicio ? `, ${reinicio}` : ''}`);
  }
  const nivel = [fiveHour?.level, sevenDay?.level].reduce<Level>(
    (peor, n) => (n && NIVELES.indexOf(n) > NIVELES.indexOf(peor) ? n : peor),
    'neutral',
  );
  return { fiveHour, sevenDay, level: nivel, label: `Límites de la cuenta: ${partes.join('; ')}` };
}

// ------------------------------------------------------------- Trabajo en curso

export type WorkCounts = { subagents: number; shells: number; artifacts: number };

export function workCounts(actividad: SessionActivity | null): WorkCounts {
  return {
    subagents: actividad?.subagents.length ?? 0,
    shells: actividad?.shells.length ?? 0,
    artifacts: actividad?.artifacts.length ?? 0,
  };
}

export function hasWork(c: WorkCounts): boolean {
  return c.subagents + c.shells + c.artifacts > 0;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export const subagentsLabel = (n: number) => plural(n, 'subagente', 'subagentes');
export const shellsLabel = (n: number) => plural(n, 'shell', 'shells');
export const artifactsLabel = (n: number) => plural(n, 'artifact', 'artifacts');

// Solo los dos formatos de enlace de artifact de claude.ai; el servidor ya filtra, pero
// el enlace se pinta como <a> y se vuelve a comprobar aquí.
const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+$/;
export const isArtifactUrl = (url: string): boolean => ARTIFACT_URL.test(url);

/** Texto de un artifact en la lista: su título o, sin él, el final del enlace. */
export function artifactLabel(a: { url: string; title: string | null }): string {
  return a.title ?? a.url.replace(/^https:\/\/claude\.ai\//, '');
}

// ------------------------------------------------------------------ Cabecera

/** Ancho de la terminal por debajo del cual la cabecera pasa a la versión estrecha. */
export const NARROW_BELOW_PX = 520;

export type ContextView = {
  percent: number | null;
  level: Level;
  /** «19 %» o «—». */
  text: string;
  /** «194k/1,0M»; '' si no se conocen los tokens. */
  tokens: string;
  /** Texto accesible del medidor: «19 %, 194 000 de 1 000 000 tokens». */
  valueText: string;
};

export function contextView(session: Pick<SessionInfo, 'usage'>): ContextView | null {
  const c = session.usage?.context;
  if (!c) return null;
  const nivel = levelOf(c.percent);
  const text = c.percent === null ? '—' : formatPercent(c.percent);
  const conTokens = c.used !== null && c.size !== null;
  return {
    percent: c.percent,
    level: nivel,
    text,
    tokens: conTokens ? `${formatTokens(c.used!)}/${formatTokens(c.size!)}` : '',
    valueText:
      c.percent === null
        ? 'sin datos todavía'
        : conTokens
          ? `${text}, ${formatTokensFull(c.used!)} de ${formatTokensFull(c.size!)} tokens`
          : text,
  };
}

export type Place = {
  /** Nombre del worktree; null en el checkout principal. */
  worktree: string | null;
  /** Rama, si se conoce. */
  branch: string | null;
};

/** Lugar de trabajo en una línea: «main», «principal» o «wt ts7 · feat/ts7». */
export function placeText(p: Place): string {
  if (p.worktree) return `wt ${p.worktree}${p.branch ? ` · ${p.branch}` : ''}`;
  return p.branch ?? 'principal';
}

/** Explicación del lugar para el título (atributo title) del elemento. */
export function placeTitle(p: Place): string {
  if (p.worktree) return `Worktree ${p.worktree}${p.branch ? `, rama ${p.branch}` : ''}`;
  return p.branch ? `Rama ${p.branch} en el checkout principal` : 'Checkout principal';
}

export type HeaderView = {
  place: Place;
  /** Modelo y esfuerzo («Opus 5.5» + «medium»), o el agente si no hay datos de Claude. */
  model: string;
  effort: string | null;
  elapsed: string;
  context: ContextView | null;
  stale: boolean;
  /** «hace 20 min» si está desactualizado, o ''. */
  ago: string;
  counts: WorkCounts;
};

/**
 * Datos de la cabecera de una terminal. Si Claude informa de un worktree y la
 * sesión no se abrió en uno (p. ej. Claude se movió a un worktree), se usa el suyo.
 */
export function headerView(session: SessionInfo, ahora: number): HeaderView {
  const uso = session.usage;
  const trabajando = visualState(session) === 'working';
  const wtClaude = !session.worktree && uso?.worktree ? uso.worktree : null;
  const place: Place = wtClaude
    ? { worktree: wtClaude.name, branch: wtClaude.branch }
    : { worktree: session.worktree || null, branch: session.branch };
  const stale = uso ? isStale(uso.updatedAt, ahora, trabajando) : false;
  return {
    place,
    model: uso?.model ?? (session.agent === 'shell' ? 'terminal' : session.agent),
    effort: uso?.model ? uso.effort : null,
    elapsed: formatDuration(ahora - session.created),
    context: contextView(session),
    stale,
    ago: stale && uso ? formatAgo(uso.updatedAt, ahora) : '',
    counts: workCounts(session.activity),
  };
}

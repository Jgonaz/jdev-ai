import type { HistoryEntry, HistoryState } from '../types.ts';
import { safeStorage } from './workspace.ts';

// Lógica pura de la pantalla Historial: filtros, grupos por día y textos de fecha.

export const STATE_OPTIONS: readonly Exclude<HistoryState, 'desconocido'>[] = ['en curso', 'bloqueada', 'finalizada'];

export type HistoryFilters = {
  /** Identificador del proyecto, o '' para todos. */
  project: string;
  /** Estado, o '' para todos. */
  state: HistoryState | '';
  /**
   * Solo entradas con algún pendiente sin marcar: por defecto, solo las
   * últimas de cada proyecto (los pendientes vigentes).
   */
  pending: boolean;
  /** Con `pending`, incluye también las entradas anteriores con pendientes abiertos. */
  includeOld: boolean;
};

export const NO_HISTORY_FILTERS: HistoryFilters = { project: '', state: '', pending: false, includeOld: false };

const FILTERS_KEY = 'jdev-panel:historial:filtros';

const esEstado = (v: unknown): v is HistoryState =>
  v === 'finalizada' || v === 'en curso' || v === 'bloqueada' || v === 'desconocido';

/** Filtros recordados; cualquier valor ilegible vuelve a «todos». */
export function loadHistoryFilters(storage: Pick<Storage, 'getItem'> | null = safeStorage()): HistoryFilters {
  try {
    const crudo = storage?.getItem(FILTERS_KEY);
    if (!crudo) return NO_HISTORY_FILTERS;
    const v = JSON.parse(crudo) as Record<string, unknown>;
    if (typeof v !== 'object' || v === null) return NO_HISTORY_FILTERS;
    return {
      project: typeof v.project === 'string' ? v.project : '',
      state: esEstado(v.state) ? v.state : '',
      pending: v.pending === true,
      // Los filtros guardados antes de existir la opción no la tienen: desactivada.
      includeOld: v.includeOld === true,
    };
  } catch {
    return NO_HISTORY_FILTERS;
  }
}

export function saveHistoryFilters(f: HistoryFilters, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // Almacenamiento bloqueado: solo se pierde el recuerdo.
  }
}

/**
 * Filtros con los que se abrirá Historial desde otra pantalla: parten de «sin
 * filtros» y aplican solo los indicados. La vista (por fecha o por proyecto)
 * se guarda aparte y se conserva.
 */
export function rememberHistoryFilters(
  parche: Partial<HistoryFilters> = {},
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  saveHistoryFilters({ ...NO_HISTORY_FILTERS, ...parche }, storage);
}

export const hasFilters = (f: HistoryFilters): boolean => f.project !== '' || f.state !== '' || f.pending;

/** Entradas que cumplen los filtros, solo de los proyectos indicados (los visibles). */
export function filterEntries(entries: readonly HistoryEntry[], f: HistoryFilters, projects?: ReadonlySet<string>): HistoryEntry[] {
  return entries.filter(
    (e) =>
      (!projects || projects.has(e.project)) &&
      (f.project === '' || e.project === f.project) &&
      (f.state === '' || e.state === f.state) &&
      (!f.pending || (e.openPending > 0 && (e.latest || f.includeOld))),
  );
}

/** Entrada anterior a la última de su proyecto con pendientes abiertos: no son vigentes. */
export const hasOldPending = (e: Pick<HistoryEntry, 'latest' | 'openPending'>): boolean => !e.latest && e.openPending > 0;

export type OldPendingSummary = {
  pending: number;
  entries: number;
  /** De ellas, entradas de proyectos fuera de `visibles` (ocultos en Ajustes). */
  hiddenEntries: number;
};

/**
 * Lo que marcaría la limpieza (POST /api/history/pending/mark-old): los
 * pendientes abiertos de las entradas que no son la última de su proyecto, de
 * `project` o, con '', de todos los proyectos (también los ocultos, como el servidor).
 */
export function oldPendingSummary(entries: readonly HistoryEntry[], project: string, visibles?: ReadonlySet<string>): OldPendingSummary {
  const r: OldPendingSummary = { pending: 0, entries: 0, hiddenEntries: 0 };
  for (const e of entries) {
    if ((project !== '' && e.project !== project) || !hasOldPending(e)) continue;
    r.pending += e.openPending;
    r.entries++;
    if (visibles && !visibles.has(e.project)) r.hiddenEntries++;
  }
  return r;
}

const cuenta = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «3 pendientes en 2 entradas». */
export const oldPendingCount = (s: { pending: number; entries: number }): string =>
  `${cuenta(s.pending, 'pendiente', 'pendientes')} en ${cuenta(s.entries, 'entrada', 'entradas')}`;

/** Aviso tras la limpieza: lo marcado y, si las hay, las entradas omitidas. */
export function markOldNotice(r: { marked: number; entries: number; skipped: readonly { file: string; reason: string }[] }): { kind: 'ok' | 'warn'; text: string } {
  const hecho =
    r.marked === 0
      ? 'No había pendientes antiguos que marcar.'
      : `${r.marked === 1 ? 'Marcado como hecho' : 'Marcados como hechos'} ${oldPendingCount({ pending: r.marked, entries: r.entries })}.`;
  if (r.skipped.length === 0) return { kind: 'ok', text: hecho };
  const omitidas = r.skipped.map((s) => `${s.file} (${s.reason.replace(/\.$/, '')})`).join('; ');
  return { kind: 'warn', text: `${hecho} ${r.skipped.length === 1 ? 'Se ha omitido' : `Se han omitido ${r.skipped.length} entradas`}: ${omitidas}.` };
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

const pad = (n: number) => String(n).padStart(2, '0');
const diaLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

type Partes = { y: number; m: number; d: number; time: string | null };

function partes(date: string): Partes | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?$/.exec(date);
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return { y: Number(m[1]), m: mes, d: Number(m[3]), time: m[4] ?? null };
}

/** Día `YYYY-MM-DD` de una fecha de entrada (o la propia cadena si no la entiende). */
export const entryDay = (date: string): string => date.slice(0, 10);

/** Hora `HH:MM` de una entrada, o '' si solo se conoce el día. */
export const entryTime = (date: string): string => partes(date)?.time ?? '';

/** «Hoy», «Ayer», «Viernes 31 de octubre» y, de otro año, «Viernes 31 de octubre de 2025». */
export function dayLabel(day: string, ahora = new Date()): string {
  const p = partes(day.slice(0, 10));
  if (!p) return day;
  const hoy = diaLocal(ahora);
  const ayer = diaLocal(new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 1));
  const clave = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  if (clave === hoy) return 'Hoy';
  if (clave === ayer) return 'Ayer';
  const semana = DIAS[new Date(p.y, p.m - 1, p.d).getDay()]!;
  const texto = `${semana[0]!.toUpperCase()}${semana.slice(1)} ${p.d} de ${MESES[p.m - 1]}`;
  return p.y === ahora.getFullYear() ? texto : `${texto} de ${p.y}`;
}

/** Fecha del lector: «31 oct 2026, 00:27» o «31 oct 2026» sin hora. */
export function longDate(date: string): string {
  const p = partes(date);
  if (!p) return date;
  const dia = `${p.d} ${MESES_CORTOS[p.m - 1]} ${p.y}`;
  return p.time ? `${dia}, ${p.time}` : dia;
}

/** Fecha de un pendiente hecho: «1 nov 2026». */
export const doneDateLabel = (day: string): string => longDate(day.slice(0, 10));

export type DayGroup = { day: string; label: string; entries: HistoryEntry[] };

/** Grupos por día en el orden recibido (el servidor ya ordena de más reciente a más antigua). */
export function groupByDay(entries: readonly HistoryEntry[], ahora = new Date()): DayGroup[] {
  const grupos: DayGroup[] = [];
  for (const e of entries) {
    const day = entryDay(e.date);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.day === day) ultimo.entries.push(e);
    else grupos.push({ day, label: dayLabel(day, ahora), entries: [e] });
  }
  return grupos;
}

/** Proyectos con entradas: el harness primero y el resto por nombre, sin distinguir mayúsculas. */
export function projectOptions(entries: readonly HistoryEntry[], harness?: string | null): string[] {
  const con = new Set(entries.map((e) => e.project));
  const resto = [...con].filter((p) => p !== harness).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0));
  return harness && con.has(harness) ? [harness, ...resto] : resto;
}

/** Sufijo de la clase CSS del estado (`hstate--curso`…). */
export const stateClass = (s: HistoryState): string => (s === 'en curso' ? 'curso' : s);

/** Texto del estado; el desconocido se muestra como «sin estado». */
export const stateText = (s: HistoryState): string => (s === 'desconocido' ? 'sin estado' : s);

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

// Fuera del código en línea: imágenes y enlaces por su texto, sin etiquetas
// HTML ni énfasis, y con las entidades básicas decodificadas.
const sinMarcas = (s: string): string =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/g, '$1$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, n: string) => ENTIDADES[n]!);

/**
 * Texto plano de un fragmento de Markdown en línea, para la lista: sin
 * comillas invertidas (el código se deja tal cual), enlaces e imágenes por su
 * texto, sin etiquetas HTML ni marcas de énfasis.
 */
export function plainText(s: string): string {
  return s
    .split(/(`[^`]*`)/)
    .map((trozo, i) => (i % 2 === 1 ? trozo.slice(1, -1) : sinMarcas(trozo)))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prompt de «Retomar desde aquí». */
export const resumePrompt = (file: string): string =>
  `Ponte al día con la entrada del historial \`.agent/history/${file}\` y sigue su continuación recomendada.`;

/**
 * Decide si el lector recarga la entrada porque la lista trae otro etag. Solo
 * reacciona a un etag de lista que aún no se haya tratado (`handled`), así que
 * actualizar el detalle nunca provoca otra recarga. Mientras no hay detalle o
 * se está marcando, espera sin darlo por tratado.
 */
export function listReload(s: {
  listEtag: string | undefined;
  handled: string | undefined;
  detailEtag: string | undefined;
  busy: boolean;
}): { reload: boolean; handled: string | undefined } {
  if (s.listEtag === undefined || s.listEtag === s.handled || s.detailEtag === undefined || s.busy) {
    return { reload: false, handled: s.handled };
  }
  return { reload: s.listEtag !== s.detailEtag, handled: s.listEtag };
}

/** Clave única de una entrada en la lista. */
export const entryKey = (e: { project: string; file: string }): string => `${e.project}/${e.file}`;

// ---------- Vista de la lista: por fecha o por proyecto ----------

export type HistoryView = 'date' | 'project';

const VIEW_KEY = 'jdev-panel:historial:vista';

/** Vista recordada de la lista; cualquier valor ilegible vuelve a «por fecha». */
export function loadHistoryView(storage: Pick<Storage, 'getItem'> | null = safeStorage()): HistoryView {
  try {
    return storage?.getItem(VIEW_KEY) === 'project' ? 'project' : 'date';
  } catch {
    return 'date';
  }
}

export function saveHistoryView(v: HistoryView, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(VIEW_KEY, v);
  } catch {
    // Sin almacenamiento (modo privado, cuota): la vista no se recuerda.
  }
}

/** Entradas visibles de un grupo plegado, como en Sesiones recientes. */
export const HISTORY_COLLAPSED = 3;

export type ProjectGroup = { project: string; entries: HistoryEntry[] };

/**
 * Grupos por proyecto. Conserva el orden recibido dentro de cada grupo (de más
 * reciente a más antigua) y ordena los grupos por su entrada más reciente.
 */
export function groupByProject(entries: readonly HistoryEntry[]): ProjectGroup[] {
  const grupos = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const lista = grupos.get(e.project);
    if (lista) lista.push(e);
    else grupos.set(e.project, [e]);
  }
  // El servidor ya entrega de más reciente a más antigua: el orden de aparición
  // del primer elemento de cada proyecto es el orden por actividad.
  return [...grupos].map(([project, lista]) => ({ project, entries: lista }));
}

/** Entradas a mostrar de un grupo: todas si está desplegado o si la seleccionada quedaría oculta. */
export function visibleInGroup(
  entries: readonly HistoryEntry[],
  expanded: boolean,
  selectedKey: string | null,
): { shown: HistoryEntry[]; hidden: number } {
  const contieneOculta = selectedKey !== null && entries.slice(HISTORY_COLLAPSED).some((e) => entryKey(e) === selectedKey);
  const shown = expanded || contieneOculta ? [...entries] : entries.slice(0, HISTORY_COLLAPSED);
  return { shown, hidden: entries.length - shown.length };
}

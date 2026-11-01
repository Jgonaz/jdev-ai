import type { BacklogItem, BacklogState, BacklogWarning } from '../types.ts';
import { safeStorage } from './workspace.ts';

// Lógica pura de la pantalla Proyectos: agrupación, filtros, transiciones y
// formatos. Las transiciones reflejan las de panel/server/backlog.ts.

export const STATES: readonly BacklogState[] = ['backlog', 'todo', 'in-progress', 'done', 'discarded'];
export const OPEN_STATES: readonly BacklogState[] = ['backlog', 'todo', 'in-progress'];

/** Nombre de cada estado en la interfaz (en minúsculas, como en el diseño). */
export const STATE_LABELS: Record<BacklogState, string> = {
  backlog: 'backlog',
  todo: 'por hacer',
  'in-progress': 'en curso',
  done: 'hecho',
  discarded: 'descartado',
};

export const STATE_HINTS: Partial<Record<BacklogState, string>> = {
  backlog: 'Por revisar antes de decidir. Aquí entra todo lo nuevo.',
  todo: 'Revisado y elegido para abordar pronto.',
};

// rules/backlog.md más las vueltas atrás para deshacer errores; done ↔ discarded no.
const TRANSITIONS: Record<BacklogState, readonly BacklogState[]> = {
  backlog: ['todo', 'in-progress', 'done', 'discarded'],
  todo: ['in-progress', 'done', 'discarded', 'backlog'],
  'in-progress': ['done', 'discarded', 'todo', 'backlog'],
  done: ['backlog', 'todo', 'in-progress'],
  discarded: ['backlog', 'todo', 'in-progress'],
};

/** Destinos a los que el servidor acepta mover un elemento desde `from`. */
export const allowedTargets = (from: BacklogState): readonly BacklogState[] => TRANSITIONS[from];

export type Grouped = Record<BacklogState, BacklogItem[]>;

/**
 * Agrupa por estado (la carpeta) y ordena cada grupo: abiertos por prioridad
 * (alta primero) y fecha de creación descendente, a igualdad por id; cerrados
 * por última actualización descendente y, a igualdad, por id descendente (el id
 * empieza por la fecha y la hora de creación: el más reciente primero).
 */
export function groupByState(items: readonly BacklogItem[]): Grouped {
  const grupos: Grouped = { backlog: [], todo: [], 'in-progress': [], done: [], discarded: [] };
  for (const it of items) grupos[it.status].push(it);
  const fecha = (v: string | null) => v ?? '';
  for (const s of STATES) {
    const abierto = OPEN_STATES.includes(s);
    grupos[s].sort((a, b) => {
      if (abierto) {
        const p = priorityRank(b.priority) - priorityRank(a.priority);
        if (p !== 0) return p;
        const c = fecha(b.created).localeCompare(fecha(a.created));
        if (c !== 0) return c;
      } else {
        const u = fecha(b.updated ?? b.created).localeCompare(fecha(a.updated ?? a.created));
        if (u !== 0) return u;
        return b.id.localeCompare(a.id);
      }
      return a.id.localeCompare(b.id);
    });
  }
  return grupos;
}

/**
 * Texto de una columna (o subcolumna) vacía: si hay elementos en ese estado
 * pero los filtros los ocultan, se dice para no confundirlo con un estado vacío.
 */
export const emptyColumnText = (filtered: boolean, total: number): string =>
  filtered && total > 0 ? 'Sin coincidencias con los filtros.' : 'Nada por aquí.';

/** Elementos abiertos (backlog, por hacer y en curso). */
export const openCount = (items: readonly BacklogItem[]): number => items.filter((i) => OPEN_STATES.includes(i.status)).length;

// ------------------------------------------------------------------ Filtros

export type Filters = { text: string; type: string; priority: string };
export const NO_FILTERS: Filters = { text: '', type: '', priority: '' };

/** Sin acentos ni mayúsculas, para que «guia» encuentre «Guía». */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Filtra por tipo, prioridad y texto (en título, identificador y resumen; todas las palabras). */
export function filterItems(items: readonly BacklogItem[], f: Filters): BacklogItem[] {
  const palabras = fold(f.text).split(/\s+/).filter((p) => p !== '');
  return items.filter((i) => {
    if (f.type !== '' && (i.type ?? '') !== f.type) return false;
    if (f.priority !== '' && (i.priority ?? '') !== f.priority) return false;
    if (palabras.length === 0) return true;
    const heno = fold(`${i.title}\n${i.id}\n${i.summary ?? ''}`);
    return palabras.every((p) => heno.includes(p));
  });
}

const PRIORITY_ORDER = ['alta', 'media', 'baja'];

/** Valores distintos de tipo y prioridad presentes, para los selectores. */
export function filterOptions(items: readonly BacklogItem[]): { types: string[]; priorities: string[] } {
  const tipos = new Set<string>();
  const prioridades = new Set<string>();
  for (const i of items) {
    if (i.type) tipos.add(i.type);
    if (i.priority) prioridades.add(i.priority);
  }
  const ordenPrioridad = (a: string, b: string) => {
    const x = PRIORITY_ORDER.indexOf(a);
    const y = PRIORITY_ORDER.indexOf(b);
    return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a.localeCompare(b);
  };
  return { types: [...tipos].sort((a, b) => a.localeCompare(b)), priorities: [...prioridades].sort(ordenPrioridad) };
}

// ----------------------------------------------------------------- Formatos

/** 3 alta, 2 media, 1 baja, 0 sin prioridad o desconocida. */
export function priorityRank(p: string | null): number {
  switch (p ? fold(p) : '') {
    case 'alta':
      return 3;
    case 'media':
      return 2;
    case 'baja':
      return 1;
    default:
      return 0;
  }
}

/** Barras del diseño: ▂▁▁ baja, ▂▄▁ media, ▂▄▆ alta; null si no hay prioridad conocida. */
export function priorityBars(p: string | null): string | null {
  switch (priorityRank(p)) {
    case 3:
      return '▂▄▆';
    case 2:
      return '▂▄▁';
    case 1:
      return '▂▁▁';
    default:
      return null;
  }
}

/** «≈ 40 s de lectura», «≈ 1 min 30 s de lectura»; '' si no hay resumen. */
export function formatReadTime(segundos: number): string {
  if (!(segundos > 0)) return '';
  if (segundos < 60) return `≈ ${segundos} s de lectura`;
  const min = Math.floor(segundos / 60);
  const s = segundos % 60;
  return s === 0 ? `≈ ${min} min de lectura` : `≈ ${min} min ${s} s de lectura`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/**
 * Fecha corta del diseño («24 oct»), con el año si no es el actual
 * («24 oct 2025»). Un valor que no sea AAAA-MM-DD se devuelve tal cual.
 */
export function shortDate(v: string | null, hoy = new Date()): string {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const mes = MESES[Number(m[2]) - 1];
  if (!mes) return v;
  const dia = String(Number(m[3]));
  return Number(m[1]) === hoy.getFullYear() ? `${dia} ${mes}` : `${dia} ${mes} ${m[1]}`;
}

/** Fecha corta a partir de milisegundos (guías). */
export function shortDateMs(ms: number, hoy = new Date()): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return shortDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hoy);
}

export const WARNING_TEXTS: Record<BacklogWarning, string> = {
  legacy: 'Formato antiguo: no tiene cabecera YAML. Se muestra tal cual, pero hay que migrarlo al formato actual de rules/backlog.md para poder moverlo desde el panel.',
  'invalid-yaml': 'La cabecera YAML no es válida: corrígela para poder moverlo desde el panel.',
  'status-mismatch': 'El campo status de la cabecera no coincide con la carpeta. Manda la carpeta: se muestra en la columna de su carpeta.',
  'id-mismatch': 'El campo id de la cabecera no coincide con el nombre del archivo.',
};

/** Avisos que se muestran en el detalle (invalid-yaml ya explica el formato antiguo). */
export function visibleWarnings(w: readonly BacklogWarning[]): BacklogWarning[] {
  return w.includes('invalid-yaml') ? w.filter((x) => x !== 'legacy') : [...w];
}

/** Prompt de «Trabajar en esto». */
export const workPrompt = (it: { id: string; title: string }, path: string): string =>
  `Aborda el elemento del backlog ${it.id} (${path}): ${it.title}`;

// ------------------------------------------------------------- Markdown del detalle

/** Texto de la cabecera YAML (sin los `---`), o null si no hay. */
export function headerText(source: string): string | null {
  const apertura = /^﻿?---[ \t]*\r?\n/.exec(source);
  if (!apertura) return null;
  const resto = source.slice(apertura[0].length);
  const cierre = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(resto);
  return cierre ? resto.slice(0, cierre.index).replace(/\r?\n$/, '') : null;
}

/**
 * Cuerpo sin la sección `## Resumen` hasta su primer párrafo incluido (el
 * resumen ya se muestra destacado). Si la sección tiene más contenido, se
 * conserva tras el título.
 */
export function detailWithoutSummary(body: string): string {
  const lineas = body.split(/\r?\n/);
  let enCodigo = false;
  let i = 0;
  for (; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (/^\s{0,3}(```|~~~)/.test(l)) enCodigo = !enCodigo;
    else if (!enCodigo && /^##[ \t]+resumen[ \t]*#*[ \t]*$/i.test(l.trim())) break;
  }
  if (i >= lineas.length) return body.trim();
  let j = i + 1;
  while (j < lineas.length && lineas[j]!.trim() === '') j++;
  while (j < lineas.length && lineas[j]!.trim() !== '' && !/^#{1,6}[ \t]/.test(lineas[j]!)) j++;
  return [...lineas.slice(0, i), ...lineas.slice(j)].join('\n').trim();
}

// ----------------------------------------------------------------- Preferencias

const LAST_PROJECT_KEY = 'jdev-panel:proyectos:last';

export function loadLastProject(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string | null {
  try {
    const v = storage?.getItem(LAST_PROJECT_KEY);
    return typeof v === 'string' && v !== '' ? v : null;
  } catch {
    return null;
  }
}

export function saveLastProject(id: string, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Almacenamiento bloqueado: solo se pierde el recuerdo.
  }
}

/** Proyecto a mostrar: el pedido si existe; si no, el último usado o el primero. */
export function pickProject(ids: readonly string[], pedido: string | null, ultimo: string | null): string | null {
  if (pedido && ids.includes(pedido)) return pedido;
  if (ultimo && ids.includes(ultimo)) return ultimo;
  return ids[0] ?? null;
}

/**
 * Ruta absoluta de una imagen del Markdown: absoluta tal cual o relativa a la
 * carpeta del documento (`dir`, absoluta), resolviendo `.` y `..`. Con `~` o
 * sin carpeta base devuelve null. El servidor decide luego si la entrega.
 */
export function resolveLocalPath(dir: string, ruta: string): string | null {
  const r = ruta.split(/[?#]/)[0]!.trim();
  if (r === '' || r.startsWith('~')) return null;
  let completa: string;
  if (r.startsWith('/')) completa = r;
  else if (dir.startsWith('/')) completa = `${dir}/${r}`;
  else return null;
  const partes: string[] = [];
  for (const p of completa.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') partes.pop();
    else partes.push(p);
  }
  try {
    return '/' + partes.map((p) => decodeURIComponent(p)).join('/');
  } catch {
    return '/' + partes.join('/');
  }
}

/** «1 cambio del backlog sin commit», «3 cambios del backlog sin commit»; '' si no hay. */
export const pendingLabel = (n: number): string =>
  n <= 0 ? '' : n === 1 ? '1 cambio del backlog sin commit' : `${n} cambios del backlog sin commit`;

/** «+2 / −1» respecto a la rama base; null si no se sabe. */
export function aheadBehind(ahead: number | null, behind: number | null): string | null {
  if (ahead === null || behind === null) return null;
  return `+${ahead} / −${behind}`;
}

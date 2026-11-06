import type { HistoryState, OverviewProject, ProjectInfo, SessionInfo } from '../types.ts';
import { entryDay, entryTime, stateText } from './history.ts';
import { isShell, visualState } from './sessions.ts';
import { formatRelative, greeting, shiftOf } from './time.ts';

// Lógica pura de la pantalla Inicio: saludo, resumen, atención y orden de proyectos.

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const pad = (n: number) => String(n).padStart(2, '0');

/** «$ turno de mañana · dom 01 nov». */
export function shiftLine(ahora: Date): string {
  return `$ turno de ${shiftOf(ahora)} · ${DIAS_CORTOS[ahora.getDay()]} ${pad(ahora.getDate())} ${MESES_CORTOS[ahora.getMonth()]}`;
}

/** Nombre del saludo: el de Ajustes (sin espacios sobrantes) o, si está vacío, el de Git. */
export function displayName(perfil: string, gitName: string | null): string | null {
  return perfil.trim() || gitName?.trim() || null;
}

/** Título de Inicio: el saludo con el nombre o, con el saludo desactivado, «Inicio». */
export function inicioTitle(ahora: Date, nombre: string | null, conSaludo: boolean): string {
  if (!conSaludo) return 'Inicio';
  const saludo = greeting(ahora);
  return nombre ? `${saludo}, ${nombre}` : saludo;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «5 proyectos en el taller · 8 sesiones · 2 worktrees abiertos». */
export function summaryLine(proyectos: number, sesiones: number, worktrees: number): string {
  return [
    `${plural(proyectos, 'proyecto', 'proyectos')} en el taller`,
    plural(sesiones, 'sesión', 'sesiones'),
    plural(worktrees, 'worktree abierto', 'worktrees abiertos'),
  ].join(' · ');
}

/**
 * Sesiones que cuentan en Inicio (recuentos, chips y tarjetas de proyecto): las
 * archivadas no, salvo las que esperan a la persona, que siguen contando como en
 * la cabecera y el título de la pestaña. Las terminales sin agente tampoco: no
 * son trabajo de un agente.
 */
export function countedSessions(sesiones: readonly SessionInfo[]): SessionInfo[] {
  return sesiones.filter((s) => !isShell(s) && (!s.archived || visualState(s) === 'waiting'));
}

export type StateCounts = { waiting: number; working: number; resting: number };

/**
 * Sesiones que esperan, que trabajan y en reposo. Las que esperan cuentan
 * siempre, también las de proyectos ocultos (el mismo criterio que la cabecera
 * y el título de la pestaña); las que trabajan y reposan, solo las de
 * `visibles` (todas si no se indica). En reposo son las inactivas, hechas o
 * no, cuyo proceso sigue vivo; no cuentan las terminadas ni las que no
 * informan de turnos.
 */
export function stateCounts(sesiones: readonly SessionInfo[], visibles?: ReadonlySet<string>): StateCounts {
  const c = { waiting: 0, working: 0, resting: 0 };
  for (const s of sesiones) {
    const v = visualState(s);
    if (v === 'waiting') {
      c.waiting++;
      continue;
    }
    if (visibles && !visibles.has(s.project)) continue;
    if (v === 'working') c.working++;
    else if (v === 'idle' || (v === 'done' && s.alive && s.state !== 'ended')) c.resting++;
  }
  return c;
}

export const waitingChip = (n: number): string => (n === 1 ? '1 te espera' : `${n} te esperan`);
export const workingChip = (n: number): string => `${n} trabajando`;
export const restingChip = (n: number): string => `${n} en reposo`;

/** «hace 3 min», «hace 2 h», «ayer», «ahora». */
export function relativeText(desde: number, ahora: number): string {
  const r = formatRelative(desde, ahora);
  return r === 'ahora' || r === 'ayer' ? r : `hace ${r}`;
}

export type AttentionItem =
  /** `hidden`: la sesión es de un proyecto oculto en Ajustes; `archived`: la persona la archivó. */
  | { kind: 'waiting'; session: SessionInfo; hidden: boolean; archived: boolean }
  | { kind: 'done'; session: SessionInfo }
  | { kind: 'pending'; openPending: number; entries: number };

/**
 * «Necesita tu atención», en orden: las sesiones que te esperan (la que lleva
 * más tiempo esperando, primero), las marcadas como hechas que siguen
 * abiertas (no las archivadas, que la persona ya apartó) y el resumen de pendientes del historial. Las que esperan salen
 * todas, marcadas si su proyecto está en `ocultos` o si están archivadas; las hechas, solo las de
 * proyectos `visibles`.
 */
export function attentionItems(
  sesiones: readonly SessionInfo[],
  visibles: ReadonlySet<string>,
  historial: { openPending: number; entriesWithPending: number } | null,
  ocultos: ReadonlySet<string> = new Set(),
): AttentionItem[] {
  const porAntiguedad = (a: SessionInfo, b: SessionInfo) => a.updatedAt - b.updatedAt || a.name.localeCompare(b.name);
  const items: AttentionItem[] = [
    ...sesiones
      .filter((s) => visualState(s) === 'waiting')
      .sort(porAntiguedad)
      .map((session) => ({ kind: 'waiting' as const, session, hidden: ocultos.has(session.project), archived: session.archived })),
    ...sesiones
      .filter((s) => visibles.has(s.project) && !s.archived && visualState(s) === 'done' && s.alive)
      .sort(porAntiguedad)
      .map((session) => ({ kind: 'done' as const, session })),
  ];
  if (historial && historial.openPending > 0) {
    items.push({ kind: 'pending', openPending: historial.openPending, entries: historial.entriesWithPending });
  }
  return items;
}

/** «3 pendientes de ti»: solo los vigentes, los de la última entrada de cada proyecto. */
export function pendingText(abiertos: number): string {
  return `${plural(abiertos, 'pendiente', 'pendientes')} de ti`;
}

/** Subtítulo de los pendientes vigentes: de dónde salen y de cuántos proyectos. */
export function pendingSource(entradas: number): string {
  return entradas === 1
    ? 'En la última entrada del historial de un proyecto.'
    : `En la última entrada del historial de cada proyecto (${entradas} proyectos).`;
}

export type ProjectCard = {
  project: ProjectInfo;
  overview: OverviewProject;
  sessions: SessionInfo[];
  /** La última actividad, con las sesiones en vivo. */
  lastActivity: number;
};

/**
 * Tarjetas de los proyectos visibles con resumen, de la actividad más reciente
 * a la más antigua (a igualdad, por nombre). La actividad del servidor se
 * completa con las sesiones en vivo, que llegan antes que un resumen nuevo.
 */
export function projectCards(
  proyectos: readonly ProjectInfo[],
  resumen: readonly OverviewProject[],
  sesiones: readonly SessionInfo[],
): ProjectCard[] {
  const porId = new Map(resumen.map((o) => [o.id, o]));
  const tarjetas: ProjectCard[] = [];
  for (const project of proyectos) {
    const overview = porId.get(project.id);
    if (!project.visible || !overview) continue;
    const propias = sesiones.filter((s) => s.project === project.id);
    const lastActivity = propias.reduce((m, s) => Math.max(m, s.updatedAt), overview.lastActivity);
    tarjetas.push({ project, overview, sessions: propias, lastActivity });
  }
  return tarjetas.sort((a, b) => b.lastActivity - a.lastActivity || a.project.name.localeCompare(b.project.name));
}

/** «Título · en curso» del último registro; sin estado si no lo tiene. */
export function lastEntryText(e: { title: string; state: HistoryState }): string {
  return e.state === 'desconocido' ? e.title : `${e.title} · ${stateText(e.state)}`;
}

/** Fecha de «Actividad reciente»: «hoy 10:02», «31 oct» o, de otro año, «31 oct 2025». */
export function activityWhen(date: string, ahora: Date): string {
  const dia = entryDay(date);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return date;
  const hoy = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  if (dia === hoy) {
    const hora = entryTime(date);
    return hora ? `hoy ${hora}` : 'hoy';
  }
  const mes = MESES_CORTOS[Number(m[2]) - 1];
  if (!mes) return date;
  const texto = `${Number(m[3])} ${mes}`;
  return Number(m[1]) === ahora.getFullYear() ? texto : `${texto} ${m[1]}`;
}

/** Sesión que se activa al abrir las terminales de un proyecto: la que espera, la que trabaja o la más reciente. */
export function preferredSession(sesiones: readonly SessionInfo[]): SessionInfo | null {
  const rango = (s: SessionInfo) => {
    const v = visualState(s);
    return v === 'waiting' ? 0 : v === 'working' ? 1 : v === 'ended' ? 3 : 2;
  };
  return [...sesiones].sort((a, b) => rango(a) - rango(b) || b.updatedAt - a.updatedAt)[0] ?? null;
}

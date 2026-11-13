// Lo que dibuja el mapa de actividad, calculado a partir de `buildBoard`: geometría de las estaciones, radios, ruta,
// halos, pulsos, textos de las filas y formato de las duraciones. Funciones puras y sin DOM: el componente solo pinta.
//
// La geometría y los tiempos (círculo de radio 118, discos de 40 px, núcleo de 41, anillo de contexto de 50, ruta en
// curvas cuadráticas, halos y manecillas) siguen el diseño aprobado en Claude Design, que adapta el dibujo de
// `hooks/draw.ts` de lot-map (https://github.com/alexeyw/lot-map, MIT, © 2026 Aleksei Volodin; su aviso completo va
// en `shared/stations.ts`).

import type { AgentEvent } from '../../shared/follow.ts';
import { STATIONS } from '../../shared/stations.ts';
import type { Station } from '../../shared/stations.ts';
import { ROUTE_FADE_MS, ROUTE_VISIBLE_MS, stationOf } from './activityMap.ts';
import type { Board, BoardRow, RouteStop } from './activityMap.ts';
import { formatPercent, levelOf } from './statusline.ts';
import type { Level } from './statusline.ts';

// ---------------------------------------------------------------------- Geometría

export const MAP_W = 312;
export const MAP_H = 330;
const CX = 156;
const CY = 163;
/** Radio del círculo donde se colocan las estaciones. */
const RADIO = 118;
/** Radio del disco de una estación. */
const DISCO = 20;
/** Radio del anillo de contexto, que es donde nacen los radios. */
const ANILLO = 50;
/** Centro del mapa. */
export const CENTRO = { x: CX, y: CY };
export const ANILLO_R = ANILLO;
/** Radio del núcleo. */
export const NUCLEO_R = 41;
/** Distancia de los puntos de subagentes al centro de su estación. */
const ORBITA = 27;
/** Los puntos de subagentes que se dibujan como mucho. */
const MAX_PUNTOS = 8;
/** Usos a partir de los cuales el radio de una estación ya no engorda más. */
const USOS_MAX = 30;
/** Cuánto sigue «encendida» una estación tras su último uso (el polling llega con ~1 s de retraso). */
export const LIT_MS = 3000;

const r1 = (n: number): number => Math.round(n * 10) / 10;

export type Point = { x: number; y: number; c: number; s: number };

/** Centro de una estación (y el coseno y seno de su ángulo): las nueve van de 40 en 40 grados desde arriba. */
export function stationPoint(id: Station): Point {
  const a = ((-90 + STATIONS.indexOf(id) * 40) * Math.PI) / 180;
  return { x: r1(CX + RADIO * Math.cos(a)), y: r1(CY + RADIO * Math.sin(a)), c: Math.cos(a), s: Math.sin(a) };
}

/** Tramo recto entre el borde del anillo de contexto y el borde del disco de la estación: por donde corren el radio y los pulsos. */
export function spokeEnds(id: Station): { x1: number; y1: number; x2: number; y2: number } {
  const o = stationPoint(id);
  return { x1: r1(CX + ANILLO * o.c), y1: r1(CY + ANILLO * o.s), x2: r1(o.x - DISCO * o.c), y2: r1(o.y - DISCO * o.s) };
}

export const STATION_NAMES: Record<Station, string> = {
  tu: 'Tú',
  modelo: 'Modelo',
  memoria: 'Memoria',
  archivos: 'Archivos',
  shell: 'Shell',
  red: 'Red',
  navegador: 'Navegador',
  agentes: 'Agentes',
  skills: 'Skills',
};

/** Iconos de trazo (viewBox 24) del diseño. */
export const STATION_ICONS: Record<Station, string> = {
  tu: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 20c1.4-3.3 4.3-5 7.5-5s6.1 1.7 7.5 5',
  modelo:
    'M8.5 8.5h7v7h-7z M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M9.5 2v3 M14.5 2v3 M9.5 19v3 M14.5 19v3 M2 9.5h3 M2 14.5h3 M19 9.5h3 M19 14.5h3',
  memoria:
    'M12 7a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 12 7z M5.2 20.4a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z M18.8 20.4a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z M11 6.8l-4.8 9.4 M13 6.8l4.8 9.4 M7.4 18.2h9.2',
  archivos: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  shell: 'M5 7.5l4.5 4.5L5 16.5 M12.5 17h6.5',
  red: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9 M12 3C9.6 5.5 8.4 8.5 8.4 12s1.2 6.5 3.6 9',
  navegador: 'M4 4.5h16a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z M3 9h18',
  agentes:
    'M12 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M5.5 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18.5 21.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M12 7.5v4 M12 11.5l-5 5 M12 11.5l5 5',
  skills: 'M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z',
};

// ---------------------------------------------------------------------- Colores

/** Colores semánticos del mapa; cada uno es una variable del tema (nunca un color fijo). */
export type Tone = 'fg' | 'soft' | 'muted' | 'faint' | 'dim' | 'line' | 'idle' | 'used' | 'accent' | 'memory' | 'danger' | 'dangerText' | 'warn' | 'warnText';

const TONE_VARS: Record<Tone, string> = {
  fg: '--fg',
  soft: '--fg-soft',
  muted: '--fg-muted',
  faint: '--fg-faint',
  dim: '--fg-dim',
  line: '--line',
  idle: '--line-strong',
  used: '--line-card-active',
  accent: '--agent-claude',
  // Memoria: el tinte del enlace, que pasa contraste en los seis temas (el verdoso del diseño solo existe en Carbón y Papel).
  memory: '--link',
  danger: '--danger',
  dangerText: '--danger-text',
  warn: '--waiting',
  warnText: '--waiting-text',
};

/** El color de un tono, como valor CSS. */
export const toneColor = (t: Tone): string => `var(${TONE_VARS[t]})`;

// ---------------------------------------------------------------------- Estaciones

export type Halo = { x: number; y: number; tone: Tone; inner: string | null; outer: string | null };

export type StationView = {
  id: Station;
  name: string;
  icon: string;
  /** Esquina superior izquierda del bloque HTML (80 px de ancho) de la estación. */
  left: number;
  top: number;
  spoke: { x1: number; y1: number; x2: number; y2: number; tone: Tone; width: number; opacity: number };
  ring: Tone;
  iconTone: Tone;
  labelTone: Tone;
  uses: number;
  /** «14», o «↓2» en Memoria; '' si no se ha usado. */
  usesLabel: string;
  usesTone: Tone;
  /** «×3» con varias llamadas en marcha; '' si no. */
  count: string;
  errors: number;
  running: boolean;
  lit: boolean;
  halo: Halo | null;
};

/** Arco que parte de las 12 y recorre la fracción `f` de la circunferencia (0 < f < 1). */
export function arcPath(x: number, y: number, radio: number, f: number): string {
  const t = f * 2 * Math.PI - Math.PI / 2;
  return `M ${x} ${r1(y - radio)} A ${radio} ${radio} 0 ${f > 0.5 ? 1 : 0} 1 ${r1(x + radio * Math.cos(t))} ${r1(y + radio * Math.sin(t))}`;
}

export type StationOptions = {
  now: number;
  /** La sesión no trabaja ni espera: lo que no devolvió resultado quedó interrumpido y no cuenta como en marcha. */
  interrupted: boolean;
  /** Estaciones con un pulso de error en vuelo: su radio se tiñe de rojo. */
  errorPulses: ReadonlySet<Station>;
  /** La sesión trabaja sin ninguna llamada en marcha: el modelo está pensando y Modelo se enciende con halo, sin manecillas. */
  thinking?: boolean;
  /**
   * Subagentes activos según la cabecera. Los lanzados en segundo plano devuelven su resultado al instante, así que sin
   * esto Agentes no constaría «en marcha» mientras trabajan: cuenta el mayor de los dos números.
   */
  subagents?: number;
};

export function stationViews(board: Board, { now, interrupted, errorPulses, thinking = false, subagents = 0 }: StationOptions): StationView[] {
  return STATIONS.map((id) => {
    const st = board.stations[id];
    const o = stationPoint(id);
    const uses = st.uses;
    const norm = Math.min(uses, USOS_MAX) / USOS_MAX;
    const enCurso = interrupted ? 0 : Math.max(st.running.length, id === 'agentes' ? subagents : 0);
    const enMarcha = enCurso > 0;
    const piensa = thinking && id === 'modelo';
    const lit = !enMarcha && !piensa && st.lastAt !== null && now - st.lastAt < LIT_MS;
    const tint: Tone = id === 'memoria' ? 'memory' : 'accent';
    const err = st.errors > 0;
    const errPulse = errorPulses.has(id);
    const activa = enMarcha || piensa || lit;
    const ends = spokeEnds(id);
    // Las manecillas cuentan lo que lleva la llamada más antigua: el interior da una vuelta por minuto y el exterior, por diez.
    // Un subagente en segundo plano no tiene llamada en marcha: sin duración conocida, no hay manecillas.
    const llevaMs = enMarcha && st.running.length > 0 ? st.running[0]!.elapsedMs : null;
    const sec = llevaMs === null ? 0 : llevaMs / 1000;
    const fi = (sec % 60) / 60;
    const fo = (sec % 600) / 600;
    return {
      id,
      name: STATION_NAMES[id],
      icon: STATION_ICONS[id],
      left: r1(o.x - 40),
      top: r1(o.y - DISCO),
      spoke: {
        ...ends,
        tone: enMarcha || piensa ? tint : errPulse ? 'danger' : lit ? tint : uses > 0 ? 'muted' : 'dim',
        width: r1(1 + norm * 3),
        opacity: enMarcha || piensa || errPulse ? 0.85 : lit ? 0.6 : uses > 0 ? r1(0.35 + 0.45 * norm) : 0.8,
      },
      ring: err ? 'danger' : activa ? tint : uses > 0 ? 'used' : 'idle',
      iconTone: err ? 'dangerText' : activa ? tint : uses > 0 ? 'soft' : 'faint',
      labelTone: activa ? 'fg' : uses > 0 ? 'soft' : 'faint',
      uses,
      usesLabel: uses > 0 ? `${id === 'memoria' ? '↓' : ''}${uses}` : '',
      usesTone: id === 'memoria' ? 'memory' : 'faint',
      count: enCurso > 1 ? `×${enCurso}` : '',
      errors: st.errors,
      running: enMarcha,
      lit,
      halo: enMarcha
        ? { x: o.x, y: o.y, tone: tint, inner: fi > 0.02 ? arcPath(o.x, o.y, 26, fi) : null, outer: fo > 0.02 ? arcPath(o.x, o.y, 30, fo) : null }
        : piensa
          ? { x: o.x, y: o.y, tone: tint, inner: null, outer: null }
          : null,
    };
  });
}

/** Puntos de subagentes alrededor de su estación: `n` repartidos por igual, a 27 px. Giran como un solo grupo. */
export function subagentDots(n: number): { x: number; y: number }[] {
  const o = stationPoint('agentes');
  const total = Math.min(Math.max(0, Math.floor(n)), MAX_PUNTOS);
  return Array.from({ length: total }, (_, k) => {
    const a = (k * 2 * Math.PI) / total;
    return { x: r1(o.x + ORBITA * Math.cos(a)), y: r1(o.y + ORBITA * Math.sin(a)) };
  });
}

// ---------------------------------------------------------------------- Ruta

export type Leg = { d: string; tone: 'accent' | 'soft'; width: number; opacity: number };

/** Cuánto se ve una parada a `now`: entera hasta `ROUTE_VISIBLE_MS` y luego se apaga durante `ROUTE_FADE_MS`. Sin hora, entera. */
export function routeFade(at: number | null, now: number): number {
  if (at === null) return 1;
  const edad = Math.max(0, now - at);
  if (edad <= ROUTE_VISIBLE_MS) return 1;
  return Math.max(0, 1 - (edad - ROUTE_VISIBLE_MS) / ROUTE_FADE_MS);
}

/** Los tramos entre paradas consecutivas, con curvas cuadráticas cuyo control se desplaza hacia el centro. El último va en acento. */
export function routeLegs(route: readonly RouteStop[], now: number): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = stationPoint(route[i - 1]!.station);
    const b = stationPoint(route[i]!.station);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const qx = r1(mx + (CX - mx) * 0.45);
    const qy = r1(my + (CY - my) * 0.45);
    const nuevo = i === route.length - 1;
    const opacity = r1((nuevo ? 0.85 : Math.max(0.18, 0.55 - (route.length - 1 - i) * 0.12)) * routeFade(route[i]!.at, now));
    if (opacity <= 0) continue;
    legs.push({ d: `M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`, tone: nuevo ? 'accent' : 'soft', width: nuevo ? 1.75 : 1.25, opacity });
  }
  return legs;
}

// ---------------------------------------------------------------------- Contexto

export type ContextRing = {
  /** `stroke-dasharray` del arco: lo gastado y lo que falta. */
  dash: string;
  ring: Tone;
  text: Tone;
  /** «34 %», o '' sin datos. */
  label: string;
};

const NIVEL_ANILLO: Record<Level, Tone> = { neutral: 'soft', warn: 'warn', critical: 'danger' };
const NIVEL_TEXTO: Record<Level, Tone> = { neutral: 'muted', warn: 'warnText', critical: 'dangerText' };

/** El anillo de contexto, con los mismos umbrales (y el mismo redondeo) que la barra de la cabecera. Sin dato, vacío y sin porcentaje. */
export function contextRing(percent: number | null): ContextRing {
  const c = 2 * Math.PI * ANILLO;
  const nivel = levelOf(percent);
  const f = percent === null ? 0 : Math.min(100, Math.max(0, percent)) / 100;
  return { dash: `${r1(c * f)} ${r1(c)}`, ring: NIVEL_ANILLO[nivel], text: NIVEL_TEXTO[nivel], label: percent === null ? '' : formatPercent(percent) };
}

// ---------------------------------------------------------------------- Pulsos

/** Lo que dura un pulso de ida o de vuelta. */
export const PULSE_MS = 1400;
/** Separación entre los pulsos de un mismo lote, para que no salgan todos a la vez. */
const PULSE_GAP_MS = 180;
/** Pulsos que se lanzan como mucho por lote de eventos: tras una pausa larga pueden llegar muchos de golpe. */
const PULSE_MAX = 8;

export type Pulse = {
  key: number;
  station: Station;
  /** `out` va del núcleo a la estación; `back`, de la estación al núcleo. */
  dir: 'out' | 'back';
  kind: 'ok' | 'error';
  /** Hora de inicio (`performance.now()`). */
  start: number;
};

/**
 * Los pulsos de los últimos `fresh` eventos de `events`. Una herramienta lanza un pulso de ida y su resultado, uno de vuelta
 * (rojo si falla) que espera a que termine el de ida del mismo lote; la persona y el modelo, uno que llega al núcleo.
 * `now` es la hora de inicio del primero y `firstKey` la clave del primero.
 */
export function planPulses(events: readonly AgentEvent[], fresh: number, now: number, firstKey: number): Pulse[] {
  const desde = Math.max(0, events.length - Math.max(0, fresh));
  const nuevos = events.slice(desde);
  if (nuevos.length === 0) return [];
  const lote = new Map<string, Station>();
  for (const e of nuevos) if (e.type === 'tool') lote.set(e.id, stationOf(e));
  // La llamada de un resultado puede ser anterior al lote: se busca hacia atrás solo si hace falta.
  const estacionDe = (id: string): Station | null => {
    const propia = lote.get(id);
    if (propia !== undefined) return propia;
    for (let i = desde - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === 'tool' && e.id === id) return stationOf(e);
    }
    return null;
  };
  const pulsos: Omit<Pulse, 'key'>[] = [];
  const idaDe = new Map<string, number>();
  let t = now;
  for (const e of nuevos) {
    let p: Omit<Pulse, 'key'> | null = null;
    if (e.type === 'tool') {
      p = { station: stationOf(e), dir: 'out', kind: 'ok', start: t };
      idaDe.set(e.id, t);
    } else if (e.type === 'result') {
      const station = estacionDe(e.id);
      if (station !== null) p = { station, dir: 'back', kind: e.error ? 'error' : 'ok', start: Math.max(t, (idaDe.get(e.id) ?? -Infinity) + PULSE_MS) };
    } else if (e.type === 'user' || e.type === 'command') {
      p = { station: 'tu', dir: 'back', kind: 'ok', start: t };
    } else if (e.type === 'message') {
      p = { station: 'modelo', dir: 'back', kind: 'ok', start: t };
    }
    if (p === null) continue;
    pulsos.push(p);
    t += PULSE_GAP_MS;
  }
  return pulsos.slice(-PULSE_MAX).map((p, i) => ({ ...p, key: firstKey + i }));
}

/** Dónde está un pulso (de 0 a 1 en su recorrido) a la hora `t`, o null si aún no ha salido o ya llegó. */
export function pulseProgress(p: Pulse, t: number): number | null {
  const f = (t - p.start) / PULSE_MS;
  return f < 0 || f >= 1 ? null : f;
}

/** Punto del recorrido de un pulso: de 0 (donde sale) a 1 (donde llega). */
export function pulsePoint(p: Pulse, f: number): { x: number; y: number } {
  const e = spokeEnds(p.station);
  const [ax, ay, bx, by] = p.dir === 'out' ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
  return { x: r1(ax + (bx - ax) * f), y: r1(ay + (by - ay) * f) };
}

// ---------------------------------------------------------------------- Filas y línea de ahora

const SEG = 1000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;

/** Duración de una llamada: «0,3 s», «42 s», «3 min», «4 min 12 s», «12 min», «1 h 05 min»; «—» si se desconoce. */
export function formatCallDuration(ms: number | null): string {
  if (ms === null) return '—';
  const d = Math.max(0, ms);
  if (d < 10 * SEG) {
    const decimas = Math.min(99, Math.max(1, Math.round(d / 100)));
    return `${Math.floor(decimas / 10)},${decimas % 10} s`;
  }
  if (d < MIN) return `${Math.floor(d / SEG)} s`;
  if (d < 10 * MIN) {
    const s = Math.floor((d % MIN) / SEG);
    return s === 0 ? `${Math.floor(d / MIN)} min` : `${Math.floor(d / MIN)} min ${s} s`;
  }
  if (d < HORA) return `${Math.floor(d / MIN)} min`;
  return `${Math.floor(d / HORA)} h ${String(Math.floor((d % HORA) / MIN)).padStart(2, '0')} min`;
}

const MAX_ETIQUETA = 36;
const recorta = (s: string): string => (s.length > MAX_ETIQUETA ? `${s.slice(0, MAX_ETIQUETA - 1)}…` : s);
/** El último tramo de una ruta, con barras de cualquier sistema, sin comillas y sin `.exe`. */
const nombreBase = (ruta: string): string =>
  (ruta.replace(/["']/g, '').split(/[\\/]/).filter(Boolean).pop() ?? '').replace(/\.(?:exe|cmd|bat)$/i, '');

const COMANDOS_NEUTROS = new Set(['cd', 'echo', 'printf', 'export', 'set', 'unset', 'true', 'pwd', 'sleep', 'which', 'test', '[', 'source', '.']);
const ENVOLTORIOS = new Set(['sudo', 'doas', 'env', 'time', 'nohup', 'nice', 'command', 'exec', 'timeout', 'xargs']);
const OPCIONES_CON_VALOR = new Set(['-u', '-g', '-h', '-p', '-C', '-n', '-s', '-k', '-I', '-P', '-L', '-d', '-E', '-a']);
/** Gestores y herramientas cuyo subcomando (`git status`, `pnpm test`) dice qué se hace sin enseñar argumentos. */
const CON_SUBCOMANDO = new Set(['git', 'pnpm', 'npm', 'yarn', 'bun', 'cargo', 'go', 'make', 'docker']);

/** El nombre del comando de una línea de shell («pnpm test», «gh»), nunca sus argumentos: pueden llevar secretos. '' si no se reconoce. */
export function commandName(linea: string): string {
  for (const tramo of linea.split(/&&|\|\||;|\|/)) {
    const palabras = tramo.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    let envuelto = false;
    for (; i < palabras.length; i++) {
      const w = palabras[i]!;
      if (/^[A-Za-z_]\w*=/.test(w)) continue;
      if (ENVOLTORIOS.has(nombreBase(w))) {
        envuelto = true;
        continue;
      }
      if (envuelto && w.startsWith('-')) {
        // Algunas opciones de los envoltorios llevan una palabra detrás (`sudo -u root`): no es el comando.
        if (OPCIONES_CON_VALOR.has(w)) i++;
        continue;
      }
      if (envuelto && /^\d+[smhd]?$/.test(w)) continue; // `timeout 5 cmd`
      break;
    }
    const primera = palabras[i];
    if (primera === undefined) continue;
    const nombre = nombreBase(primera);
    if (COMANDOS_NEUTROS.has(nombre)) continue;
    if (!/^[\w.+@-]+$/.test(nombre)) return '';
    const sub = palabras[i + 1];
    return CON_SUBCOMANDO.has(nombre) && sub !== undefined && /^[a-z][\w:-]{0,15}$/i.test(sub) ? `${nombre} ${sub}` : nombre;
  }
  return '';
}

/** El host de una URL, sin ruta ni consulta (que pueden llevar claves). '' si no se reconoce. */
export function hostOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host !== '') return host;
  } catch {
    // Sin esquema (`localhost:3000/x`): se lee a mano.
  }
  return /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/\s:?#]+)/i.exec(url.trim())?.[1] ?? '';
}

/** El nombre de la herramienta: en las de un servidor MCP, solo la herramienta (`mcp__playwright__browser_snapshot` es `browser_snapshot`). */
export function toolLabel(tool: string): string {
  const mcp = /^mcp__.+?__(.+)$/.exec(tool);
  return mcp ? mcp[1]! : tool;
}

/**
 * Lo que se enseña del objetivo de una llamada, solo nombres: el archivo (sin carpetas), el comando (sin argumentos), el host
 * de una URL, el servidor MCP, el patrón de un Glob o la descripción de un subagente. Del patrón de un Grep, que es lo que se
 * busca, solo se enseña dónde.
 */
export function targetLabel(tool: string, target: string): string {
  const t = target.trim();
  if (t === '') return '';
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return recorta(nombreBase(t));
    case 'Glob':
      return recorta((t.split(' en ')[0] ?? '').trim());
    case 'Grep': {
      const donde = / en (.+)$/.exec(t)?.[1];
      return donde === undefined ? '' : recorta(nombreBase(donde));
    }
    case 'Bash':
    case 'PowerShell':
      return recorta(commandName(t));
    case 'WebFetch':
      return recorta(hostOf(t));
    case 'Agent':
    case 'Task':
    case 'Skill':
      return recorta(t);
  }
  // Herramientas MCP: el servidor de «servidor · herramienta».
  return tool.startsWith('mcp__') ? recorta(t.split(' · ')[0] ?? '') : '';
}

export type RowGlyph = '●' | '·' | '✕';
export type ViewRowStatus = BoardRow['status'] | 'interrupted';

export type ViewRow = {
  id: string;
  status: ViewRowStatus;
  glyph: RowGlyph;
  glyphTone: Tone;
  station: string;
  tool: string;
  target: string;
  /** «+2» si agrupa varias llamadas; '' si no. */
  fold: string;
  time: string;
  timeTone: Tone;
  toolTone: Tone;
  targetTone: Tone;
  /** Texto para el lector de pantalla: lo que el glifo cuenta con la vista. */
  statusText: string;
};

const ESTADO_TEXTO: Record<ViewRowStatus, string> = { running: 'En marcha', done: 'Hecha', failed: 'Fallida', interrupted: 'Interrumpida' };

export function viewRows(board: Board, interrupted: boolean): ViewRow[] {
  return board.rows.map((r) => {
    const status: ViewRowStatus = r.status === 'running' && interrupted ? 'interrupted' : r.status;
    const fallida = status === 'failed';
    return {
      id: r.id,
      status,
      glyph: status === 'running' ? '●' : fallida ? '✕' : '·',
      glyphTone: status === 'running' ? 'accent' : fallida ? 'dangerText' : 'faint',
      station: STATION_NAMES[r.station],
      tool: toolLabel(r.tool),
      target: targetLabel(r.tool, r.target),
      fold: r.veces > 1 ? `+${r.veces - 1}` : '',
      time: status === 'interrupted' ? 'interrumpida' : formatCallDuration(r.durationMs),
      timeTone: status === 'running' ? 'accent' : 'faint',
      toolTone: fallida ? 'dangerText' : status === 'running' ? 'fg' : 'soft',
      targetTone: fallida ? 'dangerText' : 'muted',
      statusText: ESTADO_TEXTO[status],
    };
  });
}

export type NowLine = { glyph: '●' | '·'; tone: 'accent' | 'faint'; text: string; time: string };

/** La línea de «ahora»: lo que se ejecuta, la respuesta lista o la espera. `working` es que la sesión está trabajando. */
export function nowLine(
  board: Board,
  { interrupted, working, subagents = 0 }: { interrupted: boolean; working: boolean; subagents?: number },
): NowLine {
  const n = board.now;
  // Subagentes en segundo plano: su llamada ya devolvió resultado, pero siguen trabajando.
  if (n.kind !== 'running' && subagents > 0 && !interrupted) {
    return { glyph: '●', tone: 'accent', text: `Agentes · ${subagents} ${subagents === 1 ? 'subagente' : 'subagentes'} en marcha`, time: '' };
  }
  if (n.kind === 'running') {
    const sitio = STATION_NAMES[n.station];
    const que = targetLabel(n.tool, n.target) || toolLabel(n.tool);
    if (interrupted) return { glyph: '·', tone: 'faint', text: `Interrumpida · ${sitio} · ${que}`, time: '' };
    return { glyph: '●', tone: 'accent', text: `${sitio} · ${que}${n.others > 0 ? ` · +${n.others} en marcha` : ''}`, time: formatCallDuration(n.elapsedMs) };
  }
  if (n.kind === 'ready') return { glyph: '·', tone: 'faint', text: 'Respuesta lista', time: n.turnMs === null ? '' : formatCallDuration(n.turnMs) };
  if (board.rows.length === 0) return { glyph: '·', tone: 'faint', text: 'Esperando la primera herramienta', time: '' };
  return working ? { glyph: '●', tone: 'accent', text: 'Modelo · pensando la respuesta', time: '' } : { glyph: '·', tone: 'faint', text: 'Sin actividad', time: '' };
}

/**
 * ¿Hay que seguir repintando cada segundo? Sí mientras corran duraciones (llamadas en marcha), una estación siga encendida
 * o la ruta se esté apagando; en reposo, no hace falta ningún repintado.
 */
export function needsTick(board: Board, now: number, interrupted: boolean): boolean {
  for (const st of Object.values(board.stations)) {
    if (!interrupted && st.running.length > 0) return true;
    if (st.lastAt !== null && now - st.lastAt < LIT_MS + 1000) return true;
  }
  return board.route.some((p) => p.at !== null && routeFade(p.at, now) > 0);
}

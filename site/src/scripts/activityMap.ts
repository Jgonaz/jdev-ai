// Mapa de actividad de una sesión de Claude como cadena SVG. Es un módulo puro y sin DOM: Astro lo pinta en el servidor
// (así la página se ve sin JS) y el script del cliente lo vuelve a pintar al cambiar de paso o de sesión.
//
// La geometría (círculo de radio 118, discos de 40 px, núcleo de 41, anillo de contexto de 44, ruta en curvas
// cuadráticas, halos y manecillas), las reglas de color de cada estación y los umbrales del anillo de contexto
// reproducen `panel/src/lib/mapView.ts`, que adapta el dibujo de `hooks/draw.ts` de lot-map
// (https://github.com/alexeyw/lot-map). Se conserva su aviso de copyright y licencia:
//
//   MIT License
//
//   Copyright (c) 2026 Aleksei Volodin
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Cambios respecto al panel real: las etiquetas son `<text>` dentro del SVG (para que todo escale a la vez), el estado
// es una instantánea de ejemplo en vez de eventos en vivo y los pulsos, las órbitas y la onda son SMIL. Con `live` no
// hay SMIL: el dibujo deja marcados los pulsos, las manecillas y la órbita (`data-pulses`, `data-hand`, `data-orbit`)
// para que `panelSim.ts` los mueva cada fotograma sin volver a pintar el SVG, que reiniciaría la animación.
//
// Los colores van como `var(--…)`: los pone el tema del contenedor. Los estilos de texto y los elementos `.mp-anim`
// (que se animan también con movimiento reducido) están en `src/styles/global.css`.

export const STATIONS = ['tu', 'modelo', 'memoria', 'archivos', 'shell', 'red', 'navegador', 'agentes', 'skills'] as const;
export type Station = (typeof STATIONS)[number];

export const MAP_W = 312;
export const MAP_H = 362;
const CX = 156;
// Centro algo más bajo que la mitad: la etiqueta de Tú va encima de su disco, por fuera del halo.
const CY = 184;
const RADIO = 118;
const DISCO = 20;
// Anillo de contexto pegado al núcleo (su trazo de 3 va de 42,5 a 45,5): así los radios no pasan entre los dos.
const ANILLO = 44;
const NUCLEO = 41;
const ORBITA = 27;
const MAX_PUNTOS = 8;
// Usos a partir de los cuales el radio de una estación ya no engorda más.
const USOS_MAX = 30;
const PULSO_S = 1.4;
const WARN_AT = 50;
const CRITICAL_AT = 80;

/** Iconos de trazo (viewBox 24) de las estaciones, los mismos del panel real. */
const ICONS: Record<Station, string> = {
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

// ---------------------------------------------------------------------- Estado

export type Pulse = {
  /** Estación a la que va el pulso (`out`, del núcleo a ella) o de la que vuelve (`back`). */
  to: Station;
  dir: 'out' | 'back';
  kind: 'ok' | 'error';
  /** Segundos que tarda en salir tras pintar el mapa. */
  begin: number;
};

export type MapState = {
  /** Usos por estación; el radio engorda hasta 30. */
  uses: Partial<Record<Station, number>>;
  /** Llamadas en marcha: cuántas y los segundos de la más antigua (null: sin duración conocida, sin manecillas). */
  running: Partial<Record<Station, { count: number; sec: number | null }>>;
  /** Estaciones encendidas hace un momento, sin llamada en marcha. */
  lit: Station[];
  /** El modelo piensa sin ninguna llamada en marcha: Modelo se enciende con halo y sin manecillas. */
  thinking?: boolean;
  errors: Partial<Record<Station, number>>;
  /** Últimas paradas, de la más antigua a la más reciente. */
  route: Station[];
  /** De 0 a 1: cuánto se ve la ruta mientras se apaga. */
  fade: number;
  pulses: Pulse[];
  /** Subagentes activos: giran como puntos alrededor de Agentes. */
  subagents: number;
  /** Onda al pasar a «respuesta lista». */
  wave: boolean;
  /** Contexto usado, de 0 a 100; null si no se conoce. */
  ctx: number | null;
  model: string;
};

export type MapOptions = {
  /** Nombres visibles de las estaciones, en el idioma de la página. */
  names: Record<Station, string>;
  /** Descripción del dibujo para el lector de pantalla; sin ella el SVG es decorativo (`aria-hidden`). */
  label?: string;
  /** false: sin pulsos, onda ni órbitas (los subagentes quedan como puntos quietos). */
  animate?: boolean;
  /** true: sin SMIL; deja un hueco para los pulsos y marca manecillas y órbita para que los mueva un script. */
  live?: boolean;
};

// ---------------------------------------------------------------------- Geometría

const r1 = (n: number): number => Math.round(n * 10) / 10;

type Point = { x: number; y: number; c: number; s: number };

/** Centro de una estación (y el coseno y seno de su ángulo): las nueve van de 40 en 40 grados desde arriba. */
export function stationPoint(id: Station): Point {
  const a = ((-90 + STATIONS.indexOf(id) * 40) * Math.PI) / 180;
  return { x: r1(CX + RADIO * Math.cos(a)), y: r1(CY + RADIO * Math.sin(a)), c: Math.cos(a), s: Math.sin(a) };
}

/** Tramo recto entre el borde del anillo de contexto y el borde del disco: por donde corren el radio y los pulsos. */
export function spokeEnds(id: Station): { x1: number; y1: number; x2: number; y2: number } {
  const o = stationPoint(id);
  return { x1: r1(CX + ANILLO * o.c), y1: r1(CY + ANILLO * o.s), x2: r1(o.x - DISCO * o.c), y2: r1(o.y - DISCO * o.s) };
}

/** Arco que parte de las 12 y recorre la fracción `f` de la circunferencia (0 < f < 1). */
function arcPath(x: number, y: number, radio: number, f: number): string {
  const t = f * 2 * Math.PI - Math.PI / 2;
  return `M ${x} ${r1(y - radio)} A ${radio} ${radio} 0 ${f > 0.5 ? 1 : 0} 1 ${r1(x + radio * Math.cos(t))} ${r1(y + radio * Math.sin(t))}`;
}

/** Arco de una manecilla del halo de una estación: la interior da una vuelta por minuto y la exterior, por diez.
 *  Vacío mientras no llega a un 2 % de vuelta, como en el panel real. */
export function handArc(id: Station, hand: 'in' | 'out', sec: number): string {
  const f = hand === 'in' ? (sec % 60) / 60 : (sec % 600) / 600;
  if (f <= 0.02) return '';
  const o = stationPoint(id);
  return arcPath(o.x, o.y, hand === 'in' ? 26 : 30, f);
}

/** Vueltas de la órbita de los subagentes: segundos por vuelta. */
export const ORBITA_S = 6;

// ---------------------------------------------------------------------- Colores

type Tone = 'fg' | 'soft' | 'muted' | 'faint' | 'dim' | 'line' | 'idle' | 'used' | 'accent' | 'memory' | 'danger' | 'dangerText' | 'warn' | 'warnText';

// Cada tono es una variable del tema. Memoria usa el tinte del enlace, que pasa contraste en los seis temas.
const TONE_VARS: Record<Tone, string> = {
  fg: '--fg',
  soft: '--fg-soft',
  muted: '--fg-muted',
  faint: '--fg-faint',
  dim: '--fg-dim',
  line: '--line',
  idle: '--map-disc-idle',
  used: '--map-disc',
  accent: '--agent-claude',
  memory: '--link',
  danger: '--danger',
  dangerText: '--danger-text',
  warn: '--waiting',
  warnText: '--waiting-text',
};

const c = (t: Tone): string => `var(${TONE_VARS[t]})`;

// ---------------------------------------------------------------------- Texto

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEG = 1000;
const MIN = 60 * SEG;
const HORA = 60 * MIN;

/** Duración de una llamada: «0,3 s», «42 s», «3 min», «4 min 12 s», «1 h 05 min» (con punto decimal en inglés). */
export function formatDuration(ms: number, lang: 'es' | 'en'): string {
  const d = Math.max(0, ms);
  if (d < 10 * SEG) {
    const decimas = Math.min(99, Math.max(1, Math.round(d / 100)));
    return `${Math.floor(decimas / 10)}${lang === 'es' ? ',' : '.'}${decimas % 10} s`;
  }
  if (d < MIN) return `${Math.floor(d / SEG)} s`;
  if (d < 10 * MIN) {
    const s = Math.floor((d % MIN) / SEG);
    return s === 0 ? `${Math.floor(d / MIN)} min` : `${Math.floor(d / MIN)} min ${s} s`;
  }
  if (d < HORA) return `${Math.floor(d / MIN)} min`;
  return `${Math.floor(d / HORA)} h ${String(Math.floor((d % HORA) / MIN)).padStart(2, '0')} min`;
}

// ---------------------------------------------------------------------- Dibujo

/** Pulso que viaja por el radio de una estación, con SMIL. Hasta que le toca salir no se ve. */
function pulse(p: Pulse): string {
  const e = spokeEnds(p.to);
  const [ax, ay, bx, by] = p.dir === 'out' ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
  const color = c(p.kind === 'error' ? 'danger' : 'accent');
  const path = `M ${ax} ${ay} L ${bx} ${by}`;
  const move = `<animateMotion path="${path}" dur="${PULSO_S}s" begin="${p.begin}s" repeatCount="indefinite"/>`;
  const shown = p.begin > 0 ? `<set attributeName="visibility" to="visible" begin="${p.begin}s"/>` : '';
  return (
    `<g fill="${color}"${p.begin > 0 ? ' visibility="hidden"' : ''}>${shown}` +
    `<circle r="8" fill-opacity="0.22">${move}</circle><circle r="3.5">${move}</circle></g>`
  );
}

/** El mapa como un `<svg>` completo. */
export function renderMap(s: MapState, o: MapOptions): string {
  const live = o.live === true;
  const animate = o.animate !== false && !live;
  const out: string[] = [];
  const subagents = Math.max(0, Math.floor(s.subagents));
  const errPulse = new Set(s.pulses.filter((p) => p.kind === 'error').map((p) => p.to));
  const level = s.ctx === null ? 'neutral' : Math.round(s.ctx) >= CRITICAL_AT ? 'critical' : Math.round(s.ctx) >= WARN_AT ? 'warn' : 'neutral';

  type View = {
    id: Station;
    o: Point;
    uses: number;
    count: number;
    enMarcha: boolean;
    piensa: boolean;
    lit: boolean;
    activa: boolean;
    tint: Tone;
    errors: number;
    sec: number | null;
  };
  const views: View[] = STATIONS.map((id) => {
    const run = s.running[id];
    const count = Math.max(run?.count ?? 0, id === 'agentes' ? subagents : 0);
    const enMarcha = count > 0;
    const piensa = s.thinking === true && id === 'modelo';
    const lit = !enMarcha && !piensa && s.lit.includes(id);
    return {
      id,
      o: stationPoint(id),
      uses: s.uses[id] ?? 0,
      count,
      enMarcha,
      piensa,
      lit,
      activa: enMarcha || piensa || lit,
      tint: id === 'memoria' ? 'memory' : 'accent',
      errors: s.errors[id] ?? 0,
      // Sin llamada en marcha (subagente en segundo plano) no hay duración conocida: sin manecillas.
      sec: enMarcha && run !== undefined ? run.sec : null,
    };
  });

  const attrs = o.label ? `role="img" aria-label="${esc(o.label)}"` : 'aria-hidden="true"';
  out.push(`<svg class="mp" viewBox="0 0 ${MAP_W} ${MAP_H}" ${attrs} focusable="false">`);
  out.push(`<circle cx="${CX}" cy="${CY}" r="${RADIO}" fill="none" stroke="${c('line')}" stroke-width="1" stroke-dasharray="1 5"/>`);

  // Radios: engordan con el uso y se encienden mientras la estación está activa.
  for (const v of views) {
    const e = spokeEnds(v.id);
    const norm = Math.min(v.uses, USOS_MAX) / USOS_MAX;
    const errP = errPulse.has(v.id);
    const tone: Tone = v.enMarcha || v.piensa ? v.tint : errP ? 'danger' : v.lit ? v.tint : v.uses > 0 ? 'muted' : 'dim';
    const opacity = v.enMarcha || v.piensa || errP ? 0.85 : v.lit ? 0.6 : v.uses > 0 ? r1(0.35 + 0.45 * norm) : 0.8;
    out.push(
      `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${c(tone)}" stroke-width="${r1(1 + norm * 3)}" stroke-opacity="${opacity}" stroke-linecap="round"/>`,
    );
  }

  // Ruta: curvas cuadráticas con el control desplazado hacia el centro; el último tramo va en acento.
  for (let i = 1; i < s.route.length; i++) {
    const a = stationPoint(s.route[i - 1]!);
    const b = stationPoint(s.route[i]!);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const nuevo = i === s.route.length - 1;
    const opacity = r1((nuevo ? 0.85 : Math.max(0.18, 0.55 - (s.route.length - 1 - i) * 0.12)) * s.fade);
    if (opacity <= 0) continue;
    out.push(
      `<path d="M ${a.x} ${a.y} Q ${r1(mx + (CX - mx) * 0.45)} ${r1(my + (CY - my) * 0.45)} ${b.x} ${b.y}" fill="none" stroke="${c(nuevo ? 'accent' : 'soft')}" stroke-width="${nuevo ? 1.75 : 1.25}" stroke-opacity="${opacity}" stroke-linecap="round"/>`,
    );
  }

  // Onda y pulsos: solo con animación.
  if (animate && s.wave) {
    out.push(
      `<g class="mp-anim"><circle cx="${CX}" cy="${CY}" r="${ANILLO}" fill="none" stroke="${c('accent')}" stroke-width="1.5" stroke-opacity="0.55">` +
        `<animate attributeName="r" from="${ANILLO}" to="${ANILLO * 3.2}" dur="3.2s" repeatCount="indefinite"/>` +
        `<animate attributeName="stroke-opacity" from="0.55" to="0" dur="3.2s" repeatCount="indefinite"/></circle></g>`,
    );
  }
  if (animate && s.pulses.length > 0) out.push(`<g class="mp-anim">${s.pulses.map(pulse).join('')}</g>`);
  if (live) out.push('<g data-pulses></g>');

  // Halos de lo que sigue en marcha: la manecilla interior da una vuelta por minuto y la exterior, por diez.
  for (const v of views) {
    if (!v.enMarcha && !v.piensa) continue;
    const col = c(v.tint);
    out.push(`<g><circle cx="${v.o.x}" cy="${v.o.y}" r="31" fill="${col}" fill-opacity="0.16"/>`);
    if (v.sec !== null) {
      const fi = handArc(v.id, 'in', v.sec);
      const fo = handArc(v.id, 'out', v.sec);
      // En vivo las manecillas existen siempre (aunque vacías): el script les cambia el trazo en cada fotograma.
      if (fi || live) out.push(`<path${live ? ' data-hand="in"' : ''} d="${fi}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`);
      if (fo || live) out.push(`<path${live ? ' data-hand="out"' : ''} d="${fo}" fill="none" stroke="${col}" stroke-width="2" stroke-opacity="0.5" stroke-linecap="round"/>`);
    }
    out.push('</g>');
  }

  // Núcleo: el anillo es el contexto usado.
  const ring = level === 'critical' ? 'danger' : level === 'warn' ? 'warn' : 'soft';
  const pctTone: Tone = level === 'critical' ? 'dangerText' : level === 'warn' ? 'warnText' : 'muted';
  const circ = 2 * Math.PI * ANILLO;
  const frac = s.ctx === null ? 0 : Math.min(100, Math.max(0, s.ctx)) / 100;
  const trabajando = views.some((v) => v.enMarcha);
  out.push(`<circle cx="${CX}" cy="${CY}" r="${ANILLO}" fill="none" stroke="${c('line')}" stroke-width="3"/>`);
  out.push(
    `<circle cx="${CX}" cy="${CY}" r="${ANILLO}" fill="none" stroke="${c(ring)}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${r1(circ * frac)} ${r1(circ)}" transform="rotate(-90 ${CX} ${CY})"/>`,
  );
  out.push(`<circle cx="${CX}" cy="${CY}" r="${NUCLEO}" fill="var(--bg-surface)" stroke="${c(trabajando ? 'accent' : 'used')}" stroke-width="1.5"/>`);
  if (s.ctx !== null) out.push(`<text class="mp-pct" x="${CX}" y="${CY - 14}" text-anchor="middle" fill="${c(pctTone)}">${Math.round(s.ctx)} %</text>`);
  out.push(`<text class="mp-brand" x="${CX + 0.75}" y="${CY + 4}" text-anchor="middle" fill="${c('fg')}">CLAUDE</text>`);
  out.push(`<text class="mp-model" x="${CX}" y="${CY + 18}" text-anchor="middle" fill="${c('muted')}">${esc(s.model)}</text>`);

  // Subagentes: puntos que giran como un solo grupo alrededor de Agentes.
  const ag = stationPoint('agentes');
  const total = Math.min(subagents, MAX_PUNTOS);
  if (total > 0) {
    const dots = Array.from({ length: total }, (_, k) => {
      const a = (k * 2 * Math.PI) / total;
      return `<circle cx="${r1(ag.x + ORBITA * Math.cos(a))}" cy="${r1(ag.y + ORBITA * Math.sin(a))}" r="3.5" fill="${c('accent')}"/>`;
    }).join('');
    if (live) {
      out.push(`<g data-orbit transform="rotate(0 ${ag.x} ${ag.y})">${dots}</g>`);
    } else if (animate) {
      out.push(
        `<g class="mp-anim"><animateTransform attributeName="transform" type="rotate" from="0 ${ag.x} ${ag.y}" to="360 ${ag.x} ${ag.y}" dur="${ORBITA_S}s" repeatCount="indefinite"/>${dots}</g>`,
      );
      out.push(`<g class="mp-still">${dots}</g>`);
    } else {
      out.push(`<g>${dots}</g>`);
    }
  }

  // Estaciones: disco, icono y, por fuera, nombre y usos (encima en la mitad superior, debajo en la inferior).
  for (const v of views) {
    const err = v.errors > 0;
    const ring2: Tone = err ? 'danger' : v.activa ? v.tint : v.uses > 0 ? 'used' : 'idle';
    const icon: Tone = err ? 'dangerText' : v.activa ? v.tint : v.uses > 0 ? 'soft' : 'faint';
    const label: Tone = v.activa ? 'fg' : v.uses > 0 ? 'soft' : 'faint';
    const { x, y } = v.o;
    // El borde de 1,5 px va dentro de los 40 px del disco.
    out.push(`<circle cx="${x}" cy="${y}" r="19.25" fill="var(--bg-surface)" stroke="${c(ring2)}" stroke-width="1.5"/>`);
    out.push(
      `<path d="${ICONS[v.id]}" transform="translate(${r1(x - 9)} ${r1(y - 9)}) scale(0.75)" fill="none" stroke="${c(icon)}" stroke-width="2.27" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    const up = v.o.s < -0.5;
    const hasUses = v.uses > 0;
    const nameY = up ? (hasUses ? y - 53 : y - 38) : y + 45;
    out.push(`<text class="mp-lbl mp-name" x="${x}" y="${nameY}" text-anchor="middle" fill="${c(label)}">${esc(o.names[v.id])}</text>`);
    if (hasUses) {
      const usesY = up ? y - 38 : y + 59;
      const text = `${v.id === 'memoria' ? '↓' : ''}${v.uses}`;
      out.push(`<text class="mp-lbl mp-uses" x="${x}" y="${usesY}" text-anchor="middle" fill="${c(v.id === 'memoria' ? 'memory' : 'faint')}">${text}</text>`);
    }
    if (v.count > 1) out.push(`<text class="mp-lbl mp-cnt" x="${r1(x - 22)}" y="${r1(y - 15)}" text-anchor="end" fill="${c('accent')}">×${v.count}</text>`);
    if (err) {
      out.push(`<circle cx="${r1(x + 17)}" cy="${r1(y - 17)}" r="8" fill="${c('danger')}"/>`);
      out.push(`<text class="mp-err" x="${r1(x + 17)}" y="${r1(y - 13.5)}" text-anchor="middle" fill="var(--danger-ink)">${v.errors}</text>`);
    }
  }

  out.push('</svg>');
  return out.join('');
}

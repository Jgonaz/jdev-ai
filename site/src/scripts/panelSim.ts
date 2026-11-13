// Simulación en el cliente de una sesión de Claude que trabaja en el panel simulado: mueve el mapa del panel derecho y
// el indicador de trabajo del terminal. Con datos inventados (`panelSims` en `src/data/activityMap.ts`); nada es real.
//
// El SVG solo se vuelve a pintar cuando cambia la estructura (un evento nuevo, una estación que se apaga): repintarlo
// cada fotograma reiniciaría el SMIL y el halo y la órbita darían saltos. Lo continuo (manecillas, ángulo de la órbita,
// pulsos) se mueve aparte, cambiando atributos en un bucle de `requestAnimationFrame` a partir de un reloj propio, así
// que sobrevive a los repintados. El reloj solo avanza mientras el bucle corre: al volver tras una pausa no hay un
// aluvión de eventos atrasados.

import type { PanelSim } from '../data/activityMap';
import { formatDuration, handArc, ORBITA_S, renderMap, spokeEnds, stationPoint } from './activityMap';
import type { MapState, Station } from './activityMap';

export type SimRow = {
  station: Station;
  tool: string;
  target: string;
  ms: number;
  status: 'running' | 'done';
  more?: number;
};

/** Lo que el servidor deja en `data-sim` del bloque del mapa. */
export type SimPayload = {
  lang: 'es' | 'en';
  names: Record<Station, string>;
  /** Textos de la fila de una llamada del modelo y del estado de cada fila para el lector de pantalla. */
  labels: { reply: string; running: string; done: string };
  state: MapState;
  rows: SimRow[];
  sim: PanelSim;
};

// ---------------------------------------------------------------------- Indicador de trabajo de Claude Code

/** Glifos del spinner de Claude Code; va y vuelve. */
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];
const SPINNER_FPS = 9;

/** Tiempo como lo escribe Claude Code: «42s», «3m 12s», «1h 2m 3s». */
export function formatClaudeTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

/** Tokens como los escribe Claude Code: «820», «4.1k». */
export function formatTokens(n: number): string {
  return n < 1000 ? String(Math.floor(n)) : `${(n / 1000).toFixed(1)}k`;
}

/** Glifo del spinner en el fotograma `n`: 0 1 2 3 4 5 4 3 2 1 y vuelta a empezar. */
function spinnerGlyph(n: number): string {
  const last = SPINNER.length - 1;
  const k = n % (2 * last);
  return SPINNER[k <= last ? k : 2 * last - k]!;
}

// ---------------------------------------------------------------------- Mapa

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Lo que tarda un pulso en ir de una punta del radio a la otra. */
const PULSE_MS = 800;
/** Cuánto sigue encendida una estación tras su llamada. */
const LIT_MS = 4000;
const MAX_STOPS = 6;
/** Cada cuánto se reescriben los textos que cambian con el tiempo (décimas de segundo). */
const TEXT_MS = 100;
/** Un fotograma largo (pestaña dormida, parón del navegador) no adelanta la simulación más de esto. */
const MAX_STEP_MS = 100;

type Pulse = { to: Station; dir: 'out' | 'back'; t0: number; el: SVGGElement | null };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type PanelSimHandle = {
  /** Elemento que se comprueba para saber si la sesión se ve. */
  el: HTMLElement;
  /** Arranca o detiene el bucle; al reanudar sigue donde se quedó. */
  run: (on: boolean) => void;
};

/** `block` es el contenedor del mapa de la sesión (`.pn-ctxmap`); `pane`, su terminal y su chat. */
export function createPanelSim(block: HTMLElement, pane: HTMLElement | null, data: SimPayload): PanelSimHandle {
  const { names, labels, sim } = data;
  const host = block.firstElementChild as HTMLElement;
  const glyphEl = block.querySelector<HTMLElement>('.pn-ctxmap__glyph')!;
  const textEl = block.querySelector<HTMLElement>('.pn-ctxmap__text')!;
  const timeEl = block.querySelector<HTMLElement>('.pn-ctxmap__time')!;
  const rowsEl = block.closest('[data-ctx]')!.querySelector<HTMLElement>('.pn-ctxrows')!;
  const workEls = pane ? [...pane.querySelectorAll<HTMLElement>('[data-work]')] : [];

  // ---- Estado. `T` es el reloj de la simulación, en ms: solo avanza con el bucle en marcha.
  let T = 0;
  const agentStart = -sim.agentSec * 1000;
  const uses = { ...data.state.uses };
  const route: Station[] = [...data.state.route];
  const litUntil = new Map<Station, number>();
  const pinned = data.rows.filter((r) => r.status === 'running').map((r) => ({ ...r }));
  const maxRows = data.rows.length;
  const recent: (SimRow & { since: number })[] = data.rows.filter((r) => r.status !== 'running').map((r) => ({ ...r, since: 0 }));
  let current: { start: number; end: number; row: SimRow & { since: number } } | null = null;
  let evCount = 0;
  let nextAt = 1200;
  const pulses: Pulse[] = [];
  let dirty = true;
  let litKey = '';

  // Los pulsos viven en un grupo propio que se recoloca en cada repintado, para no reiniciarlos.
  const pulseG = document.createElementNS(SVG_NS, 'g');
  pulseG.setAttribute('data-pulses', '');
  let hands: SVGPathElement[] = [];
  let orbit: SVGGElement | null = null;
  const ag = stationPoint('agentes');

  const agentSec = () => (T - agentStart) / 1000;
  const litNow = (): Station[] => [...litUntil].filter(([, until]) => until > T).map(([id]) => id);

  const paint = () => {
    const state: MapState = {
      ...data.state,
      uses,
      running: { agentes: { count: 1, sec: agentSec() } },
      lit: litNow(),
      route,
      pulses: [],
    };
    host.innerHTML = renderMap(state, { names, live: true });
    host.querySelector('[data-pulses]')?.replaceWith(pulseG);
    hands = [...host.querySelectorAll<SVGPathElement>('[data-hand]')];
    orbit = host.querySelector<SVGGElement>('[data-orbit]');
    renderRows();
    dirty = false;
  };

  // ---- Filas de «Actividad reciente»: las llamadas en marcha de larga duración arriba y, debajo, lo último primero.
  const shown = (): SimRow[] => [...pinned, ...recent].slice(0, maxRows);
  const rowMs = (r: SimRow, since?: number): number => (r.status === 'running' && since !== undefined ? T - since : r.ms);
  const renderRows = () => {
    rowsEl.innerHTML = shown()
      .map((r, i) => {
        const run = r.status === 'running';
        const since = i < pinned.length ? agentStart : (r as SimRow & { since: number }).since;
        const what = r.tool ? `<span class="pn-ctxrow__tool">${esc(r.tool)}</span>${r.target ? ` ${esc(r.target)}` : ''}` : '';
        return (
          `<li class="pn-ctxrow" data-status="${r.status}"><span class="pn-ctxrow__glyph" aria-hidden="true">${run ? '●' : '·'}</span>` +
          `<span class="pn-sr">${esc(run ? labels.running : labels.done)}: </span><span class="pn-ctxrow__st">${esc(names[r.station])}</span>` +
          `<span class="pn-ctxrow__what">${what}${r.more ? `<span class="pn-ctxrow__fold"> +${r.more}</span>` : ''}</span>` +
          `<span class="pn-ctxrow__time" data-since="${run ? since : ''}">${formatDuration(rowMs(r, since), data.lang)}</span></li>`
        );
      })
      .join('');
  };

  // ---- Línea de «ahora»
  let nowText = '';
  const setNow = (glyph: string, tone: string, text: string, running: boolean) => {
    glyphEl.textContent = glyph;
    glyphEl.dataset.tone = tone;
    if (text !== nowText) {
      textEl.textContent = text;
      nowText = text;
    }
    if (running) timeEl.dataset.tone = 'accent';
    else delete timeEl.dataset.tone;
  };

  // ---- Eventos de la sesión principal
  const startEvent = () => {
    const ev = sim.events[evCount % sim.events.length]!;
    const start = nextAt;
    evCount++;
    nextAt = start + ev.gap;
    const isModel = ev.tool === '';
    const tool = isModel ? labels.reply : ev.tool;
    const target = isModel ? '' : ev.target;

    uses[ev.station] = (uses[ev.station] ?? 0) + 1;
    // Una llamada seguida a la misma estación se agrupa en su fila, como en el panel real.
    const top = recent[0];
    let row: SimRow & { since: number };
    if (top && top.station === ev.station && top.status === 'done') {
      row = Object.assign(top, { tool, target, status: 'running' as const, since: start, more: (top.more ?? 0) + 1 });
    } else {
      row = { station: ev.station, tool, target, ms: 0, status: 'running', since: start };
      recent.unshift(row);
      recent.length = Math.min(recent.length, Math.max(0, maxRows - pinned.length));
    }
    if (route[route.length - 1] !== ev.station) route.push(ev.station);
    if (route.length > MAX_STOPS) route.splice(0, route.length - MAX_STOPS);
    litUntil.set(ev.station, start + ev.ms + LIT_MS);
    pulses.push({ to: ev.station, dir: 'out', t0: start, el: null });
    current = { start, end: start + ev.ms, row };
    setNow('●', 'accent', `${names[ev.station]} · ${tool}${target ? ` ${target}` : ''}`, true);
    dirty = true;
  };

  const endEvent = () => {
    if (!current) return;
    const { row, start, end } = current;
    row.status = 'done';
    row.ms = end - start;
    pulses.push({ to: row.station, dir: 'back', t0: end, el: null });
    setNow('·', 'faint', nowText, false);
    timeEl.textContent = formatDuration(row.ms, data.lang);
    current = null;
    dirty = true;
  };

  // ---- Pulsos: del núcleo a la estación y, al terminar la llamada, de vuelta una sola vez.
  const updatePulses = () => {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]!;
      const f = (T - p.t0) / PULSE_MS;
      if (f >= 1) {
        p.el?.remove();
        pulses.splice(i, 1);
        continue;
      }
      if (f < 0) continue;
      if (!p.el) {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('fill', 'var(--agent-claude)');
        g.innerHTML = '<circle r="8" fill-opacity="0.22"/><circle r="3.5"/>';
        pulseG.append(g);
        p.el = g;
      }
      const e = spokeEnds(p.to);
      const [ax, ay, bx, by] = p.dir === 'out' ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
      p.el.setAttribute('transform', `translate(${(ax + (bx - ax) * f).toFixed(2)} ${(ay + (by - ay) * f).toFixed(2)})`);
    }
  };

  // ---- Indicador de trabajo
  const verbStarts: number[] = [];
  let cycleMs = 0;
  for (const v of sim.work.verbs) {
    verbStarts.push(cycleMs);
    cycleMs += v.ms;
  }
  const last = { glyph: '', verb: '', time: '', tokens: '' };
  const updateWork = () => {
    if (workEls.length === 0) return;
    const glyph = spinnerGlyph(Math.floor((T * SPINNER_FPS) / 1000));
    const at = T % cycleMs;
    let k = verbStarts.length - 1;
    while (verbStarts[k]! > at) k--;
    const verb = `${sim.work.verbs[k]!.text}…`;
    const time = formatClaudeTime(agentSec());
    const tokens = formatTokens(sim.work.tokens + Math.floor(T / 1000) * sim.work.tokensPerSec);
    for (const [key, value] of Object.entries({ glyph, verb, time, tokens }) as [keyof typeof last, string][]) {
      if (last[key] === value) continue;
      last[key] = value;
      for (const el of workEls) for (const part of el.querySelectorAll(`[data-w="${key}"]`)) part.textContent = value;
    }
  };

  // ---- Bucle
  let raf = 0;
  let prev = 0;
  let textAt = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    T += Math.min(MAX_STEP_MS, Math.max(0, now - prev));
    prev = now;

    if (current && T >= current.end) endEvent();
    if (!current && T >= nextAt) startEvent();
    const key = litNow().join();
    if (key !== litKey) {
      litKey = key;
      dirty = true;
    }
    if (dirty) paint();

    // Continuo, sin repintar: manecillas, órbita y pulsos.
    const sec = agentSec();
    for (const hand of hands) hand.setAttribute('d', handArc('agentes', hand.dataset.hand === 'out' ? 'out' : 'in', sec));
    orbit?.setAttribute('transform', `rotate(${(((T / 1000) % ORBITA_S) / ORBITA_S) * 360} ${ag.x} ${ag.y})`);
    updatePulses();
    updateWork();

    if (T - textAt >= TEXT_MS) {
      textAt = T;
      if (current) timeEl.textContent = formatDuration(T - current.start, data.lang);
      for (const el of rowsEl.querySelectorAll<HTMLElement>('[data-since]')) {
        const since = el.dataset.since;
        if (since) el.textContent = formatDuration(T - Number(since), data.lang);
      }
    }
  };

  paint();
  updateWork();

  return {
    el: host,
    run: (on) => {
      if (on && raf === 0) {
        prev = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!on && raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}

/** Prepara todas las simulaciones de un panel. */
export function setupPanelSims(panel: HTMLElement): PanelSimHandle[] {
  const sims: PanelSimHandle[] = [];
  for (const block of panel.querySelectorAll<HTMLElement>('[data-sim]')) {
    const id = block.closest<HTMLElement>('[data-ctx]')?.dataset.ctx;
    const pane = id ? panel.querySelector<HTMLElement>(`[data-pane="${id}"]`) : null;
    sims.push(createPanelSim(block, pane, JSON.parse(block.dataset.sim ?? '{}')));
  }
  return sims;
}

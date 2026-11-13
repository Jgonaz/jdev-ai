// Datos de ejemplo del mapa de actividad: los seis pasos de la sección de la landing y una instantánea por sesión
// del panel simulado. Aquí solo van estados y nombres que no se traducen (herramientas, archivos, comandos); los
// textos visibles de cada idioma están en `src/i18n/`. Nada es real.

import type { MapState, Station } from '../scripts/activityMap';

/** Línea de «ahora»: el glifo y su tono; el texto y la hora van en i18n. */
export type NowStyle = { glyph: '●' | '·' | '✕'; tone: 'accent' | 'faint' | 'danger' };

// ---------------------------------------------------------------------- Sección de la landing

const base: Pick<MapState, 'lit' | 'errors' | 'fade' | 'pulses' | 'subagents' | 'wave' | 'thinking'> = {
  lit: [],
  errors: {},
  fade: 1,
  pulses: [],
  subagents: 0,
  wave: false,
  thinking: false,
};

/** Modelo que muestra el núcleo de la sesión de ejemplo. */
export const landingModel = 'Opus 5.5';

/** Los seis pasos de la sesión «Corregir tests del parser». `now` solo lleva el estilo: su texto está en i18n. */
export const landingSteps: { state: MapState; now: NowStyle }[] = [
  {
    // 1 · Tú pides
    state: {
      ...base,
      uses: { tu: 1 },
      running: {},
      lit: ['tu'],
      route: [],
      pulses: [{ to: 'tu', dir: 'back', kind: 'ok', begin: 0 }],
      ctx: 8,
      model: landingModel,
    },
    now: { glyph: '·', tone: 'faint' },
  },
  {
    // 2 · Cada herramienta, un pulso
    state: {
      ...base,
      uses: { tu: 1, modelo: 4, memoria: 1, archivos: 6, skills: 1 },
      running: {},
      lit: ['archivos', 'modelo'],
      route: ['tu', 'memoria', 'skills', 'archivos'],
      pulses: [
        { to: 'archivos', dir: 'out', kind: 'ok', begin: 0 },
        { to: 'modelo', dir: 'back', kind: 'ok', begin: 0.7 },
      ],
      ctx: 21,
      model: landingModel,
    },
    now: { glyph: '·', tone: 'faint' },
  },
  {
    // 3 · Lo que sigue en marcha
    state: {
      ...base,
      uses: { tu: 1, modelo: 6, memoria: 1, archivos: 8, shell: 2, skills: 1 },
      running: { shell: { count: 1, sec: 42 } },
      route: ['memoria', 'skills', 'archivos', 'shell'],
      pulses: [{ to: 'shell', dir: 'out', kind: 'ok', begin: 0 }],
      ctx: 27,
      model: landingModel,
    },
    now: { glyph: '●', tone: 'accent' },
  },
  {
    // 4 · Los fallos, en rojo
    state: {
      ...base,
      uses: { tu: 1, modelo: 7, memoria: 1, archivos: 8, shell: 2, skills: 1 },
      running: {},
      errors: { shell: 1 },
      route: ['memoria', 'skills', 'archivos', 'shell'],
      pulses: [{ to: 'shell', dir: 'back', kind: 'error', begin: 0 }],
      ctx: 31,
      model: landingModel,
    },
    now: { glyph: '✕', tone: 'danger' },
  },
  {
    // 5 · Subagentes en órbita
    state: {
      ...base,
      uses: { tu: 1, modelo: 9, memoria: 1, archivos: 11, shell: 3, agentes: 2, skills: 1 },
      running: { agentes: { count: 2, sec: 95 } },
      errors: { shell: 1 },
      route: ['archivos', 'shell', 'archivos', 'agentes'],
      pulses: [{ to: 'agentes', dir: 'out', kind: 'ok', begin: 0 }],
      subagents: 2,
      ctx: 44,
      model: landingModel,
    },
    now: { glyph: '●', tone: 'accent' },
  },
  {
    // 6 · Respuesta lista
    state: {
      ...base,
      uses: { tu: 1, modelo: 12, memoria: 1, archivos: 14, shell: 5, agentes: 2, skills: 1 },
      running: {},
      errors: { shell: 1 },
      route: ['shell', 'archivos', 'agentes', 'tu'],
      fade: 0.35,
      wave: true,
      ctx: 52,
      model: landingModel,
    },
    now: { glyph: '·', tone: 'faint' },
  },
];

// ---------------------------------------------------------------------- Panel simulado

/** Una fila de «Actividad reciente»: la más reciente primero. Solo nombres: archivo, comando o host, nunca contenidos. */
export type MapRow = {
  station: Station;
  tool: string;
  target: string;
  /** Duración de la llamada; en una en marcha, lo que lleva. */
  ms: number;
  status: 'running' | 'done';
  /** Llamadas seguidas de la misma estación que agrupa la fila (se pinta «+N»). */
  more?: number;
};

/** Sesión elegida al cargar el panel simulado: la que trabaja, para que el mapa y el terminal se vean en movimiento. */
export const panelInitialSession = 's2';

/** Segundos que lleva en marcha el implementer de `s2` al cargar la página («3 min 12 s»). Es también el tiempo del
 *  indicador de trabajo del terminal, para que no se contradigan. */
const s2Sec = 192;

/** Instantánea del mapa de una sesión de Claude del panel simulado (`s1`, `s2`, `s4`); s3 es Codex y no tiene mapa.
 *  El contexto y el modelo salen de la propia sesión (`ctx` y `model`), no de aquí. */
export const panelMaps: Record<string, { state: Omit<MapState, 'ctx' | 'model'>; now: NowStyle; rows: MapRow[] }> = {
  // Te espera: reposo con algo de uso y la ruta apagándose.
  s1: {
    state: {
      ...base,
      uses: { tu: 1, modelo: 3, memoria: 1, archivos: 4, skills: 1 },
      running: {},
      route: ['memoria', 'archivos', 'skills', 'archivos', 'modelo'],
      fade: 0.4,
    },
    now: { glyph: '·', tone: 'faint' },
    rows: [
      { station: 'archivos', tool: 'Read', target: 'feature.md', ms: 600, status: 'done', more: 1 },
      { station: 'skills', tool: 'Skill', target: 'openspec', ms: 300, status: 'done' },
      { station: 'archivos', tool: 'Grep', target: 'src', ms: 1100, status: 'done', more: 1 },
      { station: 'memoria', tool: 'Read', target: 'MEMORY.md', ms: 100, status: 'done' },
    ],
  },
  // Trabaja: Explore terminó y el implementer sigue (un subagente, un punto en órbita y manecillas). Es el punto de partida
  // de la simulación de `panelSims`; sin JavaScript queda como instantánea.
  s2: {
    state: {
      ...base,
      uses: { tu: 1, modelo: 5, memoria: 1, archivos: 9, shell: 1, agentes: 2 },
      running: { agentes: { count: 1, sec: s2Sec } },
      route: ['memoria', 'archivos', 'shell', 'archivos', 'agentes'],
      subagents: 1,
    },
    now: { glyph: '●', tone: 'accent' },
    rows: [
      { station: 'agentes', tool: 'Agent', target: 'implementer', ms: s2Sec * 1000, status: 'running' },
      { station: 'agentes', tool: 'Agent', target: 'Explore', ms: 72_000, status: 'done' },
      { station: 'shell', tool: 'Bash', target: 'git status', ms: 400, status: 'done' },
      { station: 'archivos', tool: 'Read', target: 'Cart.css', ms: 700, status: 'done', more: 2 },
      { station: 'memoria', tool: 'Read', target: 'MEMORY.md', ms: 100, status: 'done' },
    ],
  },
  // Hecha: reposo con onda, ruta casi apagada y «Respuesta lista».
  s4: {
    state: {
      ...base,
      uses: { tu: 1, modelo: 3, memoria: 1, archivos: 5, shell: 1, red: 1 },
      running: {},
      route: ['memoria', 'archivos', 'shell', 'red', 'modelo'],
      fade: 0.15,
      wave: true,
    },
    now: { glyph: '·', tone: 'faint' },
    rows: [
      { station: 'red', tool: 'Bash', target: 'git push', ms: 1800, status: 'done' },
      { station: 'shell', tool: 'Bash', target: 'git commit', ms: 400, status: 'done' },
      { station: 'archivos', tool: 'Edit', target: 'despliegue.md', ms: 2600, status: 'done', more: 4 },
      { station: 'memoria', tool: 'Read', target: 'MEMORY.md', ms: 100, status: 'done' },
    ],
  },
};

// ---------------------------------------------------------------------- Simulación del panel

/** Una llamada de la sesión principal. Solo nombres: nunca contenidos. `target` vacío en el modelo: su fila dice «respuesta». */
export type SimEvent = {
  station: Station;
  tool: string;
  target: string;
  /** Lo que dura la llamada. */
  ms: number;
  /** Lo que tarda en llegar la siguiente (siempre mayor que `ms`). */
  gap: number;
};

export type PanelSim = {
  /** Segundos que lleva la llamada larga al cargar la página. */
  agentSec: number;
  /** Ciclo de llamadas de la sesión principal; al acabar vuelve a empezar. */
  events: SimEvent[];
  /** Indicador de trabajo de Claude Code: el texto es el de su interfaz real y no se traduce. */
  work: { verbs: { text: string; ms: number }[]; tokens: number; tokensPerSec: number };
};

/** Sesiones del panel simulado cuyo mapa y terminal se mueven en el cliente (`scripts/panelSim.ts`). */
export const panelSims: Record<string, PanelSim> = {
  s2: {
    agentSec: s2Sec,
    events: [
      { station: 'archivos', tool: 'Read', target: 'tasks.md', ms: 900, gap: 2400 },
      { station: 'shell', tool: 'Bash', target: 'git diff --stat', ms: 1300, gap: 2800 },
      { station: 'archivos', tool: 'Grep', target: '--color-', ms: 800, gap: 2200 },
      { station: 'archivos', tool: 'Read', target: 'Cart.css', ms: 700, gap: 2600 },
      { station: 'modelo', tool: '', target: '', ms: 1900, gap: 3000 },
      { station: 'archivos', tool: 'Read', target: 'CartItem.css', ms: 800, gap: 2300 },
      { station: 'memoria', tool: 'Read', target: 'MEMORY.md', ms: 500, gap: 2500 },
      { station: 'shell', tool: 'Bash', target: 'git status', ms: 1100, gap: 2700 },
      { station: 'modelo', tool: '', target: '', ms: 1700, gap: 2400 },
    ],
    work: {
      verbs: [
        { text: 'Clauding', ms: 4000 },
        { text: 'Pondering', ms: 3200 },
        { text: 'Noodling', ms: 4600 },
        { text: 'Percolating', ms: 3500 },
        { text: 'Synthesizing', ms: 5000 },
        { text: 'Cogitating', ms: 3000 },
        { text: 'Tinkering', ms: 4200 },
        { text: 'Brewing', ms: 3800 },
        { text: 'Musing', ms: 4800 },
      ],
      tokens: 4100,
      tokensPerSec: 13,
    },
  },
};

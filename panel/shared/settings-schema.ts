// Estructura de los ajustes del panel y sus valores por defecto. Es un módulo
// sin dependencias de Node que comparten el servidor (que valida y guarda) y el
// cliente (que lo usa para tipar y restablecer valores por defecto).

export const DEFAULT_PORT = 4317;

export const THEMES = ['grafito', 'fosforo', 'papel', 'contraste'] as const;
export const ACCENTS = ['ambar', 'menta', 'lavanda', 'coral', 'cian'] as const;
export const CURSORS = ['bloque', 'barra', 'subrayado'] as const;
// 1, 2 y 4 son el número de terminales visibles; «last» recuerda la última usada.
export const LAYOUTS = [1, 2, 4, 'last'] as const;
// «shell» es la «Terminal (sin agente)»: una shell normal, sin bin/agent.
export const AGENTS = ['claude', 'codex', 'copilot', 'opencode', 'shell'] as const;
export const LOCATIONS = ['principal', 'worktree-nuevo'] as const;
// Pantalla que muestra el panel al abrir su URL sin ruta.
export const START_SCREENS = ['inicio', 'terminales'] as const;
/** Longitud máxima de «Tu nombre», en caracteres (puntos de código, no unidades UTF-16). */
export const PROFILE_NAME_MAX = 60;

// Caracteres que «Tu nombre» no admite: de control (tabuladores y saltos
// incluidos) y separadores de línea o párrafo.
const NOMBRE_PROHIBIDO = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/** Longitud de un texto en puntos de código: un emoji cuenta como uno. */
export const codePointLength = (v: string): number => Array.from(v).length;

/**
 * Lo escrito en «Tu nombre», limpio mientras se escribe: los caracteres no
 * admitidos pasan a ser un espacio y los espacios repetidos se colapsan en uno.
 * No recorta ni la longitud ni los extremos, para no mover el cursor.
 */
export const cleanProfileName = (v: string): string => v.replace(NOMBRE_PROHIBIDO, ' ').replace(/ {2,}/g, ' ');

/** Lo que valida el servidor, y el cliente antes de guardar: sin caracteres no admitidos y con PROFILE_NAME_MAX como mucho. */
export const isValidProfileName = (v: unknown): v is string =>
  typeof v === 'string' && codePointLength(v) <= PROFILE_NAME_MAX && !new RegExp(NOMBRE_PROHIBIDO.source, 'u').test(v);

// Paleta fija de colores de proyecto (la misma que usa el servidor por defecto).
export const PROJECT_PALETTE = ['#6fb7ff', '#ff8a6b', '#c79bff', '#f2a7c8', '#e9e1cf', '#6cc3b5'] as const;

/** Sonidos de aviso, sintetizados en el navegador (sin archivos). */
export const SOUNDS = ['teletipo', 'campanilla', 'dos-tonos', 'gota', 'pulso', 'acorde', 'marimba', 'radar'] as const;
/** Sonido de Windows (C:\\Windows\\Media): «win:» y el nombre del .wav. */
export type WindowsSoundId = `win:${string}`;
export type SoundId = (typeof SOUNDS)[number] | WindowsSoundId;
const WINDOWS_SOUND = /^win:[\p{L}\p{N} ._()&'-]{1,120}\.wav$/iu;
/** Sonido aceptable en los ajustes: uno sintetizado o un .wav de Windows por nombre. */
export function isSoundId(v: unknown): v is SoundId {
  return typeof v === 'string' && ((SOUNDS as readonly string[]).includes(v) || (WINDOWS_SOUND.test(v) && !v.startsWith('win:.')));
}

export type ProjectOverride = { mono?: string; color?: string; visible?: boolean };

export type Settings = {
  theme: { name: (typeof THEMES)[number]; followSystem: boolean; accent: (typeof ACCENTS)[number] };
  fonts: { ui: string; title: string; terminal: string };
  sizes: { ui: number; title: number; terminal: number };
  terminal: {
    cursor: (typeof CURSORS)[number];
    initialLayout: (typeof LAYOUTS)[number];
    scrollback: number;
    copyOnSelect: boolean;
    tmuxBar: boolean;
    /** Miniatura flotante al pasar el ratón por una ruta de imagen. */
    hoverPreview: boolean;
    /** Abrir el visor cuando una terminal visible escribe una ruta de imagen nueva. */
    autoOpenImages: boolean;
  };
  personality: { cursor: boolean; lights: boolean; ascii: boolean; greeting: boolean; grid: boolean };
  notifications: {
    system: boolean;
    counter: boolean;
    sound: boolean;
    onFinish: boolean;
    /** Sonido cuando una sesión pasa a esperarte. */
    soundWaiting: SoundId;
    /** Sonido cuando una sesión termina (con «Avisar también cuando una sesión termina»). */
    soundFinish: SoundId;
  };
  newSession: { agent: (typeof AGENTS)[number]; location: (typeof LOCATIONS)[number] };
  /** Nombre para el saludo de Inicio; '' toma el primer nombre de `git config user.name`. */
  profile: { name: string };
  startScreen: (typeof START_SCREENS)[number];
  port: number;
  projects: Record<string, ProjectOverride>;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: { name: 'grafito', followSystem: false, accent: 'ambar' },
  fonts: {
    ui: "'Instrument Sans', system-ui, sans-serif",
    title: "'Martian Mono', ui-monospace, monospace",
    terminal: "'JetBrains Mono', ui-monospace, monospace",
  },
  sizes: { ui: 14, title: 20, terminal: 12.5 },
  terminal: {
    cursor: 'bloque',
    initialLayout: 1,
    scrollback: 5000,
    copyOnSelect: false,
    tmuxBar: true,
    hoverPreview: true,
    autoOpenImages: false,
  },
  personality: { cursor: true, lights: true, ascii: true, greeting: true, grid: true },
  notifications: { system: false, counter: true, sound: false, onFinish: false, soundWaiting: 'teletipo', soundFinish: 'gota' },
  newSession: { agent: 'claude', location: 'principal' },
  profile: { name: '' },
  startScreen: 'inicio',
  port: DEFAULT_PORT,
  projects: {},
};

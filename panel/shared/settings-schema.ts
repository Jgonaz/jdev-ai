// Estructura de los ajustes del panel y sus valores por defecto. Es un módulo
// sin dependencias de Node que comparten el servidor (que valida y guarda) y el
// cliente (que lo usa para tipar y restablecer valores por defecto).

export const DEFAULT_PORT = 4317;

export const THEMES = ['grafito', 'fosforo', 'papel', 'contraste'] as const;
export const ACCENTS = ['ambar', 'menta', 'lavanda', 'coral', 'cian'] as const;
export const CURSORS = ['bloque', 'barra', 'subrayado'] as const;
// 1, 2 y 4 son el número de terminales visibles; «last» recuerda la última usada.
export const LAYOUTS = [1, 2, 4, 'last'] as const;
export const AGENTS = ['claude', 'codex', 'copilot', 'opencode'] as const;
export const LOCATIONS = ['principal', 'worktree-nuevo'] as const;

// Paleta fija de colores de proyecto (la misma que usa el servidor por defecto).
export const PROJECT_PALETTE = ['#6fb7ff', '#ff8a6b', '#c79bff', '#f2a7c8', '#e9e1cf', '#6cc3b5'] as const;

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
  };
  personality: { cursor: boolean; lights: boolean; ascii: boolean; greeting: boolean; grid: boolean };
  notifications: { system: boolean; counter: boolean; sound: boolean; onFinish: boolean };
  newSession: { agent: (typeof AGENTS)[number]; location: (typeof LOCATIONS)[number] };
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
  },
  personality: { cursor: true, lights: true, ascii: true, greeting: true, grid: true },
  notifications: { system: false, counter: true, sound: false, onFinish: false },
  newSession: { agent: 'claude', location: 'principal' },
  port: DEFAULT_PORT,
  projects: {},
};

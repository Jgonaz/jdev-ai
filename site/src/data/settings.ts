// Textos de la pantalla Ajustes del panel simulado. Las opciones con efecto
// (tema, acento, interruptores, agente) lo tienen sobre la propia simulación.

type Toggle = { id: string; label: string; hint: string; on: boolean };
type Choice = { id: string; label: string; hint?: string };

type SettingsScreen = {
  title: string;
  nav: string;
  sections: { id: string; label: string; lead: string }[];
  appearance: {
    theme: string;
    themes: Choice[];
    accent: string;
    accents: Choice[];
    details: string;
    toggles: Toggle[];
  };
  typography: { rows: { role: string; font: string }[]; size: string; sizes: Choice[] };
  terminal: { layout: string; layouts: Choice[]; toggles: Toggle[] };
  projects: { visible: string; hint: string };
  notifications: { toggles: Toggle[]; sound: string; sounds: Choice[] };
  agents: { agent: string; agents: Choice[]; where: string; places: Choice[] };
  shortcuts: { keys: string; action: string }[];
  server: { rows: { label: string; value: string }[] };
};

export const settingsScreen: Record<'es' | 'en', SettingsScreen> = {
  es: {
    title: 'Ajustes',
    nav: 'Secciones de ajustes',
    sections: [
      { id: 'apariencia', label: 'Apariencia', lead: 'Cómo se ve el panel. Las terminales usan el mismo tema.' },
      { id: 'tipografia', label: 'Tipografía', lead: 'Las fuentes de la interfaz, los títulos y la terminal.' },
      { id: 'terminal', label: 'Terminal', lead: 'Cómo se comportan las terminales del panel.' },
      { id: 'proyectos', label: 'Proyectos', lead: 'Qué proyectos se muestran en el panel.' },
      { id: 'avisos', label: 'Avisos', lead: 'Cuando una sesión te espera (permiso o pregunta) o termina.' },
      { id: 'agentes', label: 'Agentes', lead: 'Con qué agente y dónde se abren las sesiones nuevas.' },
      { id: 'atajos', label: 'Atajos de teclado', lead: 'Los atajos del panel y de sus terminales.' },
      { id: 'servidor', label: 'Servidor local', lead: 'El panel solo escucha en tu máquina.' },
    ],
    appearance: {
      theme: 'Tema',
      themes: [
        { id: 'carbon', label: 'Carbón', hint: 'Casi negro y neutro, por defecto' },
        { id: 'grafito', label: 'Grafito', hint: 'Oscuro neutro, con un punto de azul' },
        { id: 'pizarra', label: 'Pizarra', hint: 'Gris azulado, más claro que Grafito' },
        { id: 'fosforo', label: 'Fósforo', hint: 'Oscuro cálido, papel y tinta' },
        { id: 'papel', label: 'Papel', hint: 'Claro, tinta sobre crema' },
        { id: 'contraste', label: 'Alto contraste', hint: 'Negro puro, bordes marcados' },
      ],
      accent: 'Color de acento',
      accents: [
        { id: 'ambar', label: 'Ámbar' },
        { id: 'menta', label: 'Menta' },
        { id: 'lavanda', label: 'Lavanda' },
        { id: 'coral', label: 'Coral' },
        { id: 'cian', label: 'Cian' },
      ],
      details: 'Detalles con personalidad',
      toggles: [
        { id: 'ascii', label: 'Arte ASCII en los estados vacíos', hint: 'Por ejemplo ( -_-) zZ cuando no hay nada en curso.', on: true },
        { id: 'greeting', label: 'Saludo según la hora', hint: 'Desactivado, la pantalla de inicio se titula «Inicio».', on: true },
        { id: 'grid', label: 'Retícula de puntos de fondo', hint: 'Textura sutil en Inicio, como papel de libreta.', on: true },
      ],
    },
    typography: {
      rows: [
        { role: 'Interfaz', font: 'Instrument Sans' },
        { role: 'Títulos', font: 'Martian Mono' },
        { role: 'Terminal', font: 'JetBrains Mono' },
      ],
      size: 'Tamaño de la terminal',
      sizes: [
        { id: '12', label: '12 px' },
        { id: '13', label: '13 px' },
        { id: '15', label: '15 px' },
      ],
    },
    terminal: {
      layout: 'Distribución inicial',
      layouts: [
        { id: '1', label: 'Una columna' },
        { id: '2', label: 'Dos columnas' },
        { id: '4', label: 'Cuatro' },
      ],
      toggles: [
        { id: 'tmux', label: 'Barra de tmux', hint: 'La barra inferior con las ventanas de la sesión.', on: true },
        { id: 'copy', label: 'Copiar al seleccionar', hint: 'Soltar el ratón copia la selección al portapapeles.', on: true },
        { id: 'preview', label: 'Miniatura de imágenes', hint: 'Al pasar el ratón por una ruta de imagen.', on: true },
        { id: 'viewer', label: 'Abrir el visor automáticamente', hint: 'Cuando una terminal visible escribe una ruta de imagen nueva.', on: false },
      ],
    },
    projects: { visible: 'Visible', hint: 'Un proyecto oculto deja de mostrarse en el panel.' },
    notifications: {
      toggles: [
        { id: 'system', label: 'Notificación del sistema', hint: 'Además del aviso dentro del panel.', on: false },
        { id: 'counter', label: 'Contador en el título de la pestaña', hint: 'Por ejemplo «(1) jdev-ai».', on: true },
        { id: 'sound', label: 'Sonido', hint: 'Sintetizado en el navegador.', on: true },
        { id: 'finish', label: 'Avisar también cuando una sesión termina', hint: 'Con su propio sonido.', on: false },
      ],
      sound: 'Cuando una sesión te espera',
      sounds: [
        { id: 'teletipo', label: 'Teletipo' },
        { id: 'campanilla', label: 'Campanilla' },
        { id: 'gota', label: 'Gota' },
        { id: 'marimba', label: 'Marimba' },
      ],
    },
    agents: {
      agent: 'Agente por defecto',
      agents: [
        { id: 'claude', label: 'Claude Code' },
        { id: 'codex', label: 'Codex' },
        { id: 'copilot', label: 'Copilot' },
        { id: 'opencode', label: 'OpenCode' },
      ],
      where: 'Dónde trabaja por defecto',
      places: [
        { id: 'principal', label: 'Checkout principal' },
        { id: 'worktree', label: 'Worktree nuevo' },
      ],
    },
    shortcuts: [
      { keys: 'Ctrl+Alt+← / →', action: 'Cambia de terminal' },
      { keys: 'Ctrl+Alt+N', action: 'Abre una sesión nueva' },
      { keys: 'Ctrl+Alt+L', action: 'Cambia la distribución' },
      { keys: 'Ctrl+Alt+Esc', action: 'Saca el foco de la terminal a su pestaña' },
      { keys: 'Ctrl+Retroceso', action: 'Borra la palabra anterior' },
      { keys: 'Ctrl+Supr', action: 'Borra la palabra siguiente' },
      { keys: 'Mayús+RePág / AvPág', action: 'Sube y baja una página del historial' },
    ],
    server: {
      rows: [
        { label: 'Dirección', value: '127.0.0.1' },
        { label: 'Puerto', value: '4317' },
        { label: 'Token', value: '~/.config/jdev-ai/panel-token' },
        { label: 'Ajustes', value: '~/.config/jdev-ai/panel.json' },
      ],
    },
  },
  en: {
    title: 'Settings',
    nav: 'Settings sections',
    sections: [
      { id: 'apariencia', label: 'Appearance', lead: 'How the panel looks. The terminals use the same theme.' },
      { id: 'tipografia', label: 'Typography', lead: 'The fonts of the interface, the titles and the terminal.' },
      { id: 'terminal', label: 'Terminal', lead: 'How the panel’s terminals behave.' },
      { id: 'proyectos', label: 'Projects', lead: 'Which projects are shown in the panel.' },
      { id: 'avisos', label: 'Notifications', lead: 'When a session is waiting for you (permission or question) or finishes.' },
      { id: 'agentes', label: 'Agents', lead: 'Which agent new sessions use and where they open.' },
      { id: 'atajos', label: 'Keyboard shortcuts', lead: 'The shortcuts of the panel and its terminals.' },
      { id: 'servidor', label: 'Local server', lead: 'The panel only listens on your machine.' },
    ],
    appearance: {
      theme: 'Theme',
      themes: [
        { id: 'carbon', label: 'Carbon', hint: 'Near-black and neutral, the default' },
        { id: 'grafito', label: 'Graphite', hint: 'Neutral dark with a touch of blue' },
        { id: 'pizarra', label: 'Slate', hint: 'Blue-grey, lighter than Graphite' },
        { id: 'fosforo', label: 'Phosphor', hint: 'Warm dark, paper and ink' },
        { id: 'papel', label: 'Paper', hint: 'Light, ink on cream' },
        { id: 'contraste', label: 'High contrast', hint: 'Pure black, strong borders' },
      ],
      accent: 'Accent colour',
      accents: [
        { id: 'ambar', label: 'Amber' },
        { id: 'menta', label: 'Mint' },
        { id: 'lavanda', label: 'Lavender' },
        { id: 'coral', label: 'Coral' },
        { id: 'cian', label: 'Cyan' },
      ],
      details: 'Details with personality',
      toggles: [
        { id: 'ascii', label: 'ASCII art in empty states', hint: 'For example ( -_-) zZ when nothing is in progress.', on: true },
        { id: 'greeting', label: 'Greeting by time of day', hint: 'When off, the home screen is titled “Home”.', on: true },
        { id: 'grid', label: 'Dotted background grid', hint: 'A subtle texture on Home, like notebook paper.', on: true },
      ],
    },
    typography: {
      rows: [
        { role: 'Interface', font: 'Instrument Sans' },
        { role: 'Titles', font: 'Martian Mono' },
        { role: 'Terminal', font: 'JetBrains Mono' },
      ],
      size: 'Terminal size',
      sizes: [
        { id: '12', label: '12 px' },
        { id: '13', label: '13 px' },
        { id: '15', label: '15 px' },
      ],
    },
    terminal: {
      layout: 'Initial layout',
      layouts: [
        { id: '1', label: 'One column' },
        { id: '2', label: 'Two columns' },
        { id: '4', label: 'Four' },
      ],
      toggles: [
        { id: 'tmux', label: 'tmux bar', hint: 'The bottom bar with the session’s windows.', on: true },
        { id: 'copy', label: 'Copy on select', hint: 'Releasing the mouse copies the selection to the clipboard.', on: true },
        { id: 'preview', label: 'Image thumbnails', hint: 'When hovering an image path.', on: true },
        { id: 'viewer', label: 'Open the viewer automatically', hint: 'When a visible terminal prints a new image path.', on: false },
      ],
    },
    projects: { visible: 'Visible', hint: 'A hidden project is no longer shown in the panel.' },
    notifications: {
      toggles: [
        { id: 'system', label: 'System notification', hint: 'In addition to the notice inside the panel.', on: false },
        { id: 'counter', label: 'Counter in the tab title', hint: 'For example “(1) jdev-ai”.', on: true },
        { id: 'sound', label: 'Sound', hint: 'Synthesized in the browser.', on: true },
        { id: 'finish', label: 'Also notify when a session finishes', hint: 'With its own sound.', on: false },
      ],
      sound: 'When a session is waiting for you',
      sounds: [
        { id: 'teletipo', label: 'Teletype' },
        { id: 'campanilla', label: 'Bell' },
        { id: 'gota', label: 'Drop' },
        { id: 'marimba', label: 'Marimba' },
      ],
    },
    agents: {
      agent: 'Default agent',
      agents: [
        { id: 'claude', label: 'Claude Code' },
        { id: 'codex', label: 'Codex' },
        { id: 'copilot', label: 'Copilot' },
        { id: 'opencode', label: 'OpenCode' },
      ],
      where: 'Where it works by default',
      places: [
        { id: 'principal', label: 'Main checkout' },
        { id: 'worktree', label: 'New worktree' },
      ],
    },
    shortcuts: [
      { keys: 'Ctrl+Alt+← / →', action: 'Switches terminal' },
      { keys: 'Ctrl+Alt+N', action: 'Opens a new session' },
      { keys: 'Ctrl+Alt+L', action: 'Changes the layout' },
      { keys: 'Ctrl+Alt+Esc', action: 'Moves focus from the terminal to its tab' },
      { keys: 'Ctrl+Backspace', action: 'Deletes the previous word' },
      { keys: 'Ctrl+Delete', action: 'Deletes the next word' },
      { keys: 'Shift+PgUp / PgDn', action: 'Scrolls the history one page up or down' },
    ],
    server: {
      rows: [
        { label: 'Address', value: '127.0.0.1' },
        { label: 'Port', value: '4317' },
        { label: 'Token', value: '~/.config/jdev-ai/panel-token' },
        { label: 'Settings', value: '~/.config/jdev-ai/panel.json' },
      ],
    },
  },
};

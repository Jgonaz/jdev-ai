// Fuente única de los atajos que se enseñan en Ajustes y en la chuleta de la cabecera.
// Al añadir o cambiar uno en useShortcuts.ts, terminalKeys.ts o en los menús, actualízalo aquí.

export type Shortcut = { teclas: string; accion: string };
export type ShortcutGroup = { titulo: string; atajos: Shortcut[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titulo: 'Panel',
    atajos: [
      { teclas: 'Ctrl+Alt+←', accion: 'Terminal anterior' },
      { teclas: 'Ctrl+Alt+→', accion: 'Terminal siguiente' },
      { teclas: 'Ctrl+Alt+N', accion: 'Nueva sesión' },
      { teclas: 'Ctrl+Alt+L', accion: 'Cambiar la distribución (una, dos columnas, cuatro)' },
      {
        teclas: 'Ctrl+Alt+Esc',
        accion: 'Salir del foco de la terminal: lleva el foco a la pestaña activa (Tab dentro de la terminal es de la shell, para autocompletar)',
      },
    ],
  },
  {
    titulo: 'En la terminal',
    atajos: [
      { teclas: 'Ctrl+Retroceso', accion: 'Borra la palabra anterior (envía Ctrl+W)' },
      { teclas: 'Ctrl+Supr', accion: 'Borra la palabra siguiente (envía Alt+D)' },
      {
        teclas: 'Mayús+RePág / Mayús+AvPág',
        accion: 'Sube y baja una página por el historial (el de tmux o, a pantalla completa, el de la aplicación)',
      },
    ],
  },
  {
    titulo: 'Menús, diálogos y paneles',
    atajos: [
      { teclas: 'Esc', accion: 'Cerrar un diálogo o un menú' },
      { teclas: 'Menú / Mayús+F10', accion: 'Abrir el menú contextual de la sesión, pestaña o conversación con el foco' },
      { teclas: '↑ / ↓ · Inicio / Fin', accion: 'Moverse por las opciones de un menú' },
      { teclas: '← / → · Inicio / Fin', accion: 'Cambiar de pestaña en una lista de pestañas' },
      { teclas: '← / → (Mayús: más)', accion: 'Con el foco en el borde de un panel lateral, cambiar su ancho; Inicio y Fin lo llevan al mínimo y al máximo' },
    ],
  },
];

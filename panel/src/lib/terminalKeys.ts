// Teclas que el navegador/xterm.js no traducen como se espera en el panel.

type KeyLike = Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'> & {
  isComposing?: boolean;
  getModifierState?: (clave: string) => boolean;
};

export type KeyTranslation = {
  /** Lo que se envía a la terminal en lugar de la secuencia de xterm.js. */
  send: string;
  /** La tecla mueve la vista por el historial de tmux: la barra de scroll debe refrescarse. */
  scroll?: boolean;
};

/** Ctrl+W: borra la palabra anterior (readline, bash y Claude Code lo entienden). */
export const DELETE_WORD_BACK = '\x17';
/** Alt+D: borra la palabra siguiente. */
export const DELETE_WORD_FORWARD = '\x1bd';
/**
 * Mayús+Enter en una sesión con agente: salto de línea sin enviar el prompt. Se
 * manda Ctrl+J (LF): es el salto de línea que traen de serie Claude Code, Codex y
 * OpenCode, y no depende de que la terminal hable el protocolo de teclado de
 * kitty. `\x1b\r` (Alt+Enter, lo que configura `/terminal-setup` de Claude Code)
 * es un atajo propio de cada agente y no es seguro en los tres.
 */
export const NEWLINE_NO_SUBMIT = '\n';
// Secuencias xterm con Mayús (modificador 2): tmux las reconoce como S-PPage y S-NPage.
const SHIFT_PAGE_UP = '\x1b[5;2~';
const SHIFT_PAGE_DOWN = '\x1b[6;2~';

/**
 * Traduce una pulsación antes de que xterm.js la procese; null deja que xterm
 * haga lo suyo. Solo actúa en keydown y sin composición:
 * - Ctrl+Retroceso → Ctrl+W y Ctrl+Supr → Alt+D (por defecto xterm manda ^H y
 *   «ESC[3;5~», que Claude Code y readline no tratan como borrar palabra).
 * - Mayús+Enter → salto de línea sin enviar, solo en sesiones con agente (xterm
 *   manda «\r», igual que Enter): en una terminal sin agente (`shell`) es Enter.
 * - Mayús+RePág/AvPág → las secuencias que tmux liga a su historial. xterm.js
 *   los atiende él mismo (mueve su viewport, que con tmux está vacío) y no los
 *   envía.
 * AltGr (que el navegador notifica como Ctrl+Alt) y el resto de teclas quedan fuera.
 */
export function translateTerminalKey(e: KeyLike, opciones: { shell?: boolean } = {}): KeyTranslation | null {
  if (e.type !== 'keydown' || e.isComposing || e.metaKey || e.altKey) return null;
  if (e.getModifierState?.('AltGraph')) return null;
  if (e.ctrlKey) {
    if (e.key === 'Backspace') return { send: DELETE_WORD_BACK };
    if (e.key === 'Delete') return { send: DELETE_WORD_FORWARD };
    return null;
  }
  if (e.shiftKey) {
    if (e.key === 'Enter' && !opciones.shell) return { send: NEWLINE_NO_SUBMIT };
    if (e.key === 'PageUp') return { send: SHIFT_PAGE_UP, scroll: true };
    if (e.key === 'PageDown') return { send: SHIFT_PAGE_DOWN, scroll: true };
  }
  return null;
}

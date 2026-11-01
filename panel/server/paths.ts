import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

// Directorio de configuración del panel: ${XDG_CONFIG_HOME:-~/.config}/jdev-ai.
// Según la especificación XDG, una ruta relativa en la variable se ignora.
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config');
  return join(base, 'jdev-ai');
}

// Directorio donde bin/session-state deja el estado de las sesiones de Claude:
// ${XDG_STATE_HOME:-~/.local/state}/jdev-ai/sessions.
export function sessionStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'state');
  return join(base, 'jdev-ai', 'sessions');
}

// Directorio de configuración de Claude Code: CLAUDE_CONFIG_DIR si es una ruta
// absoluta, y si no ~/.claude. Los transcripts están en <dir>/projects/<slug>/.
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir && isAbsolute(dir) ? dir : join(homedir(), '.claude');
}

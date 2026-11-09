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

// Directorio donde bin/session-done y el panel dejan si cada conversación está
// hecha o abierta: ${XDG_STATE_HOME:-~/.local/state}/jdev-ai/conversations.
export function conversationStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'state');
  return join(base, 'jdev-ai', 'conversations');
}

// Directorio de configuración de Claude Code: CLAUDE_CONFIG_DIR si es una ruta
// absoluta, y si no ~/.claude. Los transcripts están en <dir>/projects/<slug>/.
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir && isAbsolute(dir) ? dir : join(homedir(), '.claude');
}

// Carpeta de las imágenes que la persona adjunta desde el panel:
// ${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/uploads. Es caché (se borra sola a
// los 7 días), no estado.
export function uploadsDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache');
  return join(base, 'jdev-ai', 'panel', 'uploads');
}

// Carpeta donde bin/panel guarda los resúmenes que puede reconstruir sin perder
// nada: ${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel. Aquí vive el índice de actividad.
export function panelCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CACHE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.cache');
  return join(base, 'jdev-ai', 'panel');
}

// Directorio de Codex: CODEX_HOME si es una ruta absoluta, y si no ~/.codex.
// Sus sesiones están en <dir>/sessions/AAAA/MM/DD/rollout-*.jsonl.
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CODEX_HOME;
  return dir && isAbsolute(dir) ? dir : join(homedir(), '.codex');
}

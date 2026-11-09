import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Datos de prueba de la actividad. Las muestras de fixtures/activity/ son líneas
// reales de Claude Code y Codex, recortadas (sin el contenido de los mensajes) y
// anonimizadas (ids, rutas y fechas). Las funciones de aquí fabrican líneas con
// la misma forma para los casos que la muestra no cubre.

export const FIXTURES = join(import.meta.dirname, 'fixtures', 'activity');
export const fixtureText = (nombre: string): string => readFileSync(join(FIXTURES, nombre), 'utf8');

export type TestRoots = { tmp: string; claude: string; codex: string; cache: string };

export function makeRoots(): TestRoots {
  const tmp = mkdtempSync(join(tmpdir(), 'jdev-activity-'));
  const roots = { tmp, claude: join(tmp, 'claude', 'projects'), codex: join(tmp, 'codex', 'sessions'), cache: join(tmp, 'cache') };
  mkdirSync(roots.claude, { recursive: true });
  mkdirSync(roots.codex, { recursive: true });
  return roots;
}

export function put(ruta: string, texto: string): string {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
  return ruta;
}

export function putFixture(ruta: string, nombre: string): string {
  mkdirSync(dirname(ruta), { recursive: true });
  copyFileSync(join(FIXTURES, nombre), ruta);
  return ruta;
}

const SESSION = '11111111-1111-4111-8111-111111111111';

export type AssistantOpts = {
  id: string;
  ts: string;
  model?: string;
  out?: number;
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cwd?: string;
  tools?: { name: string; subagent?: string }[];
};

/** Línea `assistant` de un transcript de Claude Code, con la forma real y sin contenido. */
export function claudeAssistant(o: AssistantOpts): string {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: o.ts,
    cwd: o.cwd ?? '/home/dev/proyectos/jdev-ai/projects/alfa',
    sessionId: SESSION,
    message: {
      id: o.id,
      type: 'message',
      role: 'assistant',
      model: o.model ?? 'claude-opus-5-5',
      content: (o.tools ?? []).map((t) => ({ type: 'tool_use', id: `toolu_${o.id}`, name: t.name, input: t.subagent ? { subagent_type: t.subagent } : {} })),
      usage: {
        input_tokens: o.input ?? 2,
        cache_creation_input_tokens: o.cacheWrite ?? 10,
        cache_read_input_tokens: o.cacheRead ?? 100,
        output_tokens: o.out ?? 50,
      },
    },
  })}\n`;
}

export type TokenCountOpts = { ts: string; total: number; input?: number; cached?: number; out?: number };

/** Evento `token_count` de una sesión de Codex. */
export function codexTokenCount(o: TokenCountOpts): string {
  const usage = { input_tokens: o.input ?? 1000, cached_input_tokens: o.cached ?? 400, cache_write_input_tokens: 0, output_tokens: o.out ?? 30, reasoning_output_tokens: 10, total_tokens: (o.input ?? 1000) + (o.out ?? 30) };
  return `${JSON.stringify({ timestamp: o.ts, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { ...usage, total_tokens: o.total }, last_token_usage: usage } } })}\n`;
}

export const codexMeta = (ts: string, cwd: string, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ timestamp: ts, type: 'session_meta', payload: { id: '22222222-2222-4222-8222-222222222222', cwd, source: 'exec', thread_source: 'user', ...extra } })}\n`;

export const codexContext = (ts: string, model: string, cwd?: string): string =>
  `${JSON.stringify({ timestamp: ts, type: 'turn_context', payload: { turn_id: 't1', model, ...(cwd ? { cwd } : {}) } })}\n`;

export const codexCall = (ts: string, name: string, args = '{}'): string =>
  `${JSON.stringify({ timestamp: ts, type: 'response_item', payload: { type: 'function_call', name, arguments: args } })}\n`;

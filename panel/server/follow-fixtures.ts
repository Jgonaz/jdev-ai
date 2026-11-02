// Muestras del transcript de un subagente y del transcript de una sesión con una
// shell en segundo plano, con la forma real de Claude Code 2.1.316 (recortadas y
// anonimizadas): una línea JSON por mensaje, con los tipos internos intercalados.

const base = { isSidechain: true, agentId: 'a0c02c875dad9fa1e', userType: 'external', entrypoint: 'cli', cwd: '/home/u/proyecto', sessionKind: 'bg' };

let reloj = Date.parse('2026-11-02T10:00:00.000Z');
const marca = () => new Date((reloj += 1000)).toISOString();

export function reiniciarReloj(): void {
  reloj = Date.parse('2026-11-02T10:00:00.000Z');
}

export const encargo = (texto: string) =>
  JSON.stringify({ ...base, parentUuid: null, promptId: 'p1', type: 'user', message: { role: 'user', content: texto }, uuid: 'u0', timestamp: marca() });

export const recordatorio = () =>
  JSON.stringify({ ...base, type: 'user', message: { role: 'user', content: '<system-reminder>\nContexto del sistema\n</system-reminder>' }, uuid: 'u1', timestamp: marca() });

export const interno = () =>
  [
    JSON.stringify({ type: 'api-request-shape', sessionId: 's', agentId: 'a0c02c875dad9fa1e', id: 'r1', timestamp: marca() }),
    JSON.stringify({ type: 'api-request-blob', sessionId: 's', agentId: 'a0c02c875dad9fa1e', message: { content: [{ type: 'text', text: '<system-reminder>reglas</system-reminder>' }] } }),
    JSON.stringify({ ...base, type: 'attachment', attachment: { type: 'skill_listing' }, uuid: 'x', timestamp: marca() }),
  ].join('\n');

const asistente = (contenido: unknown[]) =>
  JSON.stringify({
    ...base,
    parentUuid: 'p',
    message: { model: 'claude-opus-5-5', id: 'msg_01', type: 'message', role: 'assistant', content: contenido, stop_reason: null },
    type: 'assistant',
    uuid: `as-${reloj}`,
    timestamp: marca(),
  });

export const pensar = () => asistente([{ type: 'thinking', thinking: '', signature: 'Zm9v' }]);
export const texto = (t: string) => asistente([{ type: 'text', text: t }]);
export const usar = (id: string, name: string, input: Record<string, unknown>) => asistente([{ type: 'tool_use', id, name, input, caller: { type: 'direct' } }]);

export const resultado = (id: string, contenido: string | { type: string; text: string }[], error = false) =>
  JSON.stringify({
    ...base,
    parentUuid: 'p',
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: contenido, ...(error ? { is_error: true } : {}) }] },
    uuid: `ur-${reloj}`,
    timestamp: marca(),
    toolUseResult: { stdout: '' },
  });

/** Un subagente completo: encargo, herramientas con y sin error, mensajes y resultado final. */
export function subagenteMuestra(): string {
  reiniciarReloj();
  return (
    [
      encargo('Ajusta components/LiveInput.tsx para que el campo no quede bajo el teclado de iOS.'),
      recordatorio(),
      interno(),
      pensar(),
      usar('t1', 'Read', { file_path: '/home/u/proyecto/components/LiveInput.tsx' }),
      resultado('t1', '     1\timport x from "y"\n     2\tconst a = 1\n     3\texport {}'),
      usar('t2', 'Grep', { pattern: 'visualViewport', path: '/home/u/proyecto/components' }),
      resultado('t2', 'components/LiveInput.tsx\ncomponents/Otro.tsx'),
      usar('t3', 'Edit', { file_path: '/home/u/proyecto/components/LiveInput.tsx', old_string: 'a\nb', new_string: 'a\nb\nc\nd' }),
      resultado('t3', 'The file components/LiveInput.tsx has been updated.'),
      usar('t4', 'Bash', { command: 'pnpm lint\necho hecho', description: 'Lint' }),
      resultado('t4', [{ type: 'text', text: "LiveInput.tsx:48 'scrollIntoView' no se usa\notra línea" }], true),
      pensar(),
      texto('Quito el import sobrante y vuelvo a pasar el lint.'),
      usar('t5', 'SubagentHandback', { message: 'He terminado: lint en verde.' }),
      resultado('t5', [{ type: 'text', text: '{"success":true}' }]),
    ].join('\n') + '\n'
  );
}

/** Línea del transcript de la sesión que lanzó una shell en segundo plano. */
export function lanzamientoShell(id: string, ruta: string): string {
  reiniciarReloj();
  return JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: 'toolu_01',
          type: 'tool_result',
          content: `== .\nCommand did not complete within its 300s timeout and was moved to the background (ID: ${id}). Output is being written to: ${ruta}. You will be notified when it completes. It is running now: do not start a second copy while it runs.`,
          is_error: false,
        },
      ],
    },
    uuid: 'u',
    timestamp: marca(),
    toolUseResult: { stdout: '== .', stderr: '', interrupted: false, backgroundTaskId: id, timedOutAfterMs: 300000 },
    sessionId: 's',
  });
}

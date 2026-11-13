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

// ------------------------------------------------- Conversación de una sesión

// Transcript de la sesión principal (no de un subagente): con la forma real de Claude Code, pero
// con contenido inventado. Incluye los «mensajes de usuario» sintéticos que Claude escribe y que
// no teclea la persona.
const principal = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: '/home/u/proyecto', sessionId: 's', version: '2.1.316', gitBranch: 'main' };
const humano = { origin: { kind: 'human' }, turnOrigin: 'human', promptSource: 'typed' };

/** Mensaje que teclea la persona (contenido como cadena). */
export const persona = (t: string) =>
  JSON.stringify({ ...principal, ...humano, parentUuid: null, promptId: 'p1', type: 'user', message: { role: 'user', content: t }, uuid: `h-${reloj}`, timestamp: marca() });

/** Mensaje de la persona con una imagen pegada: bloques de imagen y de texto. */
export const personaConImagen = (t: string) =>
  JSON.stringify({
    ...principal,
    ...humano,
    type: 'user',
    imagePasteIds: [1],
    message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: t }] },
    uuid: `hi-${reloj}`,
    timestamp: marca(),
  });

/** `user` de la sesión que no escribió la persona. */
export const sinteticos = (): string[] => {
  const linea = (extra: Record<string, unknown>, content: unknown) =>
    JSON.stringify({ ...principal, type: 'user', message: { role: 'user', content }, uuid: `s-${reloj}`, timestamp: marca(), ...extra });
  return [
    linea({ isMeta: true }, 'Contexto inyectado por Claude'),
    linea({ isMeta: true }, [{ type: 'text', text: '[Image: source: /tmp/captura.png]' }]),
    linea({}, '<system-reminder>\nRecordatorio del sistema\n</system-reminder>'),
    linea({ isMeta: true }, '<local-command-caveat>Caveat: mensajes generados por comandos locales</local-command-caveat>'),
    linea({}, '<bash-input> ls -la</bash-input>'),
    linea({}, '<bash-stdout>total 0</bash-stdout><bash-stderr></bash-stderr>'),
    linea({}, '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>'),
    linea({}, [{ type: 'text', text: '[Request interrupted by user]' }]),
    linea({ isCompactSummary: true, isVisibleInTranscriptOnly: true }, 'Resumen de la conversación anterior'),
    linea({ origin: { kind: 'task-notification' } }, 'Notificación de otro origen'),
    JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: marca(), content: 'mensaje en cola' }),
    JSON.stringify({ type: 'last-prompt', lastPrompt: 'algo' }),
    JSON.stringify({ ...principal, type: 'attachment', attachment: { type: 'skill_listing' }, uuid: 'x', timestamp: marca() }),
  ];
};

/** `user` de un comando de Claude Code: su invocación, su salida local (con ANSI), un `isMeta` interno y una skill. */
export const comandos = (): string[] => {
  const linea = (extra: Record<string, unknown>, content: unknown) =>
    JSON.stringify({ ...principal, type: 'user', message: { role: 'user', content }, uuid: `c-${reloj}`, timestamp: marca(), ...extra });
  return [
    linea({ isMeta: true }, '<local-command-caveat>Caveat: mensajes generados por comandos locales</local-command-caveat>'),
    linea({}, '<command-name>/goal</command-name>\n            <command-message>goal</command-message>\n            <command-args>close</command-args>'),
    linea({}, '<local-command-stdout>Goal cleared</local-command-stdout>'),
    linea({}, '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>'),
    linea({}, '<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m</local-command-stdout>'),
    linea({}, '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'),
    linea({}, '<local-command-stdout></local-command-stdout>'),
    linea({}, '<command-name>/mi-skill</command-name><command-message>mi-skill</command-message><command-args>a b</command-args>'),
    linea({ isMeta: true }, [{ type: 'text', text: 'Base directory for this skill: /x\n\nInstrucciones internas de la skill' }]),
  ];
};

/**
 * Claude 2.1.319 escribe algunos comandos (`/rename`, `/resume`, `/fork`, `/login`, a veces `/goal`) como líneas
 * `system/local_command`, con el mismo contenido que las de tipo `user`, más otros `system` que no son comandos.
 */
export const comandosDeSistema = (): string[] => {
  const linea = (subtype: string, content: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ ...principal, type: 'system', subtype, content, level: 'info', isMeta: false, uuid: `y-${reloj}`, timestamp: marca(), ...extra });
  return [
    linea('local_command', '<command-name>/rename</command-name>\n            <command-message>rename</command-message>\n            <command-args>mi sesión</command-args>'),
    linea('local_command', '<local-command-stdout>Session renamed to: mi sesión</local-command-stdout>'),
    linea('local_command', '<command-name>/resume</command-name>\n            <command-message>resume</command-message>\n            <command-args></command-args>'),
    linea('local_command', '<local-command-stdout>\u001b[2mResume cancelled\u001b[22m</local-command-stdout>'),
    linea('turn_duration', 'duración interna del turno'),
    linea('informational', '<command-name>/nada</command-name>'),
    linea('local_command', '<local-command-stdout>de un subagente</local-command-stdout>', { isSidechain: true }),
    linea('local_command', 42),
  ];
};

const asistentePrincipal = (contenido: unknown[]) =>
  JSON.stringify({ ...principal, parentUuid: 'p', message: { model: 'claude-opus-5-5', id: 'msg_01', type: 'message', role: 'assistant', content: contenido }, type: 'assistant', uuid: `a-${reloj}`, timestamp: marca() });
const resultadoPrincipal = (id: string, contenido: string, error = false) =>
  JSON.stringify({
    ...principal,
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: contenido, ...(error ? { is_error: true } : {}) }] },
    uuid: `r-${reloj}`,
    timestamp: marca(),
    toolUseResult: { stdout: '' },
  });

/**
 * Línea del asistente en la sesión principal con el `usage` de su mensaje. Claude Code escribe una línea por bloque de
 * contenido con el mismo `message.id` y el mismo `usage`, que crece mientras se genera la respuesta.
 */
export const asistenteConUso = (idMensaje: string, contenido: unknown[], outputTokens: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    ...principal,
    parentUuid: 'p',
    message: { model: 'claude-opus-5-5', id: idMensaje, type: 'message', role: 'assistant', content: contenido, usage: { input_tokens: 6, cache_read_input_tokens: 1200, output_tokens: outputTokens } },
    type: 'assistant',
    uuid: `au-${reloj}`,
    timestamp: marca(),
    ...extra,
  });

/** Dos turnos: mensajes de la persona, respuestas, herramientas (una con error), sintéticos y tipos internos entre medias. */
export function conversacionMuestra(): string {
  reiniciarReloj();
  return (
    [
      JSON.stringify({ type: 'permission-mode', permissionMode: 'default', sessionId: 's' }),
      persona('Revisa el login\ny dime qué falla'),
      ...sinteticos(),
      asistentePrincipal([{ type: 'thinking', thinking: '', signature: 'Zm9v' }]),
      asistentePrincipal([{ type: 'text', text: 'Miro el archivo del login.' }]),
      asistentePrincipal([{ type: 'tool_use', id: 'm1', name: 'Read', input: { file_path: '/home/u/proyecto/login.ts' } }]),
      resultadoPrincipal('m1', 'export const login = () => 1\n// TODO arreglar la sesión'),
      asistentePrincipal([{ type: 'tool_use', id: 'm2', name: 'Bash', input: { command: 'pnpm test' } }]),
      resultadoPrincipal('m2', 'FAIL login.test.ts\n  esperaba 2', true),
      asistentePrincipal([{ type: 'text', text: 'Falla el test: **esperaba 2**.' }]),
      personaConImagen('[Image #1] ¿y esta captura?'),
      persona('Gracias'),
      asistentePrincipal([{ type: 'text', text: 'De nada.' }]),
    ].join('\n') + '\n'
  );
}

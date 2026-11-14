import { describe, expect, it } from 'vitest';
import type { PendingWork } from './follow.ts';
import { PROMPT_HOOK_MAX_BYTES, parsePromptHook, pendingQuestionOf, relativeCwd } from './prompt-hook.ts';
import type { PromptHook } from './prompt-hook.ts';

const ID = '74eb06ff-9db7-493a-a821-6a674b1f0e5c';

// JSON reales de los hooks de Claude Code 2.1.325, sin las rutas personales.
const comun = {
  session_id: ID,
  transcript_path: `/home/u/.claude/projects/-home-u-proyecto/${ID}.jsonl`,
  cwd: '/home/u/proyecto',
  prompt_id: 'faecfd12-c076-4555-b18d-013ca6051fff',
  permission_mode: 'default',
  effort: { level: 'medium' },
};
const preguntas = {
  questions: [
    {
      question: '¿Quieres continuar con la eliminación de borrame.txt?',
      header: 'Confirmar',
      options: [
        { label: 'Sí', description: 'Continuar y ejecutar el borrado de borrame.txt' },
        { label: 'No', description: 'No ejecutar el borrado' },
      ],
      multiSelect: false,
    },
  ],
};
const pregunta = { ...comun, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: preguntas, tool_use_id: 'toolu_01RyMRZ3f1Nw4BqNTWtvf9A8' };
const permisoAsk = { ...comun, hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: preguntas };
const permisoBash = {
  ...comun,
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'rm -f borrame.txt', description: 'Delete borrame.txt if it exists' },
  permission_suggestions: [{ type: 'addDirectories', directories: ['/home/u/proyecto'], destination: 'session' }, { type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
};
const parsea = (o: unknown, id = ID): PromptHook | null => parsePromptHook(typeof o === 'string' ? o : JSON.stringify(o), 1234, id);

describe('parsePromptHook', () => {
  it('la pregunta de PreToolUse: id de la herramienta, preguntas completas y hora del archivo', () => {
    expect(parsea(pregunta)).toEqual({
      kind: 'question',
      sessionId: ID,
      toolUseId: 'toolu_01RyMRZ3f1Nw4BqNTWtvf9A8',
      at: 1234,
      questions: [
        {
          question: '¿Quieres continuar con la eliminación de borrame.txt?',
          header: 'Confirmar',
          multiSelect: false,
          options: [
            { label: 'Sí', description: 'Continuar y ejecutar el borrado de borrame.txt' },
            { label: 'No', description: 'No ejecutar el borrado' },
          ],
        },
      ],
    });
  });

  it('el permiso de Bash: herramienta, resumen con describeTool, comando completo y descripción', () => {
    expect(parsea(permisoBash)).toEqual({
      kind: 'permission',
      sessionId: ID,
      tool: 'Bash',
      cwd: '/home/u/proyecto',
      at: 1234,
      input: { verb: 'Ejecuto', target: 'rm -f borrame.txt', text: 'rm -f borrame.txt', description: 'Delete borrame.txt if it exists' },
    });
  });

  it('un comando de varias líneas: el objetivo es la primera y el texto, el comando entero', () => {
    const h = parsea({ ...permisoBash, tool_input: { command: 'git add .\ngit commit -m "x"' } });
    expect(h).toMatchObject({ input: { target: 'git add .', text: 'git add .\ngit commit -m "x"' } });
    expect(h).not.toHaveProperty('input.description');
  });

  it('otras herramientas: archivo con su cambio de líneas, URL y herramientas MCP', () => {
    expect(parsea({ ...permisoBash, tool_name: 'Edit', tool_input: { file_path: '/home/u/proyecto/src/a.ts', old_string: 'a', new_string: 'a\nb' } })).toMatchObject({
      tool: 'Edit',
      input: { verb: 'Edito', target: 'src/a.ts', text: 'src/a.ts', detail: '(+2 −1)' },
    });
    expect(parsea({ ...permisoBash, tool_name: 'WebFetch', tool_input: { url: 'https://example.com/x' } })).toMatchObject({ input: { verb: 'Consulto', target: 'https://example.com/x', text: 'https://example.com/x' } });
    expect(parsea({ ...permisoBash, tool_name: 'mcp__srv__hacer', tool_input: {} })).toMatchObject({ tool: 'mcp__srv__hacer', input: { verb: 'Uso', target: 'srv · hacer', text: 'srv · hacer' } });
  });

  it('un PermissionRequest de AskUserQuestion no es un permiso', () => {
    expect(parsea(permisoAsk)).toBeNull();
  });

  it('no es de esta sesión, no es JSON o no tiene la forma esperada: null', () => {
    expect(parsea(pregunta, 'otra-sesion')).toBeNull();
    expect(parsea('{"session_id":')).toBeNull();
    expect(parsea('[]')).toBeNull();
    expect(parsea({ ...pregunta, hook_event_name: 'PostToolUse' })).toBeNull();
    expect(parsea({ ...pregunta, tool_name: 'Bash' })).toBeNull();
    expect(parsea({ ...pregunta, tool_use_id: undefined })).toBeNull();
    expect(parsea({ ...pregunta, tool_use_id: '../x' })).toBeNull();
    expect(parsea({ ...pregunta, tool_input: {} })).toBeNull();
    expect(parsea({ ...permisoBash, tool_name: '' })).toBeNull();
    expect(parsea({ ...permisoBash, tool_name: 'a b' })).toBeNull();
    expect(parsea({ ...permisoBash, tool_name: undefined })).toBeNull();
  });

  it('con más preguntas u opciones que los topes no se ofrece (null)', () => {
    const q = preguntas.questions[0]!;
    expect(parsea({ ...pregunta, tool_input: { questions: Array.from({ length: 7 }, () => q) } })).toBeNull();
    expect(parsea({ ...pregunta, tool_input: { questions: [{ ...q, options: Array.from({ length: 9 }, () => q.options[0]) }] } })).toBeNull();
  });

  it('recorta los textos largos y el tope de tamaño coincide con el del script', () => {
    const h = parsea({ ...permisoBash, tool_input: { command: 'x'.repeat(5000), description: 'd'.repeat(5000) } }) as Extract<PromptHook, { kind: 'permission' }>;
    expect(h.input.text).toHaveLength(2000);
    expect(h.input.text.endsWith('…')).toBe(true);
    expect(h.input.target).toHaveLength(500);
    expect(h.input.description).toHaveLength(500);
    expect(PROMPT_HOOK_MAX_BYTES).toBe(256 * 1024);
  });
});

describe('relativeCwd', () => {
  it('relativo si cuelga del directorio de la sesión, absoluto si queda fuera, nada si es el mismo o falta', () => {
    expect(relativeCwd('/h/projects/foo', '/h')).toBe('projects/foo');
    expect(relativeCwd('/h/projects/foo/', '/h/')).toBe('projects/foo');
    expect(relativeCwd('/h', '/h')).toBeUndefined();
    expect(relativeCwd('/h/', '/h')).toBeUndefined();
    expect(relativeCwd('/hx/foo', '/h')).toBe('/hx/foo');
    expect(relativeCwd('/otro', '/h')).toBe('/otro');
    expect(relativeCwd('', '/h')).toBeUndefined();
    expect(relativeCwd('/otro', '')).toBe('/otro');
  });
});

describe('pendingQuestionOf', () => {
  const hook = parsea(pregunta)!;
  const ev = (id: string): NonNullable<PendingWork['question']> => ({ type: 'question', id, questions: [], at: 9 });
  const trabajo = (question: PendingWork['question'], resolved: string[] = []): PendingWork => ({ question, tools: [], resolved: new Set(resolved) });

  it('sin hook, la última de la transcripción', () => {
    expect(pendingQuestionOf(trabajo(ev('a')), null)).toEqual(ev('a'));
    expect(pendingQuestionOf(trabajo(null), null)).toBeNull();
    expect(pendingQuestionOf(trabajo(ev('a')), parsea(permisoBash))).toEqual(ev('a'));
  });

  it('con hook y sin línea en la transcripción, la del hook', () => {
    expect(pendingQuestionOf(trabajo(null), hook)).toEqual({ type: 'question', id: 'toolu_01RyMRZ3f1Nw4BqNTWtvf9A8', questions: (hook as { questions: unknown[] }).questions, at: 1234 });
  });

  it('con la misma pregunta ya en la transcripción, esa (con su hora)', () => {
    const t = ev('toolu_01RyMRZ3f1Nw4BqNTWtvf9A8');
    expect(pendingQuestionOf(trabajo(t), hook)).toBe(t);
  });

  it('con el resultado en la transcripción ya no está pendiente', () => {
    expect(pendingQuestionOf(trabajo(null, ['toolu_01RyMRZ3f1Nw4BqNTWtvf9A8']), hook)).toBeNull();
  });

  it('manda el hook sobre una pregunta antigua sin cerrar de la transcripción, y esta vuelve cuando el hook se resuelve', () => {
    const vieja = ev('toolu_vieja');
    expect(pendingQuestionOf(trabajo(vieja), hook)).toMatchObject({ id: 'toolu_01RyMRZ3f1Nw4BqNTWtvf9A8' });
    expect(pendingQuestionOf(trabajo(vieja, ['toolu_01RyMRZ3f1Nw4BqNTWtvf9A8']), hook)).toBe(vieja);
  });
});

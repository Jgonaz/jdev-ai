import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FOLLOW_CHUNK, FollowError, Follower, SHELL_TAIL_LINES, buscarSalida, describeTool, leerLineas, parseAgentLines, pendingWork } from './follow.ts';
import type { AgentEvent, FollowContext } from './follow.ts';
import { asistenteConUso, comandos, comandosDeSistema, conversacionMuestra, encargo, interno, lanzamientoShell, persona, personaConImagen, resultado, sinteticos, subagenteMuestra, texto, usar } from './follow-fixtures.ts';

describe('parseAgentLines', () => {
  const eventos = () => parseAgentLines(subagenteMuestra(), { primero: true, cwd: null });

  it('el encargo es el primer mensaje de usuario con texto, y solo ese', () => {
    const e = eventos();
    expect(e[0]).toEqual({ type: 'task', text: 'Ajusta components/LiveInput.tsx para que el campo no quede bajo el teclado de iOS.' });
    expect(e.filter((x) => x.type === 'task')).toHaveLength(1);
  });

  it('sin «primero» (a mitad del archivo) no hay encargo', () => {
    expect(parseAgentLines(subagenteMuestra(), { primero: false, cwd: null }).some((x) => x.type === 'task')).toBe(false);
  });

  it('cada herramienta lleva su verbo, su objetivo relativo al cwd y su detalle', () => {
    const e = eventos().filter((x): x is Extract<AgentEvent, { type: 'tool' }> => x.type === 'tool');
    expect(e.map((x) => [x.id, x.verb, x.target, x.detail])).toEqual([
      ['t1', 'Leo', 'components/LiveInput.tsx', undefined],
      ['t2', 'Busco', '«visualViewport» en components', undefined],
      ['t3', 'Edito', 'components/LiveInput.tsx', '(+4 −2)'],
      ['t4', 'Ejecuto', 'pnpm lint', undefined],
    ]);
    expect(e[0]!.at).toBeGreaterThan(Date.parse('2026-11-02T10:00:00.000Z'));
  });

  it('el resultado se asocia por id y marca el error', () => {
    const r = eventos().filter((x): x is Extract<AgentEvent, { type: 'result' }> => x.type === 'result');
    expect(r.find((x) => x.id === 't4')).toEqual({ type: 'result', id: 't4', error: true, summary: "LiveInput.tsx:48 'scrollIntoView' no se usa", lines: 2, at: expect.any(Number) });
    expect(r.find((x) => x.id === 't1')).toMatchObject({ error: false, lines: 3 });
  });

  it('cada herramienta lleva su estación, calculada con la entrada completa, en ambos modos', () => {
    const t = [
      usar('a', 'Read', { file_path: '/home/u/proyecto/a.ts' }),
      usar('b', 'Bash', { command: 'pnpm test\ngh pr view 12' }),
      usar('c', 'mcp__playwright__browser_click', {}),
      usar('d', 'Agent', { description: 'x' }),
      usar('e', 'Edit', { file_path: '/home/u/.claude/projects/-home-u-proyecto/memory/MEMORY.md' }),
      usar('f', 'Herramienta', {}),
    ].join('\n');
    for (const conversacion of [false, true]) {
      // En la conversación se descartan las líneas de subagentes: se reescriben como de la sesión principal.
      const e = parseAgentLines(conversacion ? t.replaceAll('"isSidechain":true', '"isSidechain":false') : t, { primero: false, cwd: null, conversacion }).filter((x): x is Extract<AgentEvent, { type: 'tool' }> => x.type === 'tool');
      expect(e.map((x) => x.station)).toEqual(['archivos', 'red', 'navegador', 'agentes', 'memoria', 'shell']);
    }
  });

  it('el resultado lleva la hora de su línea, o null si no la tiene', () => {
    const e = parseAgentLines([usar('a', 'Read', {}), resultado('a', 'ok'), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'x' }] } })].join('\n'), { primero: false, cwd: null });
    const [tool, r1, r2] = e as [Extract<AgentEvent, { type: 'tool' }>, Extract<AgentEvent, { type: 'result' }>, Extract<AgentEvent, { type: 'result' }>];
    expect(r1.at).toBeGreaterThan(tool.at!);
    expect(r2.at).toBeNull();
  });

  it('los mensajes son los text del asistente y el informe final de SubagentHandback; sin razonamiento ni tipos internos', () => {
    const m = eventos().filter((x) => x.type === 'message');
    expect(m.map((x) => x.text)).toEqual(['Quito el import sobrante y vuelvo a pasar el lint.', 'He terminado: lint en verde.']);
    expect(JSON.stringify(eventos())).not.toContain('signature');
    expect(JSON.stringify(eventos())).not.toContain('reglas');
    // SubagentHandback no se muestra como herramienta.
    expect(eventos().some((x) => x.type === 'tool' && x.tool === 'SubagentHandback')).toBe(false);
  });

  it('ignora líneas que no son JSON, objetos sin sentido y tipos desconocidos', () => {
    const t = ['no es json', '[1,2]', '{"type":"mensaje-futuro","x":1}', interno(), texto('hola')].join('\n');
    expect(parseAgentLines(t, { primero: false, cwd: null })).toEqual([{ type: 'message', text: 'hola', at: expect.any(Number) }]);
  });

  it('recorta el objetivo, el resumen y los mensajes', () => {
    const t = [usar('x', 'Bash', { command: 'a'.repeat(500) }), resultado('x', 'b'.repeat(500)), texto('c'.repeat(30000))].join('\n');
    const e = parseAgentLines(t, { primero: false, cwd: null });
    expect((e[0] as { target: string }).target).toHaveLength(200);
    expect((e[1] as { summary: string }).summary).toHaveLength(200);
    // Los mensajes llegan hasta 20 000 caracteres (el resultado final no se recorta a 4 000; el cliente recorta el resto).
    expect((e[2] as { text: string }).text).toHaveLength(20000);
  });

  it('el encargo también puede venir como bloques de texto', () => {
    const l = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Haz esto' }] } });
    expect(parseAgentLines(l, { primero: true, cwd: null })).toEqual([{ type: 'task', text: 'Haz esto' }]);
  });

  it('describeTool cubre las herramientas conocidas y deja las desconocidas con su nombre', () => {
    const cwd = '/p';
    expect(describeTool('Write', { file_path: '/p/a.ts', content: 'x\ny\nz' }, cwd)).toEqual({ verb: 'Escribo', target: 'a.ts', detail: '(+3)' });
    expect(describeTool('MultiEdit', { file_path: '/otro/a.ts', edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd', new_string: '' }] }, cwd)).toEqual({
      verb: 'Edito',
      target: '/otro/a.ts',
      detail: '(+2 −2)',
    });
    expect(describeTool('Glob', { pattern: '**/*.ts' }, cwd)).toEqual({ verb: 'Busco', target: '**/*.ts' });
    expect(describeTool('Agent', { description: 'Revisar', subagent_type: 'qa' }, cwd)).toEqual({ verb: 'Delego', target: 'Revisar' });
    expect(describeTool('WebFetch', { url: 'https://x.dev' }, cwd)).toEqual({ verb: 'Consulto', target: 'https://x.dev' });
    expect(describeTool('Skill', { skill: 'artifact-design', args: 'algo' }, cwd)).toEqual({ verb: 'Uso la skill', target: 'artifact-design' });
    expect(describeTool('mcp__playwright__browser_click', { a: 1 }, cwd)).toEqual({ verb: 'Uso', target: 'playwright · browser_click' });
    expect(describeTool('Desconocida', { a: 1 }, cwd)).toEqual({ verb: 'Desconocida', target: '' });
    expect(describeTool('Read', null, cwd)).toEqual({ verb: 'Leo', target: '' });
  });
});

/** Línea del asistente sin `usage` (formato antiguo o mensaje sintético). */
const asistentePrincipalSinUso = () => JSON.stringify({ type: 'assistant', isSidechain: false, message: { id: 'msg_s', role: 'assistant', content: [{ type: 'text', text: 'sin uso' }] } });

describe('parseAgentLines en modo conversación', () => {
  const eventos = (t = conversacionMuestra()) => parseAgentLines(t, { primero: true, cwd: null, conversacion: true });
  const delTipo = <T extends AgentEvent['type']>(t: T) => eventos().filter((x): x is Extract<AgentEvent, { type: T }> => x.type === t);

  it('emite cada mensaje real de la persona, con su marca de tiempo y sus saltos de línea, y no hay encargo', () => {
    const u = delTipo('user');
    expect(u.map((x) => x.text)).toEqual(['Revisa el login\ny dime qué falla', '[Image #1] ¿y esta captura?', 'Gracias']);
    expect(u[0]!.at).toBe(Date.parse('2026-11-02T10:00:01.000Z'));
    expect(eventos().some((x) => x.type === 'task')).toBe(false);
  });

  it('descarta los user sintéticos: recordatorios, meta, comandos locales, bash, notificaciones, interrupciones y resúmenes', () => {
    expect(eventos(sinteticos().join('\n'))).toEqual([]);
    const json = JSON.stringify(eventos());
    for (const ajeno of ['Recordatorio', 'inyectado', 'Caveat', 'ls -la', 'total 0', 'task-id', 'interrupted', 'Resumen de la conversación', 'otro origen', 'en cola']) {
      expect(json).not.toContain(ajeno);
    }
  });

  it('un comando es un evento con su nombre sin la barra y sus argumentos, y su salida local otro, sin ANSI', () => {
    const e = eventos(comandos().join('\n'));
    expect(e).toEqual([
      { type: 'command', name: 'goal', args: 'close', at: expect.any(Number) },
      { type: 'command-output', text: 'Goal cleared', error: false, at: expect.any(Number) },
      { type: 'command', name: 'compact', args: '', at: expect.any(Number) },
      { type: 'command-output', text: 'Compacted (ctrl+o to see full summary)', error: false, at: expect.any(Number) },
      { type: 'command', name: 'clear', args: '', at: expect.any(Number) },
      { type: 'command', name: 'mi-skill', args: 'a b', at: expect.any(Number) },
    ]);
    expect(JSON.stringify(e)).not.toContain('\\u001b');
  });

  it('oculta lo isMeta de un comando: el aviso local y las instrucciones internas de una skill', () => {
    const json = JSON.stringify(eventos(comandos().join('\n')));
    expect(json).not.toContain('Caveat');
    expect(json).not.toContain('Instrucciones internas');
    expect(json).not.toContain('Base directory');
  });

  it('la salida con stderr es un error, se une a la de stdout y una salida vacía o «(no content)» no se emite', () => {
    const l = (c: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: c }, timestamp: '2026-11-02T10:00:00.000Z' });
    const out = eventos(
      [
        l('<local-command-stdout>uno</local-command-stdout><local-command-stderr>\u001b[31mfalló\u001b[39m</local-command-stderr>'),
        l('<local-command-stdout>(no content)</local-command-stdout>'),
        l('<local-command-stdout>  </local-command-stdout>'),
      ].join('\n'),
    );
    expect(out).toEqual([{ type: 'command-output', text: 'uno\nfalló', error: true, at: expect.any(Number) }]);
  });

  it('el contenido del comando también llega como bloques de texto, y su salida se recorta', () => {
    const bloques = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<command-name>/rename</command-name><command-args>mi sesión</command-args>' }] } });
    const salida = JSON.stringify({ type: 'user', message: { role: 'user', content: `<local-command-stdout>${'x'.repeat(9000)}</local-command-stdout>` } });
    const e = eventos([bloques, salida].join('\n'));
    expect(e[0]).toMatchObject({ type: 'command', name: 'rename', args: 'mi sesión' });
    expect((e[1] as { text: string }).text).toHaveLength(4000);
  });

  it('sin modo conversación (subagente) no emite comandos', () => {
    expect(parseAgentLines(comandos().join('\n'), { primero: false, cwd: null })).toEqual([]);
    expect(parseAgentLines(comandosDeSistema().join('\n'), { primero: false, cwd: null })).toEqual([]);
  });

  it('los comandos escritos como system/local_command emiten los mismos eventos que los de tipo user', () => {
    expect(eventos(comandosDeSistema().join('\n'))).toEqual([
      { type: 'command', name: 'rename', args: 'mi sesión', at: expect.any(Number) },
      { type: 'command-output', text: 'Session renamed to: mi sesión', error: false, at: expect.any(Number) },
      { type: 'command', name: 'resume', args: '', at: expect.any(Number) },
      { type: 'command-output', text: 'Resume cancelled', error: false, at: expect.any(Number) },
    ]);
  });

  it('los comandos system se intercalan en orden con el resto de la conversación', () => {
    const e = eventos([persona('hola'), ...comandosDeSistema().slice(0, 2), persona('adiós')].join('\n'));
    expect(e.map((x) => x.type)).toEqual(['user', 'command', 'command-output', 'user']);
  });

  it('quita el envoltorio de un pegado largo cuando abre y cierra con el mismo id, y no toca el resto', () => {
    const msg = (t: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: t }, timestamp: '2026-11-02T10:00:00.000Z' });
    const e = eventos(
      [
        msg('¿por qué falla? \n\n<pasted_content id="2a51">\n{\n  "error": true\n}\n</pasted_content id="2a51">\n'),
        msg('\n\n<pasted_content id="7">\nsolo el pegado\n</pasted_content id="7">\n'),
        msg('uno <pasted_content id="1">\na\n</pasted_content id="1"> y <pasted_content id="2">\nb\n</pasted_content id="2">\n'),
        msg('ids distintos <pasted_content id="1">\nx\n</pasted_content id="2">\n'),
        msg('sin cerrar <pasted_content id="3">\nx'),
      ].join('\n'),
    );
    expect(e.map((x) => (x as { text: string }).text)).toEqual([
      '¿por qué falla? \n\n{\n  "error": true\n}',
      'solo el pegado',
      'uno a y b',
      'ids distintos <pasted_content id="1">\nx\n</pasted_content id="2">',
      'sin cerrar <pasted_content id="3">\nx',
    ]);
  });

  it('el envoltorio de un pegado también se quita en los bloques de texto de un mensaje con imagen', () => {
    const l = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'mira\n\n<pasted_content id="9">\nlog\n</pasted_content id="9">\n' }] },
      timestamp: '2026-11-02T10:00:00.000Z',
    });
    expect(eventos(l)).toEqual([{ type: 'user', text: 'mira\n\nlog', at: expect.any(Number), images: 1 }]);
  });

  it('quita un recordatorio pegado a un mensaje real y conserva el resto', () => {
    const l = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Haz esto' }, { type: 'text', text: '<system-reminder>reglas</system-reminder>' }] }, timestamp: '2026-11-02T10:00:00.000Z' });
    expect(eventos(l)).toEqual([{ type: 'user', text: 'Haz esto', at: Date.parse('2026-11-02T10:00:00.000Z') }]);
    const m = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Haz esto\n<system-reminder>reglas</system-reminder>' } });
    expect(eventos(m)).toEqual([{ type: 'user', text: 'Haz esto', at: null }]);
  });

  it('un mensaje con imagen lleva su texto y cuántas imágenes trae; solo imagen también cuenta', () => {
    expect(delTipo('user')[1]).toMatchObject({ text: '[Image #1] ¿y esta captura?', images: 1 });
    expect(delTipo('user')[2]).not.toHaveProperty('images');
    const solo = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'image', source: {} }] } });
    expect(eventos(solo)).toEqual([{ type: 'user', text: '', at: null, images: 1 }]);
    // Los datos de la imagen nunca viajan.
    expect(JSON.stringify(eventos())).not.toContain('AAAA');
  });

  it('las herramientas, sus resultados con error y los mensajes del agente siguen igual, y los resultados llevan su texto para buscar', () => {
    const e = eventos();
    expect(e.filter((x) => x.type === 'tool').map((x) => (x as { verb: string; target: string }).verb + ' ' + (x as { target: string }).target)).toEqual(['Leo login.ts', 'Ejecuto pnpm test']);
    const r = delTipo('result');
    expect(r.find((x) => x.id === 'm2')).toMatchObject({ error: true, summary: 'FAIL login.test.ts', lines: 2, output: 'FAIL login.test.ts\n  esperaba 2' });
    expect(r.find((x) => x.id === 'm1')).toMatchObject({ error: false });
    expect(delTipo('message').map((x) => x.text)).toEqual(['Miro el archivo del login.', 'Falla el test: **esperaba 2**.', 'De nada.']);
    expect(JSON.stringify(e)).not.toContain('signature');
  });

  it('el orden de la conversación se conserva', () => {
    expect(eventos().map((x) => x.type)).toEqual(['user', 'message', 'tool', 'result', 'tool', 'result', 'message', 'user', 'user', 'message']);
  });

  it('ignora lo de los subagentes (isSidechain) y los tipos desconocidos', () => {
    const l = JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'encargo del subagente' } });
    expect(eventos(['{"type":"mensaje-futuro"}', 'no es json', l, persona('hola')].join('\n'))).toEqual([{ type: 'user', text: 'hola', at: expect.any(Number) }]);
  });

  it('el modo subagente no cambia: sigue sin emitir mensajes de usuario', () => {
    const e = parseAgentLines([persona('hola'), personaConImagen('x')].join('\n'), { primero: false, cwd: null });
    expect(e).toEqual([]);
  });

  it('emite los tokens de salida de cada mensaje del asistente una sola vez aunque sus líneas repitan el usage', () => {
    // Tres líneas del mismo mensaje (pensar, texto y herramienta) con el valor creciendo, y otro mensaje después.
    const e = eventos(
      [
        persona('hola'),
        asistenteConUso('msg_a', [{ type: 'thinking', thinking: '', signature: 'Zm9v' }], 12),
        asistenteConUso('msg_a', [{ type: 'text', text: 'Miro.' }], 12),
        asistenteConUso('msg_a', [{ type: 'tool_use', id: 'x1', name: 'Read', input: { file_path: '/home/u/proyecto/a.ts' } }], 340),
        asistenteConUso('msg_b', [{ type: 'text', text: 'Listo.' }], 95),
      ].join('\n'),
    );
    expect(e.filter((x) => x.type === 'usage')).toEqual([
      { type: 'usage', id: 'msg_a', output: 340, at: expect.any(Number) },
      { type: 'usage', id: 'msg_b', output: 95, at: expect.any(Number) },
    ]);
    // El resto de eventos no cambia.
    expect(e.filter((x) => x.type !== 'usage').map((x) => x.type)).toEqual(['user', 'message', 'tool', 'message']);
  });

  it('no emite tokens sin id, sin usage válido, en los subagentes ni en lo que hacen los subagentes dentro de la sesión', () => {
    const sinUso = asistentePrincipalSinUso();
    const malo = asistenteConUso('msg_x', [{ type: 'text', text: 'x' }], -3);
    const subagente = asistenteConUso('msg_y', [{ type: 'text', text: 'y' }], 50, { isSidechain: true });
    expect(eventos([sinUso, malo, subagente].join('\n')).filter((x) => x.type === 'usage')).toEqual([]);
    const delSubagente = parseAgentLines(asistenteConUso('msg_z', [{ type: 'text', text: 'z' }], 50), { primero: false, cwd: null });
    expect(delSubagente.map((x) => x.type)).toEqual(['message']);
  });

  it('recorta el texto de un resultado y el de un mensaje de la persona', () => {
    const res = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'b'.repeat(9000) }] } });
    const e = eventos([persona('a'.repeat(30000)), res].join('\n'));
    expect((e[0] as { text: string }).text).toHaveLength(20000);
    expect((e[1] as { output: string }).output).toHaveLength(4000);
  });
});

describe('leerLineas', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-follow-lines-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const leer = async (contenido: string | Buffer, desde: number) => {
    const ruta = join(tmp, 'f.jsonl');
    writeFileSync(ruta, contenido);
    const fh = await open(ruta, 'r');
    try {
      return await leerLineas(fh, desde, (await fh.stat()).size);
    } finally {
      await fh.close();
    }
  };

  it('devuelve líneas completas y no consume la última si aún se está escribiendo', async () => {
    const v = await leer('uno\ndos\ntres a med', 0);
    expect(v).toEqual({ texto: 'uno\ndos\n', next: 8, more: false });
    expect(await leer('uno\ndos\ntres a med', 8)).toEqual({ texto: '', next: 8, more: false });
  });

  it('en un archivo mayor que el trozo avanza por líneas completas y avisa de que hay más', async () => {
    const linea = 'x'.repeat(1000) + '\n';
    const total = Math.ceil((FOLLOW_CHUNK * 2.5) / linea.length);
    const v = await leer(linea.repeat(total), 0);
    expect(v.more).toBe(true);
    expect(v.texto.length).toBe(v.next);
    expect(v.next % linea.length).toBe(0);
    expect(v.next).toBeLessThanOrEqual(FOLLOW_CHUNK);
  });

  it('una línea mayor que el trozo se lee entera mientras no pase de 2 MiB', async () => {
    const grande = 'y'.repeat(FOLLOW_CHUNK + 5000);
    const v = await leer(`${grande}\nfin\n`, 0);
    expect(v.texto).toBe(`${grande}\n`);
    expect(v.next).toBe(grande.length + 1);
    expect(v.more).toBe(true);
  });

  it('una línea de más de 2 MiB se salta entera', async () => {
    const enorme = 'z'.repeat(2 * 1024 * 1024 + 10);
    const v = await leer(`${enorme}\nfin\n`, 0);
    expect(v.texto).toBe('');
    expect(v.next).toBe(enorme.length + 1);
    const siguiente = await leer(`${enorme}\nfin\n`, v.next);
    expect(siguiente.texto).toBe('fin\n');
  });

  it('una línea enorme sin final todavía espera', async () => {
    const v = await leer('q'.repeat(FOLLOW_CHUNK + 10), 0);
    expect(v).toEqual({ texto: '', next: 0, more: false });
  });
});

describe('Follower', () => {
  let tmp: string;
  let proyectos: string;
  let temporales: string;
  let sesionDir: string;
  let salidas: string;
  const sid = '41ee4ee5-43e5-4573-9b45-c76007be1875';
  const uid = process.getuid!();

  const contexto = (extra: Partial<FollowContext> = {}): FollowContext => ({
    sessionId: sid,
    transcriptPath: join(proyectos, '-proj', `${sid}.jsonl`),
    cwd: '/home/u/proyecto',
    targets: {
      subagents: new Map([['a0c02c875dad9fa1e', { type: 'implementer', since: 1_000, stopped: false }]]),
      shells: new Map([['beifl810b', { label: 'pnpm dev', running: true }]]),
    },
    ...extra,
  });
  const seguidor = (extra: { uid?: number | null } = {}) => new Follower({ projectsDir: proyectos, tmpRoots: [temporales], ...extra });
  const archivoAgente = () => join(sesionDir, 'subagents', 'agent-a0c02c875dad9fa1e.jsonl');
  const rechazado = async (p: Promise<unknown>, status = 404) => {
    const e = await p.then(
      () => null,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(FollowError);
    expect((e as FollowError).status).toBe(status);
    return (e as FollowError).message;
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-follow-'));
    proyectos = join(tmp, 'claude', 'projects');
    temporales = join(tmp, 'tmp');
    sesionDir = join(proyectos, '-proj', sid);
    salidas = join(temporales, `claude-${uid}`, '-proj', 'otro-id', 'tasks');
    mkdirSync(join(sesionDir, 'subagents'), { recursive: true });
    mkdirSync(salidas, { recursive: true });
    writeFileSync(join(proyectos, '-proj', `${sid}.jsonl`), lanzamientoShell('beifl810b', join(salidas, 'beifl810b.output')) + '\n');
    writeFileSync(archivoAgente(), subagenteMuestra());
    writeFileSync(join(sesionDir, 'subagents', 'agent-a0c02c875dad9fa1e.meta.json'), JSON.stringify({ agentType: 'implementer', description: 'Ajustar el input', toolUseId: 'toolu_1', finished: false }));
    writeFileSync(join(salidas, 'beifl810b.output'), '> dev\nlisto\n');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  describe('subagente', () => {
    it('sirve los eventos interpretados, el estado y los metadatos', async () => {
      const r = await seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0);
      expect(r).toMatchObject({
        kind: 'agent',
        state: 'running',
        reset: false,
        more: false,
        meta: { description: 'Ajustar el input', agentType: 'implementer', startedAt: 1_000 },
      });
      expect(r.events[0]).toMatchObject({ type: 'task' });
      expect(r.events.filter((e) => e.type === 'tool')).toHaveLength(4);
      expect(r.from).toBe(Buffer.byteLength(subagenteMuestra()));
    });

    it('lee solo lo nuevo desde `from` y no repite el encargo', async () => {
      const s = seguidor();
      const primera = await s.agent(contexto(), 'a0c02c875dad9fa1e', 0);
      appendFileSync(archivoAgente(), texto('Una más') + '\n');
      const segunda = await s.agent(contexto(), 'a0c02c875dad9fa1e', primera.from);
      expect(segunda.events).toEqual([{ type: 'message', text: 'Una más', at: expect.any(Number) }]);
      expect(segunda.reset).toBe(false);
    });

    it('si el archivo encoge empieza de nuevo y lo indica', async () => {
      const s = seguidor();
      const primera = await s.agent(contexto(), 'a0c02c875dad9fa1e', 0);
      writeFileSync(archivoAgente(), encargo('Otro encargo') + '\n');
      const r = await s.agent(contexto(), 'a0c02c875dad9fa1e', primera.from);
      expect(r.reset).toBe(true);
      expect(r.events).toEqual([{ type: 'task', text: 'Otro encargo' }]);
    });

    it('termina por el meta.json o por la actividad', async () => {
      writeFileSync(join(sesionDir, 'subagents', 'agent-a0c02c875dad9fa1e.meta.json'), JSON.stringify({ finished: true }));
      expect((await seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0)).state).toBe('finished');
      writeFileSync(join(sesionDir, 'subagents', 'agent-a0c02c875dad9fa1e.meta.json'), '{ no es json');
      expect((await seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0)).state).toBe('running');
      const parado = contexto();
      parado.targets.subagents.set('a0c02c875dad9fa1e', { type: 'implementer', since: 1_000, stopped: true });
      const r = await seguidor().agent(parado, 'a0c02c875dad9fa1e', 0);
      expect(r).toMatchObject({ state: 'finished', meta: { description: null, agentType: 'implementer' } });
    });

    it('una línea cortada al final no se consume hasta que se completa', async () => {
      const s = seguidor();
      const primera = await s.agent(contexto(), 'a0c02c875dad9fa1e', 0);
      const linea = texto('Mensaje completo');
      appendFileSync(archivoAgente(), linea.slice(0, 40));
      const a = await s.agent(contexto(), 'a0c02c875dad9fa1e', primera.from);
      expect(a).toMatchObject({ events: [], from: primera.from });
      appendFileSync(archivoAgente(), linea.slice(40) + '\n');
      const b = await s.agent(contexto(), 'a0c02c875dad9fa1e', a.from);
      expect(b.events).toEqual([{ type: 'message', text: 'Mensaje completo', at: expect.any(Number) }]);
    });

    it('rechaza ids que no constan en la actividad o con formato no válido', async () => {
      await rechazado(seguidor().agent(contexto(), 'zzzz', 0));
      await rechazado(seguidor().agent(contexto(), '../../etc/passwd', 0));
      const ctx = contexto();
      ctx.targets.subagents.set('../x', { type: 'x', since: null, stopped: false });
      await rechazado(seguidor().agent(ctx, '../x', 0));
    });

    it('404 si no hay transcript o el archivo del subagente no existe', async () => {
      const sinTranscript = contexto({ transcriptPath: '' });
      expect(await rechazado(seguidor().agent(sinTranscript, 'a0c02c875dad9fa1e', 0))).toMatch(/No hay datos que mostrar/);
      await rechazado(seguidor().agent(contexto({ transcriptPath: join(proyectos, '-proj', 'no-existe.jsonl') }), 'a0c02c875dad9fa1e', 0));
      rmSync(archivoAgente());
      await rechazado(seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0));
    });

    it('rechaza un transcript fuera del directorio de proyectos de Claude', async () => {
      const fuera = join(tmp, 'fuera.jsonl');
      writeFileSync(fuera, '');
      await rechazado(seguidor().agent(contexto({ transcriptPath: fuera }), 'a0c02c875dad9fa1e', 0));
    });

    it('no sigue un enlace simbólico al archivo ni a la carpeta fuera de los proyectos', async () => {
      const secreto = join(tmp, 'secreto.jsonl');
      writeFileSync(secreto, encargo('SECRETO') + '\n');
      rmSync(archivoAgente());
      symlinkSync(secreto, archivoAgente());
      await rechazado(seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0));

      rmSync(archivoAgente());
      rmSync(join(sesionDir, 'subagents'), { recursive: true });
      mkdirSync(join(tmp, 'ajena'));
      writeFileSync(join(tmp, 'ajena', 'agent-a0c02c875dad9fa1e.jsonl'), encargo('SECRETO') + '\n');
      symlinkSync(join(tmp, 'ajena'), join(sesionDir, 'subagents'));
      await rechazado(seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0));
    });

    it('un enlace simbólico a otro archivo de los proyectos, fuera de la carpeta subagents/ de la sesión, tampoco se sigue', async () => {
      const otro = join(proyectos, '-proj', 'otra-sesion.jsonl');
      writeFileSync(otro, encargo('OTRA SESIÓN') + '\n');
      rmSync(archivoAgente());
      symlinkSync(otro, archivoAgente());
      await rechazado(seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0));
    });

    it('una tubería (FIFO) como transcript del subagente o como .meta.json da 404 sin colgar', async () => {
      rmSync(archivoAgente());
      execFileSync('mkfifo', [archivoAgente()]);
      await rechazado(seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0));
      rmSync(archivoAgente());
      writeFileSync(archivoAgente(), subagenteMuestra());
      const meta = join(sesionDir, 'subagents', 'agent-a0c02c875dad9fa1e.meta.json');
      rmSync(meta);
      execFileSync('mkfifo', [meta]);
      // El meta ilegible no impide servir el transcript.
      expect((await seguidor().agent(contexto(), 'a0c02c875dad9fa1e', 0)).meta.description).toBeNull();
    });

    it('una tubería (FIFO) como transcript de la sesión da 404 al buscar la shell', async () => {
      const t = join(proyectos, '-proj', `${sid}.jsonl`);
      rmSync(t);
      execFileSync('mkfifo', [t]);
      await rechazado(seguidor().shell(contexto(), 'beifl810b', null));
    });

    it('solo sirve archivos del usuario', async () => {
      await rechazado(seguidor({ uid: uid + 1 }).agent(contexto(), 'a0c02c875dad9fa1e', 0));
      await rechazado(seguidor({ uid: null }).agent(contexto(), 'a0c02c875dad9fa1e', 0));
    });

    it('un session_id con barras o puntos no se usa para construir la ruta', async () => {
      await rechazado(seguidor().agent(contexto({ sessionId: '../x' }), 'a0c02c875dad9fa1e', 0));
    });
  });

  describe('conversación', () => {
    const archivo = () => join(proyectos, '-proj', `${sid}.jsonl`);
    const ctxConversacion = () => contexto();

    it('sirve los eventos de la conversación principal, con el tamaño y sin más por leer', async () => {
      writeFileSync(archivo(), conversacionMuestra());
      const r = await seguidor().conversation(ctxConversacion(), 0);
      expect(r).toMatchObject({ sessionId: sid, reset: false, more: false });
      expect(r.size).toBe(r.from);
      expect(r.events.filter((e) => e.type === 'user')).toHaveLength(3);
      expect(r.events.filter((e) => e.type === 'tool')).toHaveLength(2);
    });

    it('es incremental: lo nuevo llega desde `from`, y una línea a medio escribir espera', async () => {
      writeFileSync(archivo(), conversacionMuestra());
      const primera = await seguidor().conversation(ctxConversacion(), 0);
      const nueva = persona('Otra cosa');
      appendFileSync(archivo(), nueva.slice(0, 30));
      expect(await seguidor().conversation(ctxConversacion(), primera.from)).toMatchObject({ events: [], from: primera.from });
      appendFileSync(archivo(), nueva.slice(30) + '\n');
      const siguiente = await seguidor().conversation(ctxConversacion(), primera.from);
      expect(siguiente.events).toEqual([{ type: 'user', text: 'Otra cosa', at: expect.any(Number) }]);
      expect(siguiente.from).toBe(siguiente.size);
    });

    it('en un archivo mayor que el trozo avisa de que hay más y se pide hasta el final', async () => {
      const relleno = Array.from({ length: 4000 }, (_, i) => persona(`mensaje ${i} ${'x'.repeat(100)}`)).join('\n') + '\n';
      writeFileSync(archivo(), relleno);
      let desde = 0;
      let total = 0;
      let peticiones = 0;
      for (;;) {
        const r = await seguidor().conversation(ctxConversacion(), desde);
        peticiones++;
        total += r.events.length;
        desde = r.from;
        if (!r.more) break;
      }
      expect(peticiones).toBeGreaterThan(1);
      expect(total).toBe(4000);
    });

    it('si el archivo encoge, empieza de cero y lo avisa', async () => {
      writeFileSync(archivo(), conversacionMuestra());
      const r = await seguidor().conversation(ctxConversacion(), 0);
      writeFileSync(archivo(), persona("Nuevo") + '\n');
      const otra = await seguidor().conversation(ctxConversacion(), r.from);
      expect(otra).toMatchObject({ reset: true });
      expect(otra.events).toHaveLength(1);
    });

    it('404 si no hay transcript, no existe o queda fuera de los proyectos de Claude; no lee enlaces ni tuberías', async () => {
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: '' }), 0))).toMatch(/aún no tiene transcript/);
      // Un transcript que no existe NO es «todavía no» si es un enlace roto o su ruta se sale de los proyectos.
      symlinkSync(join(tmp, 'nada.jsonl'), join(proyectos, '-proj', 'roto.jsonl'));
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: join(proyectos, '-proj', 'roto.jsonl') }), 0))).toMatch(/no existe/);
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: join(tmp, 'ausente.jsonl') }), 0))).toMatch(/no existe/);
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: join(proyectos, '-proj', '..', '..', 'ausente.jsonl') }), 0))).toMatch(/no existe/);
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: join(proyectos, '-proj', 'ausente.txt') }), 0))).toMatch(/no existe/);
      const fuera = join(tmp, 'fuera.jsonl');
      writeFileSync(fuera, conversacionMuestra());
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: fuera }), 0))).toMatch(/fuera del directorio de proyectos/);
      symlinkSync(fuera, join(proyectos, '-proj', 'enlace.jsonl'));
      expect(await rechazado(seguidor().conversation(contexto({ transcriptPath: join(proyectos, '-proj', 'enlace.jsonl') }), 0))).toMatch(/fuera del directorio de proyectos/);
      execFileSync('mkfifo', [join(proyectos, '-proj', 'tuberia.jsonl')]);
      await rechazado(seguidor().conversation(contexto({ transcriptPath: join(proyectos, '-proj', 'tuberia.jsonl') }), 0));
    });

    it('con la ruta del transcript válida pero el archivo sin crear, responde vacío y empieza a servir en cuanto aparece', async () => {
      const aun = join(proyectos, '-proj', 'aun-no.jsonl');
      const ctx = contexto({ transcriptPath: aun });
      expect(await seguidor().conversation(ctx, 0)).toEqual({ sessionId: sid, from: 0, size: 0, reset: false, more: false, events: [] });
      // Si el cliente ya había leído algo y el archivo desaparece, se le dice que empiece de cero.
      expect(await seguidor().conversation(ctx, 500)).toMatchObject({ from: 0, reset: true, more: false, events: [] });
      writeFileSync(aun, persona('Primer mensaje') + '\n');
      const r = await seguidor().conversation(ctx, 0);
      expect(r.events).toEqual([{ type: 'user', text: 'Primer mensaje', at: expect.any(Number) }]);
    });

    it('también si falta la carpeta del proyecto, siempre que cuelgue del directorio de proyectos de Claude', async () => {
      const ctx = contexto({ transcriptPath: join(proyectos, '-proyecto-nuevo', 'x.jsonl') });
      expect(await seguidor().conversation(ctx, 0)).toMatchObject({ from: 0, more: false, events: [] });
      // Un enlace en la ruta que sale de los proyectos no vale, exista o no el final.
      symlinkSync(tmp, join(proyectos, 'salida'));
      await rechazado(seguidor().conversation(contexto({ transcriptPath: join(proyectos, 'salida', 'nuevo', 'x.jsonl') }), 0));
    });

    it('no sirve nada sin uid o con un id de sesión raro', async () => {
      writeFileSync(archivo(), conversacionMuestra());
      await rechazado(seguidor({ uid: null }).conversation(ctxConversacion(), 0));
      await rechazado(seguidor().conversation(contexto({ sessionId: '../x' }), 0));
      await rechazado(seguidor({ uid: uid + 1 }).conversation(ctxConversacion(), 0));
    });
  });

  describe('shell', () => {
    const salida = () => join(salidas, 'beifl810b.output');

    it('localiza la salida por el tool_result de la sesión y sirve la cola', async () => {
      const r = await seguidor().shell(contexto(), 'beifl810b', null);
      expect(r).toMatchObject({
        kind: 'shell',
        state: 'running',
        text: '> dev\nlisto\n',
        from: 12,
        reset: false,
        more: false,
        meta: { command: 'pnpm dev', startedAt: Date.parse('2026-11-02T10:00:01.000Z') },
      });
    });

    it('lee lo nuevo desde `from`, y una shell que ya no está en marcha figura como terminada', async () => {
      const s = seguidor();
      const primera = await s.shell(contexto(), 'beifl810b', null);
      appendFileSync(salida(), 'más salida\n');
      const ctx = contexto();
      ctx.targets.shells.set('beifl810b', { label: 'pnpm dev', running: false });
      const r = await s.shell(ctx, 'beifl810b', primera.from);
      expect(r).toMatchObject({ text: 'más salida\n', state: 'finished', reset: false });
    });

    it('en la primera petición sirve solo las últimas 2 000 líneas', async () => {
      const lineas = Array.from({ length: SHELL_TAIL_LINES + 500 }, (_, i) => `linea ${i}`);
      writeFileSync(salida(), lineas.join('\n') + '\n');
      const r = await seguidor().shell(contexto(), 'beifl810b', null);
      const devueltas = r.text.split('\n').filter((l) => l !== '');
      expect(devueltas).toHaveLength(SHELL_TAIL_LINES);
      expect(devueltas[0]).toBe('linea 500');
      expect(devueltas.at(-1)).toBe(`linea ${SHELL_TAIL_LINES + 499}`);
    });

    it('de un archivo mayor que el trozo lee solo el final y sin la línea cortada', async () => {
      const lineas = Array.from({ length: 30000 }, (_, i) => `salida numero ${i} ${'.'.repeat(20)}`);
      writeFileSync(salida(), lineas.join('\n') + '\n');
      const r = await seguidor().shell(contexto(), 'beifl810b', null);
      const devueltas = r.text.split('\n').filter((l) => l !== '');
      expect(devueltas.at(-1)).toBe(lineas.at(-1));
      expect(devueltas.every((l) => l.startsWith('salida numero '))).toBe(true);
      expect(devueltas.length).toBeLessThanOrEqual(SHELL_TAIL_LINES);
    });

    it('por trozos: no parte un carácter UTF-8 entre dos respuestas', async () => {
      const s = seguidor();
      writeFileSync(salida(), '€'.repeat(FOLLOW_CHUNK) + 'fin\n'); // 3 bytes por carácter: el corte del trozo cae dentro de uno
      const primera = await s.shell(contexto(), 'beifl810b', 0);
      expect(primera.more).toBe(true);
      expect(primera.text).not.toContain('�');
      let texto = primera.text;
      let from = primera.from;
      for (let i = 0; i < 20; i++) {
        const r = await s.shell(contexto(), 'beifl810b', from);
        texto += r.text;
        from = r.from;
        if (!r.more) break;
      }
      expect(texto).toBe('€'.repeat(FOLLOW_CHUNK) + 'fin\n');
    });

    it('si la salida encoge, vuelve a servir la cola y lo indica', async () => {
      const s = seguidor();
      const primera = await s.shell(contexto(), 'beifl810b', null);
      truncateSync(salida(), 0);
      writeFileSync(salida(), 'nuevo\n');
      const r = await s.shell(contexto(), 'beifl810b', primera.from + 100);
      expect(r).toMatchObject({ reset: true, text: 'nuevo\n', from: 6 });
    });

    it('rechaza ids no conocidos o con formato no válido', async () => {
      await rechazado(seguidor().shell(contexto(), 'desconocida', null));
      await rechazado(seguidor().shell(contexto(), '..%2f', null));
    });

    it('404 si el transcript no anunció la salida (y se recuerda unos segundos)', async () => {
      writeFileSync(join(proyectos, '-proj', `${sid}.jsonl`), 'nada\n');
      const s = seguidor();
      expect(await rechazado(s.shell(contexto(), 'beifl810b', null))).toMatch(/no anunció/);
      writeFileSync(join(proyectos, '-proj', `${sid}.jsonl`), lanzamientoShell('beifl810b', salida()) + '\n');
      await rechazado(s.shell(contexto(), 'beifl810b', null)); // caché negativa
      expect((await seguidor().shell(contexto(), 'beifl810b', null)).text).toContain('listo');
    });

    it('rechaza una ruta anunciada fuera de claude-<uid>/ o con otro nombre', async () => {
      const secreto = join(tmp, 'secreto.output');
      writeFileSync(secreto, 'SECRETO\n');
      writeFileSync(join(temporales, 'beifl810b.output'), 'SECRETO\n');
      for (const ruta of [secreto, join(salidas, 'otra.output'), join(temporales, 'claude-0', 'x', 'tasks', 'beifl810b.output'), `${salidas}/../../../../beifl810b.output`]) {
        writeFileSync(join(salidas, 'otra.output'), 'otra\n');
        writeFileSync(join(proyectos, '-proj', `${sid}.jsonl`), lanzamientoShell('beifl810b', ruta) + '\n');
        await rechazado(seguidor().shell(contexto(), 'beifl810b', null));
      }
    });

    it('no sigue un enlace simbólico al .output, ni uno que salga de claude-<uid>/', async () => {
      const secreto = join(tmp, 'secreto.txt');
      writeFileSync(secreto, 'SECRETO\n');
      rmSync(salida());
      symlinkSync(secreto, salida());
      await rechazado(seguidor().shell(contexto(), 'beifl810b', null));
    });

    it('una tubería (FIFO) como salida de la shell da 404 sin colgar', async () => {
      rmSync(salida());
      execFileSync('mkfifo', [salida()]);
      await rechazado(seguidor().shell(contexto(), 'beifl810b', null));
    });

    it('solo sirve archivos del usuario', async () => {
      await rechazado(seguidor({ uid: uid + 1 }).shell(contexto(), 'beifl810b', null));
    });

    it('buscarSalida ignora líneas que mencionan el id sin ser el lanzamiento', async () => {
      const t = join(tmp, 't.jsonl');
      const falso = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'Output is being written to: /tmp/x/beifl810b.output' }] }, toolUseResult: { backgroundTaskId: 'otra' } });
      writeFileSync(t, `${falso}\n{roto beifl810b backgroundTaskId\n${lanzamientoShell('beifl810b', '/tmp/claude-1/s/tasks/beifl810b.output')}\n`);
      expect(await buscarSalida(t, 'beifl810b', uid)).toEqual({ path: '/tmp/claude-1/s/tasks/beifl810b.output', startedAt: expect.any(Number) });
      expect(await buscarSalida(t, 'zzz', uid)).toBeNull();
    });
  });

  it('el resumen se salta los encabezados Markdown sueltos de las herramientas MCP', () => {
    const lineas = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__playwright__browser_click', input: {} }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '### Result\n\nClicked «Enviar»' }] } }),
    ].join('\n') + '\n';
    const ev = parseAgentLines(lineas, { primero: false, cwd: null });
    expect(ev.find((e) => e.type === 'result')).toMatchObject({ summary: 'Clicked «Enviar»' });
  });
});

// Transcripciones reales de Claude Code 2.1.325 (recortadas): una pregunta con dos preguntas (simple y múltiple), una con una
// sola pregunta contestada dos veces (la segunda con texto libre) y un Bash.
const fixture = (nombre: string): string => readFileSync(join(import.meta.dirname, 'fixtures', 'questions', nombre), 'utf8');
const lineasDe = (texto: string): string[] => texto.split('\n').filter((l) => l !== '');
const conversacion = (texto: string): AgentEvent[] => parseAgentLines(texto, { primero: true, cwd: null, conversacion: true });

describe('parseAgentLines: AskUserQuestion en la conversación', () => {
  it('la pregunta es un evento `question` con sus preguntas, opciones y descripciones, y no un `tool`', () => {
    const e = conversacion(fixture('dos-preguntas.jsonl'));
    expect(e.some((x) => x.type === 'tool')).toBe(false);
    const q = e.find((x): x is Extract<AgentEvent, { type: 'question' }> => x.type === 'question');
    expect(q).toEqual({
      type: 'question',
      id: 'toolu_016dSrLZuGQ7seg1rPR1wLwy',
      at: Date.parse('2026-11-14T09:40:49.073Z'),
      questions: [
        {
          question: '¿Color?',
          header: 'Color',
          multiSelect: false,
          options: [
            { label: 'Rojo', description: 'Color rojo' },
            { label: 'Verde', description: 'Color verde' },
            { label: 'Azul', description: 'Color azul' },
          ],
        },
        {
          question: '¿Frutas?',
          header: 'Frutas',
          multiSelect: true,
          options: [
            { label: 'Pera', description: 'Fruta pera' },
            { label: 'Uva', description: 'Fruta uva' },
            { label: 'Kiwi', description: 'Fruta kiwi' },
          ],
        },
      ],
    });
  });

  it('el resultado de ese id lleva `answers` de toolUseResult (la selección múltiple y el texto libre, unidos por «, »)', () => {
    const r = conversacion(fixture('dos-preguntas.jsonl')).find((x): x is Extract<AgentEvent, { type: 'result' }> => x.type === 'result');
    expect(r).toMatchObject({ id: 'toolu_016dSrLZuGQ7seg1rPR1wLwy', error: false, answers: { '¿Color?': 'Verde', '¿Frutas?': 'Pera, Kiwi, Mango' } });
    const simples = conversacion(fixture('pregunta-simple.jsonl')).filter((x): x is Extract<AgentEvent, { type: 'result' }> => x.type === 'result');
    expect(simples.map((x) => x.answers)).toEqual([{ '¿Tamaño?': 'Mediano' }, { '¿Tamaño?': 'Enorme' }]);
  });

  it('sin `toolUseResult.answers` el resultado va sin respuestas estructuradas', () => {
    const sin = lineasDe(fixture('dos-preguntas.jsonl'))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .map((o) => {
        delete o.toolUseResult;
        return JSON.stringify(o);
      })
      .join('\n');
    const r = conversacion(sin).find((x): x is Extract<AgentEvent, { type: 'result' }> => x.type === 'result');
    expect(r).toBeDefined();
    expect(r).not.toHaveProperty('answers');
    // Una respuesta con otra forma tampoco se acepta.
    const rara = lineasDe(fixture('pregunta-simple.jsonl'))
      .map((l) => l.replace('"answers":{"¿Tamaño?":"Mediano"}', '"answers":{"¿Tamaño?":3}'))
      .join('\n');
    expect(conversacion(rara).filter((x) => x.type === 'result' && 'answers' in x)).toHaveLength(1);
  });

  it('fuera de la conversación (un subagente) sigue siendo una herramienta, sin `answers`', () => {
    const e = parseAgentLines(fixture('dos-preguntas.jsonl'), { primero: false, cwd: null });
    expect(e.some((x) => x.type === 'question')).toBe(false);
    expect(e.find((x) => x.type === 'tool')).toMatchObject({ tool: 'AskUserQuestion', station: 'tu' });
    expect(e.find((x) => x.type === 'result')).not.toHaveProperty('answers');
  });

  it('con más preguntas u opciones que los topes, o sin forma de pregunta, se queda como herramienta', () => {
    const entrada = (input: unknown) => usar('q1', 'AskUserQuestion', input as Record<string, unknown>).replace('"isSidechain":true', '"isSidechain":false');
    const opcion = { label: 'Sí', description: '' };
    const pregunta = (opciones: unknown[]) => ({ question: '¿Vale?', header: 'Vale', multiSelect: false, options: opciones });
    expect(conversacion(entrada({ questions: [pregunta([opcion, opcion])] })).map((x) => x.type)).toEqual(['question']);
    expect(conversacion(entrada({ questions: [pregunta(Array(9).fill(opcion))] })).map((x) => x.type)).toEqual(['tool']);
    expect(conversacion(entrada({ questions: Array(7).fill(pregunta([opcion, opcion])) })).map((x) => x.type)).toEqual(['tool']);
    expect(conversacion(entrada({ questions: [] })).map((x) => x.type)).toEqual(['tool']);
    expect(conversacion(entrada({ questions: [{ question: '¿Vale?' }] })).map((x) => x.type)).toEqual(['tool']);
    expect(conversacion(entrada({})).map((x) => x.type)).toEqual(['tool']);
  });

  it('acota la longitud de los textos', () => {
    const largo = 'x'.repeat(3000);
    const linea = usar('q1', 'AskUserQuestion', { questions: [{ question: largo, header: largo, multiSelect: true, options: [{ label: largo, description: largo }] }] }).replace('"isSidechain":true', '"isSidechain":false');
    const q = conversacion(linea)[0] as Extract<AgentEvent, { type: 'question' }>;
    expect(q.questions[0]!.question.length).toBe(1000);
    expect(q.questions[0]!.header.length).toBe(100);
    expect(q.questions[0]!.options[0]!.label.length).toBe(300);
    expect(q.questions[0]!.options[0]!.description.length).toBe(1000);
  });
});

describe('pendingWork y Follower.pending', () => {
  let tmp: string;
  let proyectos: string;
  const sid = '41cec992-d9cb-4e41-b81b-b97eaa95fa11';
  const ctx = (): FollowContext => ({
    sessionId: sid,
    transcriptPath: join(proyectos, '-proj', `${sid}.jsonl`),
    cwd: '/home/u/proyecto',
    targets: { subagents: new Map(), shells: new Map() },
  });
  const seguidor = () => new Follower({ projectsDir: proyectos, tmpRoots: [] });
  const escribe = (texto: string) => writeFileSync(join(proyectos, '-proj', `${sid}.jsonl`), texto);

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-pending-'));
    proyectos = join(tmp, 'claude', 'projects');
    mkdirSync(join(proyectos, '-proj'), { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('la pregunta sin resultado está pendiente; con resultado, ya no', async () => {
    const [prompt, pregunta, resultadoLinea] = lineasDe(fixture('dos-preguntas.jsonl'));
    escribe(`${prompt}\n${pregunta}\n`);
    const pendiente = await seguidor().pending(ctx());
    expect(pendiente.question).toMatchObject({ type: 'question', id: 'toolu_016dSrLZuGQ7seg1rPR1wLwy' });
    expect(pendiente.tools).toEqual([]);
    expect(pendiente.resolved.has('toolu_016dSrLZuGQ7seg1rPR1wLwy')).toBe(false);
    appendFileSync(join(proyectos, '-proj', `${sid}.jsonl`), `${resultadoLinea}\n`);
    const despues = await seguidor().pending(ctx());
    expect(despues).toEqual({ question: null, tools: [], resolved: new Set(['toolu_016dSrLZuGQ7seg1rPR1wLwy']) });
  });

  it('las herramientas sin resultado salen en orden, con su resumen', async () => {
    const [prompt, uso] = lineasDe(fixture('permiso-bash.jsonl'));
    escribe(`${prompt}\n${uso}\n`);
    const { question, tools } = await seguidor().pending(ctx());
    expect(question).toBeNull();
    expect(tools).toMatchObject([{ id: 'toolu_01HSh1XPZ931KpQcnefB5jao', tool: 'Bash', verb: 'Ejecuto', target: 'rm -f borrame.txt' }]);
  });

  it('solo mira el final del archivo, descarta la línea cortada y la que aún se escribe, y sin transcript no hay nada pendiente', async () => {
    const [prompt, pregunta] = lineasDe(fixture('dos-preguntas.jsonl'));
    const relleno = Array.from({ length: 2500 }, (_, i) => persona(`mensaje ${i} ${'x'.repeat(1000)}`)).join('\n');
    escribe(`${relleno}\n${prompt}\n${pregunta}\n${persona('a medias').slice(0, 20)}`);
    expect((await seguidor().pending(ctx())).question?.id).toBe('toolu_016dSrLZuGQ7seg1rPR1wLwy');
    rmSync(join(proyectos, '-proj', `${sid}.jsonl`));
    expect(await seguidor().pending(ctx())).toEqual({ question: null, tools: [], resolved: new Set() });
  });

  it('pendingWork se queda con la última pregunta pendiente', () => {
    const q = (id: string): AgentEvent => ({ type: 'question', id, questions: [], at: null });
    const r: AgentEvent = { type: 'result', id: 'b', error: false, summary: '', lines: 0 };
    expect(pendingWork([q('a'), q('b'), r, q('c')]).question?.id).toBe('c');
    expect(pendingWork([q('a'), q('b'), r, { ...r, id: 'a' }]).question).toBeNull();
    expect([...pendingWork([q('a'), r]).resolved]).toEqual(['b']);
  });
});

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FOLLOW_CHUNK, FollowError, Follower, SHELL_TAIL_LINES, buscarSalida, describeTool, leerLineas, parseAgentLines } from './follow.ts';
import type { AgentEvent, FollowContext } from './follow.ts';
import { encargo, interno, lanzamientoShell, resultado, subagenteMuestra, texto, usar } from './follow-fixtures.ts';

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
    expect(r.find((x) => x.id === 't4')).toEqual({ type: 'result', id: 't4', error: true, summary: "LiveInput.tsx:48 'scrollIntoView' no se usa", lines: 2 });
    expect(r.find((x) => x.id === 't1')).toMatchObject({ error: false, lines: 3 });
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
    expect(describeTool('mcp__playwright__browser_click', { a: 1 }, cwd)).toEqual({ verb: 'Uso', target: 'playwright · browser_click' });
    expect(describeTool('Desconocida', { a: 1 }, cwd)).toEqual({ verb: 'Desconocida', target: '' });
    expect(describeTool('Read', null, cwd)).toEqual({ verb: 'Leo', target: '' });
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

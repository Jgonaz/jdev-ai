import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountFrom, deriveActivity, followTargets, isArtifactUrl, isStateFileName, parseActivityLog, parseStatusline, readStateFile } from './usage.ts';
import { statuslineMuestra } from './statusline-fixtures.ts';
import type { Statusline } from './usage.ts';

const mtime = 1_780_000_000_000;

describe('parseStatusline', () => {
  it('lee modelo, esfuerzo, contexto y límites de una muestra completa', () => {
    const s = parseStatusline(JSON.stringify(statuslineMuestra()), mtime);
    expect(s).toEqual({
      sessionId: 'abc-1',
      usage: {
        model: 'Opus 5.5',
        effort: 'medium',
        context: { used: 194000, size: 1000000, percent: 19 },
        worktree: null,
        updatedAt: mtime,
      },
      limits: {
        fiveHour: { percent: 3.4, resetsAt: 1_790_000_000_000 },
        sevenDay: { percent: 22, resetsAt: 1_790_500_000_000 },
      },
    });
  });

  it('sin current_usage deduce los tokens del porcentaje; sin porcentaje, el porcentaje de los tokens', () => {
    const base = statuslineMuestra();
    const sinUso = parseStatusline(JSON.stringify({ ...base, context_window: { context_window_size: 200000, used_percentage: 50, current_usage: null } }), mtime);
    expect(sinUso?.usage.context).toEqual({ used: 100000, size: 200000, percent: 50 });
    const sinPct = parseStatusline(
      JSON.stringify({ ...base, context_window: { context_window_size: 200000, used_percentage: null, current_usage: { input_tokens: 50000 } } }),
      mtime,
    );
    expect(sinPct?.usage.context).toEqual({ used: 50000, size: 200000, percent: 25 });
  });

  it('al principio de la sesión (todo null) conserva el tamaño y deja el porcentaje sin dato', () => {
    const s = parseStatusline(
      JSON.stringify(statuslineMuestra({ context_window: { context_window_size: 1000000, current_usage: null, used_percentage: null, remaining_percentage: null } })),
      mtime,
    );
    expect(s?.usage.context).toEqual({ used: null, size: 1000000, percent: null });
  });

  it('solo session_id: todo lo demás queda vacío', () => {
    expect(parseStatusline('{"session_id":"s1"}', mtime)).toEqual({
      sessionId: 's1',
      usage: { model: null, effort: null, context: null, worktree: null, updatedAt: mtime },
      limits: { fiveHour: null, sevenDay: null },
    });
  });

  it('usa el id del modelo si no hay display_name y limita porcentajes y tipos erróneos', () => {
    const s = parseStatusline(
      JSON.stringify({
        session_id: 's1',
        model: { id: 'claude-x', display_name: '' },
        effort: { level: 3 },
        context_window: { context_window_size: 'grande', used_percentage: 140 },
        rate_limits: { five_hour: { used_percentage: -5, resets_at: 'mañana' }, seven_day: { used_percentage: 'x' } },
      }),
      mtime,
    );
    expect(s?.usage.model).toBe('claude-x');
    expect(s?.usage.effort).toBeNull();
    expect(s?.usage.context).toEqual({ used: null, size: null, percent: 100 });
    expect(s?.limits).toEqual({ fiveHour: { percent: 0, resetsAt: null }, sevenDay: null });
  });

  it('un límite sin ventana de 7 días (cuenta sin ella) deja solo la de 5 horas', () => {
    const s = parseStatusline(JSON.stringify(statuslineMuestra({ rate_limits: { five_hour: { used_percentage: 91, resets_at: 1_790_000_000 } } })), mtime);
    expect(s?.limits.sevenDay).toBeNull();
    expect(s?.limits.fiveHour?.percent).toBe(91);
    expect(parseStatusline(JSON.stringify(statuslineMuestra({ rate_limits: undefined })), mtime)?.limits).toEqual({ fiveHour: null, sevenDay: null });
  });

  it('lee el worktree de Claude, o el enlazado del workspace', () => {
    const propio = parseStatusline(
      JSON.stringify(statuslineMuestra({ worktree: { name: 'ts7', path: '/w/ts7', branch: 'feat/ts7', original_cwd: '/p', original_branch: 'main' } })),
      mtime,
    );
    expect(propio?.usage.worktree).toEqual({ name: 'ts7', branch: 'feat/ts7' });
    const enlazado = parseStatusline(JSON.stringify(statuslineMuestra({ workspace: { current_dir: '/w', git_worktree: 'ts7' } })), mtime);
    expect(enlazado?.usage.worktree).toEqual({ name: 'ts7', branch: null });
  });

  it('rechaza lo que no es un objeto con session_id', () => {
    for (const malo of ['', 'basura', '[1]', '"x"', '{}', '{"session_id":3}', '{"session_id":""}', '{"session_id":"s1"']) {
      expect(parseStatusline(malo, mtime)).toBeNull();
    }
  });
});

const lim = (percent: number, resetsAt: number | null = null) => ({ percent, resetsAt });
const st = (id: string, updatedAt: number, fiveHour: ReturnType<typeof lim> | null, sevenDay: ReturnType<typeof lim> | null = null): Statusline => ({
  sessionId: id,
  usage: { model: null, effort: null, context: null, worktree: null, updatedAt },
  limits: { fiveHour, sevenDay },
});

describe('accountFrom', () => {
  it('toma la statusline más reciente que informe límites', () => {
    const cuenta = accountFrom([st('a', 100, lim(10), lim(20)), st('b', 300, lim(91, 5), null), st('c', 500, null, null)]);
    expect(cuenta).toEqual({ fiveHour: lim(91, 5), sevenDay: null, updatedAt: 300 });
  });

  it('es null si ninguna trae límites', () => {
    expect(accountFrom([])).toBeNull();
    expect(accountFrom([st('a', 100, null, null)])).toBeNull();
  });
});

describe('parseActivityLog / deriveActivity', () => {
  const linea = (e: Record<string, unknown>, at: string) => JSON.stringify({ jdev_at: at, session_id: 'abc-1', transcript_path: '/t', cwd: '/p', ...e });
  const t = (hms: string) => `2026-11-02T${hms}Z`;
  const ms = (hms: string) => Date.parse(t(hms));

  const inicio = (id: string, tipo: string, hms: string) => linea({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: tipo }, t(hms));
  const fin = (id: string, hms: string) =>
    linea({ hook_event_name: 'SubagentStop', stop_hook_active: false, agent_id: id, agent_transcript_path: '/t/a.jsonl', agent_type: 'qa', last_assistant_message: 'listo' }, t(hms));

  it('los subagentes activos son los SubagentStart sin su SubagentStop', () => {
    const log = [inicio('a1', 'qa', '10:00:00'), inicio('a2', 'implementer', '10:00:05'), inicio('a3', 'Explore', '10:00:09'), fin('a2', '10:01:00')].join('\n');
    expect(deriveActivity(parseActivityLog(log))?.subagents).toEqual([
      { id: 'a1', type: 'qa', since: ms('10:00:00') },
      { id: 'a3', type: 'Explore', since: ms('10:00:09') },
    ]);
  });

  it('un SubagentStop de otro agente o repetido no rompe nada y un inicio repetido conserva la hora', () => {
    const log = [inicio('a1', 'qa', '10:00:00'), inicio('a1', 'qa', '10:05:00'), fin('zz', '10:06:00')].join('\n');
    expect(deriveActivity(parseActivityLog(log))?.subagents).toEqual([{ id: 'a1', type: 'qa', since: ms('10:00:00') }]);
  });

  it('un subagente que acaba su turno pero espera a sus tareas sigue en marcha hasta el Stop de la sesión', () => {
    const tareas = (lista: unknown[]) => lista;
    const finConTareas = (id: string, hms: string, lista: unknown[]) =>
      linea({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'implementer', background_tasks: tareas(lista) }, t(hms));
    const stopSesion = (hms: string, lista: unknown[]) => linea({ hook_event_name: 'Stop', background_tasks: lista }, t(hms));
    const vivo = { id: 'a9', type: 'subagent', status: 'running', agent_type: 'implementer', description: 'Arreglos' };
    const shell = { id: 'bshell01', type: 'shell', status: 'running', command: 'pnpm test' };
    const base = [inicio('a9', 'implementer', '10:00:00'), finConTareas('a9', '10:30:00', [vivo, shell])];
    // Esperando a sus propias tareas: sigue en marcha, con su hora de inicio y la shell que lanzó.
    let act = deriveActivity(parseActivityLog(base.join('\n')));
    expect(act?.subagents).toEqual([{ id: 'a9', type: 'implementer', since: ms('10:00:00') }]);
    expect(act?.shells).toEqual([{ label: 'pnpm test', id: 'bshell01' }]);
    expect(followTargets(parseActivityLog(base.join('\n'))).subagents.get('a9')?.stopped).toBe(false);
    // El Stop de la sesión que ya no lo lista lo da por terminado.
    const despues = [...base, stopSesion('10:31:00', [])].join('\n');
    act = deriveActivity(parseActivityLog(despues));
    expect(act?.subagents ?? []).toEqual([]);
    expect(followTargets(parseActivityLog(despues)).subagents.get('a9')?.stopped).toBe(true);
    // Retomado más tarde: vuelve a estar en marcha y conserva su primer inicio.
    const retomado = [despues, inicio('a9', 'implementer', '11:00:00')].join('\n');
    expect(deriveActivity(parseActivityLog(retomado))?.subagents).toEqual([{ id: 'a9', type: 'implementer', since: ms('10:00:00') }]);
    expect(followTargets(parseActivityLog(retomado)).subagents.get('a9')?.stopped).toBe(false);
  });

  it('las shells son las tareas shell y monitor en marcha del último Stop', () => {
    const stop = (tareas: unknown[], hms: string) =>
      linea({ hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'hecho', background_tasks: tareas }, t(hms));
    const log = [
      stop([{ id: 'b1', type: 'shell', status: 'running', description: 'dev', command: 'pnpm dev' }], '10:00:00'),
      stop(
        [
          { id: 'b1', type: 'shell', status: 'running', description: 'dev', command: 'pnpm dev' },
          { id: 'b2', type: 'shell', status: 'completed', command: 'pnpm build' },
          { id: 'b3', type: 'monitor', status: 'pending', description: 'Espera el despliegue', server: 'ci', tool: 'watch' },
          { id: 'b4', type: 'monitor', status: 'running', server: 'ci', tool: 'logs' },
          { id: 'b5', type: 'subagent', status: 'running', description: 'qa', agent_type: 'qa' },
          { id: 'b6', type: 'workflow', status: 'running', name: 'release' },
          { id: 'b7', type: 'local_bash', status: 'running', command: 'tail -f x' },
          'basura',
        ],
        '10:30:00',
      ),
    ].join('\n');
    expect(deriveActivity(parseActivityLog(log))?.shells).toEqual([
      { label: 'pnpm dev', id: 'b1' },
      { label: 'Espera el despliegue', id: 'b3' },
      { label: 'ci/logs', id: 'b4' },
      { label: 'tail -f x', id: 'b7' },
    ]);
  });

  it('un Stop sin tareas vacía las shells', () => {
    const log = [
      linea({ hook_event_name: 'Stop', background_tasks: [{ id: 'b1', type: 'shell', status: 'running', command: 'x' }] }, t('10:00:00')),
      linea({ hook_event_name: 'Stop' }, t('10:10:00')),
    ].join('\n');
    expect(deriveActivity(parseActivityLog(log))).toBeNull();
  });

  it('followTargets conserva los subagentes terminados y las shells que ya no están en marcha', () => {
    const stop = (tareas: unknown[], hms: string) => linea({ hook_event_name: 'Stop', background_tasks: tareas }, t(hms));
    const log = [
      inicio('a1', 'qa', '10:00:00'),
      inicio('a2', 'implementer', '10:00:05'),
      fin('a2', '10:01:00'),
      // Los subagentes en segundo plano salen en la lista de tareas del Stop de la sesión.
      stop([{ id: 'a1', type: 'subagent', status: 'running', agent_type: 'qa' }, { id: 'b1', type: 'shell', status: 'running', command: 'pnpm dev' }, { id: 'MAL ID', type: 'shell', status: 'running', command: 'x' }], '10:02:00'),
      stop([{ id: 'a1', type: 'subagent', status: 'running', agent_type: 'qa' }, { id: 'b2', type: 'shell', status: 'running', command: 'tail -f x' }], '10:03:00'),
    ].join('\n');
    const r = followTargets(parseActivityLog(log));
    expect([...r.subagents]).toEqual([
      ['a1', { type: 'qa', since: ms('10:00:00'), stopped: false }],
      ['a2', { type: 'implementer', since: ms('10:00:05'), stopped: true }],
    ]);
    expect([...r.shells]).toEqual([
      ['b1', { label: 'pnpm dev', running: false }],
      ['b2', { label: 'tail -f x', running: true }],
    ]);
    // Lo anterior a un SessionStart posterior no cuenta: solo queda el subagente que la lista de las 10:03 da en marcha.
    expect([...followTargets(parseActivityLog(log), ms('10:02:30')).subagents.keys()]).toEqual(['a1']);
  });

  const artifact = (respuesta: unknown, entrada: Record<string, unknown>, hms: string) =>
    linea({ hook_event_name: 'PostToolUse', tool_name: 'Artifact', tool_input: { file_path: '/p/x.html', ...entrada }, tool_response: respuesta }, t(hms));

  it('extrae los enlaces de los dos formatos, sin repetir y con el título de tool_input', () => {
    const log = [
      artifact('Published https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU', { title: 'Plan de pruebas' }, '10:00:00'),
      artifact({ url: 'https://claude.ai/code/artifact/0a1b2c3d-1111-2222-3333-444455556666', ok: true }, { title: 'Diseño del teclado' }, '10:01:00'),
      // Republicar el mismo enlace no lo duplica y actualiza el título.
      artifact('https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU', { title: 'Plan de pruebas v2' }, '10:02:00'),
      artifact('sin enlace', {}, '10:03:00'),
    ].join('\n');
    expect(deriveActivity(parseActivityLog(log))?.artifacts).toEqual([
      { url: 'https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU', title: 'Plan de pruebas v2' },
      { url: 'https://claude.ai/code/artifact/0a1b2c3d-1111-2222-3333-444455556666', title: 'Diseño del teclado' },
    ]);
  });

  it('ignora enlaces que no son de artifacts de claude.ai', () => {
    const malos = [
      'http://claude.ai/artifact/abc123',
      'https://claude.ai.evil.example/artifact/abc123',
      'https://evil.example/https://claude.ai/artifact/abc',
      'https://claude.ai/chat/abc123',
      'https://claude.ai/artifact/',
      'https://claude.ai/code/session/abc',
      'x@https://claude.ai/artifact/abc123',
    ];
    for (const m of malos) {
      const log = artifact(m, { title: 'x' }, '10:00:00');
      expect(deriveActivity(parseActivityLog(log))?.artifacts ?? [], m).toEqual([]);
    }
    expect(isArtifactUrl('https://claude.ai/artifact/abc-123')).toBe(true);
    expect(isArtifactUrl('https://claude.ai/code/artifact/abc-123')).toBe(true);
    expect(isArtifactUrl('https://claude.ai/artifact/abc-123?x=1')).toBe(false);
    expect(isArtifactUrl('javascript:alert(1)')).toBe(false);
  });

  it('ignora líneas ilegibles, eventos ajenos y PostToolUse de otras herramientas', () => {
    const log = [
      'basura',
      '',
      '[1,2]',
      '{"jdev_at":"2026-11-02T10:00:00Z","hook_event_name":"PostToolUse","tool_name":"Read","tool_response":"https://claude.ai/artifact/abc123"}',
      '{"jdev_at":"2026-11-02T10:00:00Z","hook_event_name":"SubagentStart"}',
      '{"jdev_at":"2026-11-02T10:00:00Z","hook_event_name":"Otro","agent_id":"x"}',
      inicio('a1', 'qa', '10:00:00'),
    ].join('\n');
    expect(deriveActivity(parseActivityLog(log))).toEqual({
      subagents: [{ id: 'a1', type: 'qa', since: ms('10:00:00') }],
      shells: [],
      artifacts: [],
    });
  });

  it('ignora los eventos anteriores a notBefore (una ejecución previa de la sesión)', () => {
    const log = [inicio('a1', 'qa', '10:00:00'), inicio('a2', 'Explore', '11:00:00')].join('\n');
    expect(deriveActivity(parseActivityLog(log), ms('10:30:00'))?.subagents.map((s) => s.id)).toEqual(['a2']);
    expect(deriveActivity(parseActivityLog(log), ms('12:00:00'))).toBeNull();
  });

  it('sin hora legible el evento cuenta y su hora queda sin dato', () => {
    const log = '{"hook_event_name":"SubagentStart","agent_id":"a1","agent_type":"qa"}';
    expect(deriveActivity(parseActivityLog(log), 5)?.subagents).toEqual([{ id: 'a1', type: 'qa', since: null }]);
  });

  it('limita el número de artifacts y de subagentes que se muestran', () => {
    const muchos = Array.from({ length: 70 }, (_, i) => inicio(`a${i}`, 'qa', '10:00:00'));
    expect(deriveActivity(parseActivityLog(muchos.join('\n')))?.subagents).toHaveLength(50);
    const arts = Array.from({ length: 30 }, (_, i) => artifact(`https://claude.ai/artifact/id${i}xyz`, {}, '10:00:00'));
    const lista = deriveActivity(parseActivityLog(arts.join('\n')))?.artifacts ?? [];
    expect(lista).toHaveLength(20);
    expect(lista.at(-1)?.url).toBe('https://claude.ai/artifact/id29xyz');
  });

  it('lee la salida real de bin/session-activity (hora y el resto del evento en la misma línea)', () => {
    const real = '{"jdev_at":"2026-11-02T16:54:02Z","session_id":"s1", "hook_event_name":"Stop", "background_tasks":[{"id":"b","type":"shell","status":"running","command":"npm start"}]}';
    expect(deriveActivity(parseActivityLog(real))?.shells).toEqual([{ label: 'npm start', id: 'b' }]);
  });
});

describe('lectura segura de archivos de estado', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jdev-usage-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('valida el nombre: solo letras, números y guiones con la extensión', () => {
    expect(isStateFileName('abc-1.json', '.json')).toBe(true);
    for (const malo of ['.json', 'a.b.json', '../x.json', 'a/b.json', 'a b.json', 'abc.jsonl', '.tmp.1.json', 'a%2e.json']) {
      expect(isStateFileName(malo, '.json'), malo).toBe(false);
    }
  });

  it('lee un archivo normal', async () => {
    writeFileSync(join(dir, 's1.json'), '{"a":1}');
    expect(await readStateFile(dir, 's1.json', '.json', 100)).toMatchObject({ texto: '{"a":1}', size: 7 });
  });

  it('rechaza el que pasa del tamaño máximo, el inexistente y el nombre no válido', async () => {
    writeFileSync(join(dir, 's1.json'), 'x'.repeat(101));
    expect(await readStateFile(dir, 's1.json', '.json', 100)).toBeNull();
    expect(await readStateFile(dir, 'nada.json', '.json', 100)).toBeNull();
    expect(await readStateFile(dir, '../s1.json', '.json', 100)).toBeNull();
  });

  it('no sigue enlaces simbólicos ni lee directorios', async () => {
    const fuera = mkdtempSync(join(tmpdir(), 'jdev-usage-fuera-'));
    try {
      writeFileSync(join(fuera, 'secreto.json'), '{"secreto":true}');
      symlinkSync(join(fuera, 'secreto.json'), join(dir, 's1.json'));
      expect(await readStateFile(dir, 's1.json', '.json', 100)).toBeNull();
      mkdirSync(join(dir, 'd.json'));
      expect(await readStateFile(dir, 'd.json', '.json', 100)).toBeNull();
    } finally {
      rmSync(fuera, { recursive: true, force: true });
    }
  });
});

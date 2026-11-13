import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/follow.ts';
import {
  EMPTY_CHAT,
  actionsLabel,
  applyChatEvents,
  commandLine,
  conversationDelay,
  countNewMessages,
  errorsLabel,
  findRanges,
  groupMatches,
  highlightRange,
  hitCountLabel,
  MAX_RESALTADAS,
  PASO_VENTANA,
  VENTANA,
  markdownPieces,
  newRepliesAnnouncement,
  newMessagesLabel,
  normalizeText,
  EMPTY_TURN,
  addTurnUsage,
  startTurn,
  turnTokensLabel,
  workingView,
  progressLabel,
  progressPercent,
  searchChat,
  splitHighlight,
  stepLabel,
  toolsSummary,
  waitingNotice,
  warmSearch,
  windowAround,
  windowDown,
  windowRange,
  windowUp,
} from './chat.ts';

const user = (text: string, at: number | null = 1000): AgentEvent => ({ type: 'user', text, at });
const msg = (text: string, at: number | null = 2000): AgentEvent => ({ type: 'message', text, at });
const tool = (id: string, verb: string, target: string, detail?: string): AgentEvent => ({ type: 'tool', id, tool: 'X', verb, target, detail, at: 3000 });
const result = (id: string, over: Partial<Extract<AgentEvent, { type: 'result' }>> = {}): AgentEvent => ({ type: 'result', id, error: false, summary: 'ok', lines: 1, ...over });

describe('applyChatEvents', () => {
  it('agrupa las herramientas seguidas entre dos mensajes', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('hola'), msg('vale'), tool('a', 'Leo', 'x.ts'), tool('b', 'Busco', 'foo'), result('a'), msg('listo'), tool('c', 'Ejecuto', 'ls')]);
    expect(m.items.map((i) => i.kind)).toEqual(['user', 'agent', 'tools', 'agent', 'tools']);
    const g = m.items[2]!;
    expect(g.kind === 'tools' && g.steps.map((s) => s.id)).toEqual(['a', 'b']);
    expect(g.kind === 'tools' && g.steps[0]!.result).toMatchObject({ error: false, lines: 1 });
    expect(g.kind === 'tools' && g.steps[1]!.result).toBeUndefined();
  });

  it('empareja un resultado que llega en otro trozo y cuenta los errores', () => {
    const a = applyChatEvents(EMPTY_CHAT, [tool('a', 'Ejecuto', 'pnpm test')]);
    const b = applyChatEvents(a, [result('a', { error: true, summary: 'falló', output: 'Error: x' })]);
    const g = b.items[0]!;
    expect(g.kind === 'tools' && g.errors).toBe(1);
    expect(g.kind === 'tools' && g.steps[0]!.result?.output).toBe('Error: x');
    // El modelo anterior no se toca: las vistas memoizadas se apoyan en ello.
    const previo = a.items[0]!;
    expect(previo.kind === 'tools' && previo.steps[0]!.result).toBeUndefined();
    expect(b.items[0]).not.toBe(a.items[0]);
  });

  it('una herramienta nueva sigue el grupo del trozo anterior', () => {
    const a = applyChatEvents(EMPTY_CHAT, [tool('a', 'Leo', 'x')]);
    const b = applyChatEvents(a, [tool('b', 'Leo', 'y')]);
    expect(b.items).toHaveLength(1);
    const g = b.items[0]!;
    expect(g.kind === 'tools' && g.steps).toHaveLength(2);
    // Los elementos que no cambian conservan su identidad.
    const c = applyChatEvents(b, [msg('hola')]);
    expect(c.items[0]).toBe(b.items[0]);
  });

  it('ignora el resultado de una herramienta desconocida y los eventos de subagente', () => {
    const m = applyChatEvents(EMPTY_CHAT, [{ type: 'task', text: 'x' }, result('zzz')]);
    expect(m.items).toEqual([]);
  });

  it('sin eventos devuelve el mismo modelo y con reset empieza de cero', () => {
    const a = applyChatEvents(EMPTY_CHAT, [user('hola')]);
    expect(applyChatEvents(a, [])).toBe(a);
    const b = applyChatEvents(a, [msg('otra')], true);
    expect(b.items.map((i) => i.kind)).toEqual(['agent']);
  });

  it('da claves distintas y estables a cada elemento, también con imágenes', () => {
    const a = applyChatEvents(EMPTY_CHAT, [{ type: 'user', text: '', at: null, images: 2 }, msg('x')]);
    const b = applyChatEvents(a, [user('y')]);
    expect(new Set(b.items.map((i) => i.key)).size).toBe(3);
    expect(b.items[0]).toMatchObject({ kind: 'user', images: 2 });
    expect(b.items[0]!.key).toBe(a.items[0]!.key);
  });
});

describe('comandos en la conversación', () => {
  const cmd = (name: string, args = ''): AgentEvent => ({ type: 'command', name, args, at: 4000 });
  const salida = (text: string, error = false): AgentEvent => ({ type: 'command-output', text, error, at: 4000 });

  it('un comando es un elemento propio y su salida se une a él, también si llega en otro trozo', () => {
    const a = applyChatEvents(EMPTY_CHAT, [user('hola'), cmd('goal', 'close')]);
    expect(a.items[1]).toMatchObject({ kind: 'command', name: 'goal', args: 'close' });
    expect(a.items[1]).not.toHaveProperty('output');
    const b = applyChatEvents(a, [salida('Goal cleared')]);
    expect(b.items).toHaveLength(2);
    expect(b.items[1]).toMatchObject({ kind: 'command', output: { text: 'Goal cleared', error: false } });
    // El modelo anterior no cambia y el resto de elementos conservan su identidad.
    expect(a.items[1]).not.toHaveProperty('output');
    expect(b.items[0]).toBe(a.items[0]);
  });

  it('una salida sin comando justo antes, o una segunda salida, no crea elementos ni pisa la primera', () => {
    expect(applyChatEvents(EMPTY_CHAT, [salida('huérfana')]).items).toEqual([]);
    expect(applyChatEvents(EMPTY_CHAT, [user('x'), salida('huérfana')]).items).toHaveLength(1);
    const m = applyChatEvents(EMPTY_CHAT, [cmd('compact'), salida('uno'), salida('dos', true)]);
    expect(m.items[0]).toMatchObject({ output: { text: 'uno', error: false } });
  });

  it('se escribe como «/goal close» (sin espacio de más si no hay argumentos)', () => {
    expect(commandLine({ name: 'goal', args: 'close' })).toBe('/goal close');
    expect(commandLine({ name: 'compact', args: '' })).toBe('/compact');
  });

  it('entra en la búsqueda: por el comando, los argumentos y su salida', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('hola'), cmd('goal', 'close'), salida('Objetivo CERRADO'), msg('vale')]);
    expect(searchChat(m.items, '/goal').map((x) => [x.item, x.step])).toEqual([[1, null]]);
    expect(searchChat(m.items, 'goal close').map((x) => x.item)).toEqual([1]);
    expect(searchChat(m.items, 'cerrado').map((x) => x.item)).toEqual([1]);
    expect(searchChat(m.items, 'nada')).toEqual([]);
  });

  it('cuenta como mensaje nuevo', () => {
    const m = applyChatEvents(EMPTY_CHAT, [cmd('clear')]);
    expect(countNewMessages(m.items, 0)).toBe(1);
  });
});

describe('resumen de un grupo', () => {
  it('pone las acciones en infinitivo con su objetivo', () => {
    expect(stepLabel({ verb: 'Leo', target: 'panel/server/tmux.ts' })).toBe('Leer tmux.ts');
    expect(stepLabel({ verb: 'Busco', target: 'send-keys' })).toBe('Buscar «send-keys»');
    expect(stepLabel({ verb: 'Ejecuto', target: 'pnpm test' })).toBe('Ejecutar pnpm test');
    expect(stepLabel({ verb: 'Hago', target: '' })).toBe('Hago');
  });

  it('no duplica las comillas de un objetivo que el servidor ya entrecomilló (Grep)', () => {
    // describeTool de Grep da «patrón» en panel; stepLabel no vuelve a envolverlo.
    expect(stepLabel({ verb: 'Busco', target: '«send-keys» en panel' })).toBe('Buscar «send-keys» en panel');
    expect(stepLabel({ verb: 'Busco', target: '«send-keys»' })).toBe('Buscar «send-keys»');
    // Un Glob llega sin comillas y sí se entrecomilla.
    expect(stepLabel({ verb: 'Busco', target: '**/*.ts en panel' })).toBe('Buscar «**/*.ts en panel»');
    // Una etiqueta larga se recorta sin cambiar de forma.
    expect(stepLabel({ verb: 'Busco', target: `«${'x'.repeat(60)}» en panel` })).toMatch(/^Buscar «x+…$/);
    expect(toolsSummary([{ verb: 'Leo', target: 'a.ts' }, { verb: 'Busco', target: '«send-keys» en panel' }] as never)).toBe('Leer a.ts · Buscar «send-keys» en panel');
  });

  it('une las primeras y marca que hay más', () => {
    const pasos = ['a', 'b', 'c', 'd', 'e'].map((t) => ({ verb: 'Leo', target: `${t}.ts` }));
    expect(toolsSummary(pasos as never)).toBe('Leer a.ts · Leer b.ts · Leer c.ts · Leer d.ts · …');
    expect(toolsSummary(pasos.slice(0, 2) as never)).toBe('Leer a.ts · Leer b.ts');
  });

  it('concuerda en singular y plural', () => {
    expect(actionsLabel(1)).toBe('1 acción');
    expect(actionsLabel(4)).toBe('4 acciones');
    expect(errorsLabel(1)).toBe('1 error');
    expect(errorsLabel(2)).toBe('2 errores');
  });
});

describe('búsqueda de texto', () => {
  it('no distingue mayúsculas ni tildes', () => {
    expect(normalizeText('ÁrBol Canción')).toBe('arbol cancion');
    expect(findRanges('El Árbol de la canción', 'arbol')).toEqual([[3, 8]]);
    expect(findRanges('Canción CANCION cancion', 'cancion')).toEqual([[0, 7], [8, 15], [16, 23]]);
    expect(findRanges('abc', '')).toEqual([]);
    expect(findRanges('abc', '   ')).toEqual([]);
  });

  it('las posiciones corresponden al texto original aunque la normalización cambie la longitud', () => {
    // «é» descompuesta (e + acento combinado) mide 2 caracteres: el rango sigue siendo el del original.
    const t = 'café con leche';
    const [[desde, hasta]] = findRanges(t, 'café con');
    expect(t.slice(desde, hasta)).toBe('café con');
    // Y con pares sustitutos (emoji) por medio.
    const e = '😀 Hola 😀 hola';
    expect(findRanges(e, 'hola').map(([a, b]) => e.slice(a, b))).toEqual(['Hola', 'hola']);
  });

  it('parte el texto en trozos con y sin coincidencia', () => {
    expect(splitHighlight('uno dos uno', 'uno')).toEqual([
      { text: 'uno', hit: true },
      { text: ' dos ', hit: false },
      { text: 'uno', hit: true },
    ]);
    expect(splitHighlight('nada', 'xyz')).toEqual([{ text: 'nada', hit: false }]);
  });

  const conversacion = applyChatEvents(EMPTY_CHAT, [
    user('¿Cómo funciona typeLine con varias líneas?'),
    msg('Se usa `typeLine` con **send-keys** y un [enlace](https://ejemplo.dev/typeLine).'),
    tool('a', 'Leo', 'server/tmux.ts'),
    tool('b', 'Ejecuto', 'pnpm test'),
    result('a', { output: 'export async function TYPELINE(cfg) {}' }),
    result('b', { error: true, summary: 'falló', output: 'Error: nada que ver' }),
    msg('Listo. Revisa la Canción.'),
  ]);

  it('busca en mensajes de la persona, del agente y en las acciones con su resultado, en orden', () => {
    const m = searchChat(conversacion.items, 'typeline');
    expect(m.map((x) => [x.item, x.step])).toEqual([
      [0, null],
      [1, null],
      [2, 0],
    ]);
    expect(m[2]!.key).toBe(`${conversacion.items[2]!.key}:0`);
  });

  it('encuentra por el verbo, el objetivo, el detalle y el resultado de error', () => {
    expect(searchChat(conversacion.items, 'ejecuto').map((x) => x.step)).toEqual([1]);
    expect(searchChat(conversacion.items, 'tmux.ts').map((x) => x.step)).toEqual([0]);
    expect(searchChat(conversacion.items, 'nada que ver').map((x) => x.step)).toEqual([1]);
    expect(searchChat(conversacion.items, 'cancion').map((x) => x.item)).toEqual([3]);
  });

  it('en el Markdown solo cuenta lo que se ve: no las URL ni los signos de formato', () => {
    expect(searchChat(conversacion.items, 'ejemplo.dev')).toEqual([]);
    expect(searchChat(conversacion.items, '**')).toEqual([]);
    expect(searchChat(conversacion.items, 'enlace').map((x) => x.item)).toEqual([1]);
  });

  it('sin consulta o sin resultados devuelve una lista vacía', () => {
    expect(searchChat(conversacion.items, '')).toEqual([]);
    expect(searchChat(conversacion.items, 'webpack')).toEqual([]);
  });

  it('extrae los textos de un Markdown: código, listas y tablas', () => {
    const piezas = markdownPieces('# Título\n\nTexto con `código` y &amp; entidad\n\n- uno\n- dos\n\n| a | b |\n|---|---|\n| c | d |\n\n```ts\nconst x = 1;\n```');
    expect(piezas).toEqual(expect.arrayContaining(['Título', 'código', 'uno', 'dos', 'a', 'd', 'const x = 1;']));
    expect(piezas.join('|')).toContain('& entidad');
  });
});

describe('mensajes nuevos', () => {
  it('cuenta solo mensajes, no grupos de herramientas, desde el último visto', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('a'), tool('t', 'Leo', 'x'), msg('b'), user('c')]);
    expect(countNewMessages(m.items, 0)).toBe(3);
    expect(countNewMessages(m.items, 2)).toBe(2);
    expect(countNewMessages(m.items, 4)).toBe(0);
    expect(countNewMessages(m.items, 99)).toBe(0);
    expect(newMessagesLabel(1)).toBe('1 mensaje nuevo');
    expect(newMessagesLabel(2)).toBe('2 mensajes nuevos');
  });
});

describe('carga y sondeo', () => {
  it('formatea el progreso en KB o MB y su porcentaje', () => {
    expect(progressLabel(1024 * 300, 1024 * 600)).toBe('300 de 600 KB');
    expect(progressLabel(3.1 * 1024 * 1024, 5 * 1024 * 1024)).toBe('3,1 de 5 MB');
    expect(progressPercent(25, 100)).toBe(25);
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(200, 100)).toBe(100);
  });

  it('pregunta enseguida si queda más, cada segundo si trabaja y cada 3 s si no', () => {
    expect(conversationDelay(true, false)).toBe(0);
    expect(conversationDelay(false, true)).toBe(1000);
    expect(conversationDelay(false, false)).toBe(3000);
  });
});

describe('rendimiento con transcripts grandes', () => {
  it('los elementos que no cambian conservan su identidad al llegar eventos nuevos', () => {
    const a = applyChatEvents(EMPTY_CHAT, [user('hola'), msg('vale'), tool('a', 'Leo', 'x.ts')]);
    const b = applyChatEvents(a, [msg('otra'), tool('b', 'Leo', 'y.ts')]);
    expect(b.items[0]).toBe(a.items[0]);
    expect(b.items[1]).toBe(a.items[1]);
    expect(b.items[2]).toBe(a.items[2]);
    expect(b.items).toHaveLength(5);
  });

  it('normaliza el texto buscable una vez por elemento y warmSearch lo deja preparado', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('Canción ÁRBOL'), msg('Se usa **send-keys**'), tool('a', 'Leo', 'x.ts'), result('a', { output: 'Línea ÚNICA' })]);
    expect(warmSearch(m.items, 1000)).toBe(true);
    // Con el texto ya normalizado, buscar con tildes o sin ellas da lo mismo.
    expect(searchChat(m.items, 'arbol').map((c) => c.key)).toEqual(searchChat(m.items, 'ÁRBOL').map((c) => c.key));
    expect(searchChat(m.items, 'unica')).toHaveLength(1);
    expect(searchChat(m.items, 'send-keys')).toHaveLength(1);
  });

  it('findRanges: el camino ASCII y el normalizado dan las mismas posiciones', () => {
    expect(findRanges('Server y server', 'SERVER')).toEqual([[0, 6], [9, 15]]);
    expect(findRanges('Canción con ACCIÓN', 'accion')).toEqual([[12, 18]]);
    expect(findRanges('añadir ñu', 'ñu')).toEqual([[7, 9]]);
  });

  it('highlightRange: resalta todo si cabe y, si no, una ventana de max alrededor de la actual', () => {
    expect(highlightRange(10, 3, 2000)).toEqual([0, 10]);
    expect(highlightRange(3000, 0)).toEqual([0, MAX_RESALTADAS]);
    expect(highlightRange(3000, 1500)).toEqual([500, 2500]);
    expect(highlightRange(3000, 2999)).toEqual([1000, 3000]);
  });

  it('groupMatches agrupa las claves por elemento', () => {
    const g = groupMatches([
      { key: 'a0', item: 0, step: null },
      { key: 't1:0', item: 1, step: 0 },
      { key: 't1:2', item: 1, step: 2 },
    ]);
    expect([...g.keys()]).toEqual([0, 1]);
    expect([...g.get(1)!]).toEqual(['t1:0', 't1:2']);
  });

  it('el contador cuenta todas y avisa del resalte parcial al superar el límite', () => {
    expect(hitCountLabel(0, 0)).toBe('Sin coincidencias');
    expect(hitCountLabel(0, 3)).toBe('1 de 3');
    expect(hitCountLabel(11, 2000)).toBe('12 de 2.000');
    expect(hitCountLabel(0, 3482)).toBe('1 de 3.482 · resalte parcial');
  });

  it('ventana de render: los últimos, más hacia arriba o abajo, y alrededor de un elemento', () => {
    expect(windowRange(null, 100)).toEqual([0, 100]);
    expect(windowRange(null, 21000)).toEqual([21000 - VENTANA, 21000]);
    const up = windowUp(null, 21000);
    expect(windowRange(up, 21000)).toEqual([21000 - VENTANA - PASO_VENTANA, 21000]);
    // Un tramo fijado hasta el final sigue el final aunque lleguen elementos.
    expect(windowRange(up, 21010)).toEqual([21000 - VENTANA - PASO_VENTANA, 21010]);
    const w = windowAround(100, 21000);
    expect(windowRange(w, 21000)).toEqual([0, VENTANA]);
    expect(windowRange(windowAround(10000, 21000), 21000)).toEqual([10000 - VENTANA / 2, 10000 + VENTANA / 2]);
    // Cerca del final es «los últimos».
    expect(windowAround(20990, 21000)).toBeNull();
    const abajo = windowDown(windowAround(10000, 21000), 21000);
    expect(windowRange(abajo, 21000)).toEqual([9800, 9800 + VENTANA + PASO_VENTANA]);
    expect(windowRange(windowDown({ from: 20000, to: 20800 }, 21000), 21000)).toEqual([20000, 21000]);
    expect(windowDown({ from: 20000, to: 20800 }, 21000)).toEqual({ from: 20000, to: null });
  });
});

describe('avisos para lectores de pantalla', () => {
  it('anuncia solo respuestas de Claude, agrupadas y sin su texto', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('hola'), msg('uno'), tool('a', 'Leo', 'x.ts'), msg('dos'), user('otra'), msg('tres')]);
    expect(newRepliesAnnouncement(m.items, m.items.length)).toBe('');
    expect(newRepliesAnnouncement(m.items, 0)).toBe('3 mensajes nuevos');
    expect(newRepliesAnnouncement(m.items, 4)).toBe('Nueva respuesta de Claude'); // tras 'dos': la persona y 'tres'
    expect(newRepliesAnnouncement(m.items, 5)).toBe('Nueva respuesta de Claude');
    expect(newRepliesAnnouncement(m.items.slice(0, 5), 4)).toBe(''); // solo escribió la persona
  });

  it('el aviso de espera: frase propia y detalle aparte, traducido solo si se reconoce', () => {
    expect(waitingNotice('')).toEqual({ text: 'Claude espera tu respuesta en la terminal.', detail: null, translated: false });
    expect(waitingNotice('Claude needs your permission to use Bash')).toMatchObject({ detail: 'Pide permiso para usar Bash', translated: true });
    expect(waitingNotice('Claude needs your permission to use mcp__x__y.')).toMatchObject({ detail: 'Pide permiso para usar mcp__x__y', translated: true });
    expect(waitingNotice('Claude is waiting for your input')).toMatchObject({ detail: null, translated: true });
    expect(waitingNotice('Algo raro')).toMatchObject({ detail: 'Algo raro', translated: false });
  });
});

describe('tokens del turno', () => {
  const uso = (id: string, output: number): AgentEvent => ({ type: 'usage', id, output, at: 5000 });

  it('cuenta el último valor de cada mensaje, no la suma de sus líneas repetidas', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('hola', 1000), uso('a', 12), uso('a', 12), uso('a', 340), uso('b', 95)]);
    expect(m.turn.output).toBe(435);
    expect(m.turn.startedAt).toBe(1000);
  });

  it('también deduplica cuando las líneas de un mismo mensaje llegan en respuestas distintas', () => {
    const a = applyChatEvents(EMPTY_CHAT, [user('hola'), uso('a', 12)]);
    const b = applyChatEvents(a, [uso('a', 340), uso('b', 60)]);
    expect(b.turn.output).toBe(400);
    // El modelo anterior no cambia.
    expect(a.turn.output).toBe(12);
    expect(a.turn.byId.get('a')).toBe(12);
  });

  it('un mensaje de la persona abre un turno nuevo: los tokens y la hora de inicio se reinician', () => {
    const m = applyChatEvents(EMPTY_CHAT, [user('uno', 1000), uso('a', 500), msg('vale'), user('dos', 9000), uso('b', 40)]);
    expect(m.turn).toMatchObject({ startedAt: 9000, output: 40 });
    // Un mismo id repetido en otro turno cuenta de nuevo (no se arrastra el del turno anterior).
    const n = applyChatEvents(m, [user('tres', 12000), uso('b', 70)]);
    expect(n.turn.output).toBe(70);
  });

  it('con reset empieza de cero', () => {
    const a = applyChatEvents(EMPTY_CHAT, [user('hola', 1000), uso('a', 50)]);
    const b = applyChatEvents(a, [uso('z', 3)], true);
    expect(b.turn).toMatchObject({ startedAt: null, output: 3 });
  });

  it('si solo llegan tokens conserva la lista de elementos (no repinta la conversación) y si no cambian devuelve el mismo modelo', () => {
    const a = applyChatEvents(EMPTY_CHAT, [user('hola'), msg('vale'), uso('a', 10)]);
    const b = applyChatEvents(a, [uso('a', 99)]);
    expect(b.items).toBe(a.items);
    expect(b.turn.output).toBe(99);
    expect(applyChatEvents(b, [uso('a', 99)])).toBe(b);
  });

  it('las funciones puras no modifican el turno de partida', () => {
    const t = startTurn(100);
    const u = addTurnUsage(t, 'a', 7);
    expect(t.output).toBe(0);
    expect(u.output).toBe(7);
    expect(addTurnUsage(u, 'a', 7)).toBe(u);
    expect(EMPTY_TURN.output).toBe(0);
  });

  it('da formato a los tokens como el panel, con un decimal entre 1 000 y 10 000', () => {
    expect(turnTokensLabel(0)).toBeNull();
    expect(turnTokensLabel(950)).toBe('↓ 950 tokens');
    expect(turnTokensLabel(3400)).toBe('↓ 3,4k tokens');
    expect(turnTokensLabel(9990)).toBe('↓ 10,0k tokens');
    expect(turnTokensLabel(12_400)).toBe('↓ 12k tokens');
    expect(turnTokensLabel(1_500_000)).toBe('↓ 1,5M tokens');
  });

  it('el tiempo cuenta desde el último mensaje de la persona o, si no hay, desde que empezó a trabajar', () => {
    const turno = startTurn(10_000);
    expect(workingView(turno, 50_000, 82_000)).toEqual({ elapsed: '1 m 12 s', tokens: null });
    expect(workingView(EMPTY_TURN, 50_000, 72_000).elapsed).toBe('22 s');
    expect(workingView(addTurnUsage(turno, 'a', 3400), 0, 12_000)).toEqual({ elapsed: '2 s', tokens: '↓ 3,4k tokens' });
    // Un reloj atrasado respecto a la transcripción no da tiempos negativos.
    expect(workingView(turno, 0, 5000).elapsed).toBe('0 s');
  });
});

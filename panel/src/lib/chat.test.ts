import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/follow.ts';
import {
  EMPTY_CHAT,
  actionsLabel,
  applyChatEvents,
  conversationDelay,
  countNewMessages,
  errorsLabel,
  findRanges,
  markdownPieces,
  newMessagesLabel,
  normalizeText,
  progressLabel,
  progressPercent,
  searchChat,
  splitHighlight,
  stepLabel,
  toolsSummary,
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

describe('resumen de un grupo', () => {
  it('pone las acciones en infinitivo con su objetivo', () => {
    expect(stepLabel({ verb: 'Leo', target: 'panel/server/tmux.ts' })).toBe('Leer tmux.ts');
    expect(stepLabel({ verb: 'Busco', target: 'send-keys' })).toBe('Buscar «send-keys»');
    expect(stepLabel({ verb: 'Ejecuto', target: 'pnpm test' })).toBe('Ejecutar pnpm test');
    expect(stepLabel({ verb: 'Hago', target: '' })).toBe('Hago');
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

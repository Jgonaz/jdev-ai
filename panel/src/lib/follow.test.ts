import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/follow.ts';
import {
  EMPTY_AGENT,
  FOLLOW_MAX_ITEMS,
  agoLabel,
  applyAgentEvents,
  applyShellText,
  atBottom,
  finalMessage,
  clipMessage,
  errorDelay,
  followAfterScroll,
  followKey,
  isFollowKey,
  lastLines,
  noDataReason,
  ownerSession,
  parseFollowKey,
  plainLine,
  pollDelay,
  resultNote,
  shellLines,
  statusLabel,
} from './follow.ts';

const herramienta = (id: string, verb = 'Leo', target = 'a.ts'): AgentEvent => ({ type: 'tool', id, tool: 'Read', verb, target, at: 1 });
const resultado = (id: string, extra: Partial<Extract<AgentEvent, { type: 'result' }>> = {}): AgentEvent => ({ type: 'result', id, error: false, summary: 'ok', lines: 3, ...extra });

describe('clave de la pestaña', () => {
  it('va y viene, y solo acepta sesiones del panel, tipos e ids válidos', () => {
    const k = followKey('jdev-fit-12', 'agent', 'a0c02c875dad9fa1e');
    expect(k).toBe('follow:jdev-fit-12:agent:a0c02c875dad9fa1e');
    expect(parseFollowKey(k)).toEqual({ session: 'jdev-fit-12', kind: 'agent', id: 'a0c02c875dad9fa1e' });
    for (const mala of ['follow:otra:agent:abc', 'follow:jdev-fit-12:otro:abc', 'follow:jdev-fit-12:agent:ABC', 'follow:jdev-fit-12:agent:', 'jdev-fit-12', 'follow:jdev-a-1:agent:a:b']) {
      expect(parseFollowKey(mala)).toBeNull();
    }
    expect(isFollowKey(k)).toBe(true);
    expect(isFollowKey('jdev-fit-12')).toBe(false);
  });

  it('la sesión dueña de una pestaña es la suya o la que lanzó el seguimiento', () => {
    expect(ownerSession('jdev-a-1')).toBe('jdev-a-1');
    expect(ownerSession('follow:jdev-a-1:shell:b1')).toBe('jdev-a-1');
    expect(ownerSession('follow:mala')).toBeNull();
    expect(ownerSession(null)).toBeNull();
  });
});

describe('applyAgentEvents', () => {
  it('ignora los tokens de salida (solo van en la conversación)', () => {
    const t = applyAgentEvents(EMPTY_AGENT, [{ type: 'usage', id: 'msg_a', output: 10, at: 1 }]);
    expect(t).toEqual(EMPTY_AGENT);
  });

  it('guarda el encargo, las herramientas y los mensajes, y asocia el resultado por id', () => {
    let t = applyAgentEvents(EMPTY_AGENT, [{ type: 'task', text: 'Haz X' }, herramienta('t1'), herramienta('t2', 'Ejecuto', 'ls')]);
    expect(t.task).toBe('Haz X');
    expect(t.toolCount).toBe(2);
    // El resultado llega en otra respuesta.
    t = applyAgentEvents(t, [resultado('t2', { error: true, summary: 'fallo' }), { type: 'message', text: 'Listo', at: 2 }]);
    expect(t.steps.map((s) => s.kind)).toEqual(['tool', 'tool', 'message']);
    expect(t.steps[1]).toMatchObject({ id: 't2', result: { error: true, summary: 'fallo' } });
    expect(t.steps[0]).not.toHaveProperty('result');
  });

  it('un resultado de una herramienta desconocida se ignora y reset empieza de cero', () => {
    const t = applyAgentEvents(EMPTY_AGENT, [herramienta('t1'), resultado('zz')]);
    expect(t.steps).toHaveLength(1);
    expect(applyAgentEvents(t, [{ type: 'task', text: 'Nuevo' }], true)).toEqual({ task: 'Nuevo', steps: [], toolCount: 0 });
  });

  it('conserva como mucho 2 000 pasos pero sigue contando las herramientas', () => {
    const muchos = Array.from({ length: FOLLOW_MAX_ITEMS + 50 }, (_, i) => herramienta(`t${i}`));
    let t = applyAgentEvents(EMPTY_AGENT, muchos);
    expect(t.steps).toHaveLength(FOLLOW_MAX_ITEMS);
    expect(t.toolCount).toBe(FOLLOW_MAX_ITEMS + 50);
    // El resultado de una herramienta que salió por el límite no rompe nada; el de una que sigue, sí se asocia.
    t = applyAgentEvents(t, [resultado('t0'), resultado(`t${FOLLOW_MAX_ITEMS + 49}`)]);
    expect(t.steps.at(-1)).toMatchObject({ result: { summary: 'ok' } });
  });

  it('no modifica el estado anterior', () => {
    const antes = applyAgentEvents(EMPTY_AGENT, [herramienta('t1')]);
    applyAgentEvents(antes, [resultado('t1')]);
    expect(antes.steps[0]).not.toHaveProperty('result');
  });
});

describe('resultNote y finalMessage', () => {
  it('Read, Grep y Glob cuentan; Edit no dice nada; el error siempre se resume; el resto muestra la primera línea', () => {
    expect(resultNote('Read', { error: false, summary: 'x', lines: 142 })).toEqual({ inline: '142 líneas', below: null });
    expect(resultNote('Read', { error: false, summary: 'x', lines: 1 }).inline).toBe('1 línea');
    expect(resultNote('Grep', { error: false, summary: 'a.ts', lines: 3 }).inline).toBe('3 coincidencias');
    expect(resultNote('Grep', { error: false, summary: 'a.ts', lines: 1 }).inline).toBe('1 coincidencia');
    expect(resultNote('Glob', { error: false, summary: 'No files found', lines: 1 }).inline).toBe('sin coincidencias');
    expect(resultNote('Edit', { error: false, summary: 'updated', lines: 1 })).toEqual({ inline: null, below: null });
    expect(resultNote('Bash', { error: false, summary: '31 tests', lines: 4 })).toEqual({ inline: null, below: '31 tests' });
    expect(resultNote('Bash', { error: true, summary: 'boom', lines: 2 })).toEqual({ inline: 'falló', below: 'boom' });
  });

  it('el resultado final es el último mensaje, solo si el subagente terminó', () => {
    const t = applyAgentEvents(EMPTY_AGENT, [{ type: 'message', text: 'a', at: 1 }, herramienta('t1'), { type: 'message', text: 'b', at: 2 }, resultado('t1')]);
    expect(finalMessage(t.steps, 'running')).toBe(-1);
    expect(finalMessage(t.steps, null)).toBe(-1);
    expect(finalMessage(t.steps, 'finished')).toBe(2);
    expect(finalMessage([], 'finished')).toBe(-1);
  });
});

describe('salida de una shell', () => {
  it('quita las secuencias ANSI (colores, cursor, OSC) y los controles, y deja el texto', () => {
    expect(plainLine('\u001b[32m✔\u001b[0m Vite listo')).toBe('✔ Vite listo');
    expect(plainLine('\u001b[2K\u001b[1Gcargando')).toBe('cargando');
    expect(plainLine('\u001b]0;título\u0007hola')).toBe('hola');
    expect(plainLine('\u001b]8;;https://x.dev\u001b\\enlace\u001b]8;;\u001b\\')).toBe('enlace');
    expect(plainLine('a\u0000b\u0007c\u007fd\te')).toBe('abcd\te');
  });

  it('quita también la designación de juego de caracteres y otras secuencias ESC cortas', () => {
    expect(plainLine('\u001b(Bhecho\u001b(0\u001b)B')).toBe('hecho');
    expect(plainLine('\u001b[0m\u001b(B\u001b[m listo')).toBe(' listo');
    expect(plainLine('\u001b7guardo\u001b8 \u001b=\u001b> \u001bM \u001bc fin')).toBe('guardo    fin');
    expect(plainLine('\u001b#8x\u001b%Gy')).toBe('xy');
    expect(plainLine('\u001bPq datos\u001b\\texto')).toBe('texto');
    expect(plainLine('\u001b[?25l\u001b[?2004hhola')).toBe('hola');
  });

  it('el último «\\r» de la línea gana (barras de progreso) y el «\\r» final no cuenta', () => {
    expect(plainLine('10%\r50%\r100%')).toBe('100%');
    expect(plainLine('linea\r')).toBe('linea');
  });

  it('shellLines separa por líneas sin añadir una vacía final', () => {
    expect(shellLines('')).toEqual([]);
    expect(shellLines('a\n\u001b[31mb\u001b[0m\n')).toEqual(['a', 'b']);
    expect(shellLines('sin salto')).toEqual(['sin salto']);
    expect(shellLines('a\n\nb')).toEqual(['a', '', 'b']);
  });

  it('conserva las últimas 2 000 líneas al sumar salida', () => {
    const mil = Array.from({ length: 1500 }, (_, i) => `l${i}`).join('\n') + '\n';
    let t = applyShellText('', mil);
    t = applyShellText(t, mil);
    const lineas = shellLines(t);
    expect(lineas).toHaveLength(FOLLOW_MAX_ITEMS);
    expect(lineas.at(-1)).toBe('l1499');
    expect(applyShellText(t, 'nuevo\n', true)).toBe('nuevo\n');
    expect(lastLines('a\nb\nc\n', 2)).toBe('b\nc\n');
    expect(lastLines('a\nb', 5)).toBe('a\nb');
  });

  it('el texto se queda como texto: no se interpreta nada', () => {
    expect(shellLines('<img src=x onerror=alert(1)>')).toEqual(['<img src=x onerror=alert(1)>']);
  });
});

describe('etiquetas y sondeo', () => {
  const hora = (h: number, m: number) => new Date(2026, 10, 2, h, m).getTime();

  it('estado de un subagente', () => {
    expect(statusLabel('agent', null, null, 0)).toBe('Cargando…');
    expect(statusLabel('agent', 'running', { startedAt: hora(10, 0), updatedAt: null }, hora(10, 4) + 5000)).toBe('Trabajando · 4 min');
    expect(statusLabel('agent', 'running', { startedAt: hora(10, 0), updatedAt: null }, hora(10, 0) + 20_000)).toBe('Trabajando · menos de 1 min');
    expect(statusLabel('agent', 'running', { startedAt: hora(10, 0), updatedAt: null }, hora(11, 5))).toBe('Trabajando · 1 h 05 min');
    expect(statusLabel('agent', 'running', { startedAt: null, updatedAt: null }, 0)).toBe('Trabajando');
    expect(statusLabel('agent', 'finished', { startedAt: hora(10, 0), updatedAt: hora(10, 7) }, 0)).toBe('Terminado · 10:07');
    expect(statusLabel('agent', 'finished', null, 0)).toBe('Terminado');
  });

  it('estado de una shell', () => {
    expect(statusLabel('shell', 'running', { startedAt: hora(21, 40), updatedAt: null }, 0)).toBe('En marcha · desde las 21:40');
    expect(statusLabel('shell', 'running', { startedAt: null, updatedAt: null }, 0)).toBe('En marcha');
    expect(statusLabel('shell', 'finished', { startedAt: hora(21, 40), updatedAt: hora(22, 1) }, 0)).toBe('Terminado · 22:01');
  });

  it('sin datos: ni «Cargando…» ni la razón duplicada, y los reintentos tras un fallo se espacian', () => {
    expect(statusLabel('agent', null, null, 0, true)).toBe('Sin datos');
    expect(statusLabel('agent', null, null, 0)).toBe('Cargando…');
    expect(noDataReason('No hay datos que mostrar: el transcript de la sesión no existe.')).toBe('El transcript de la sesión no existe.');
    expect(noDataReason('No hay datos que mostrar')).toBe('');
    expect(noDataReason('No se pudo contactar con el panel.')).toBe('No se pudo contactar con el panel.');
    expect([1, 2, 3, 4, 9].map(errorDelay)).toEqual([10_000, 30_000, 60_000, 60_000, 60_000]);
  });

  it('solo el resultado final conserva más de 4 000 caracteres', () => {
    expect(clipMessage('a'.repeat(4000))).toHaveLength(4000);
    expect(clipMessage('a'.repeat(9000))).toHaveLength(4000);
    expect(clipMessage('a'.repeat(9000)).endsWith('…')).toBe(true);
  });

  it('«Seguir al final» se suelta con cualquier posición que no sea el final y se recupera al llegar', () => {
    expect(followAfterScroll(true, false, false)).toBe(false); // arrastre, táctil, scrollTo, rueda o teclado
    expect(followAfterScroll(true, false, true)).toBe(true); // scroll propio de la vista
    expect(followAfterScroll(false, true, false)).toBe(true);
    expect(followAfterScroll(false, false, true)).toBe(false);
    expect(followAfterScroll(true, true, false)).toBe(true);
  });

  it('antigüedad de la última actualización', () => {
    expect(agoLabel(null, 5000)).toBe('');
    expect(agoLabel(1000, 3000)).toBe('Actualizado hace 2 s');
    expect(agoLabel(0, 125_000)).toBe('Actualizado hace 2 min');
    expect(agoLabel(0, 3 * 3600_000)).toBe('Actualizado hace 3 h');
  });

  it('sondeo: enseguida si hay más, 1 s en marcha y 10 s si terminó', () => {
    expect(pollDelay('running', true)).toBe(0);
    expect(pollDelay('running', false)).toBe(1000);
    expect(pollDelay('finished', false)).toBe(10_000);
    expect(pollDelay(null, false)).toBe(10_000);
  });

  it('atBottom tolera unos píxeles', () => {
    expect(atBottom({ scrollTop: 596, clientHeight: 400, scrollHeight: 1000 })).toBe(true);
    expect(atBottom({ scrollTop: 500, clientHeight: 400, scrollHeight: 1000 })).toBe(false);
    expect(atBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(true);
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationResponse } from '../../shared/follow.ts';
import { MAP_MAX_EVENTS } from './activityMap.ts';
import { EMPTY_CONVERSATION, applyConversation, forgetConversation, subscribeConversation } from './useConversation.ts';

const { conversation } = vi.hoisted(() => ({ conversation: vi.fn() }));
vi.mock('../api.ts', () => ({
  ApiError: class ApiError extends Error {},
  api: { conversation },
}));

const resp = (over: Partial<ConversationResponse> = {}): ConversationResponse => ({
  sessionId: 's1',
  from: 100,
  size: 100,
  reset: false,
  more: false,
  events: [{ type: 'user', text: 'hola', at: 1 }],
  ...over,
});

describe('applyConversation', () => {
  it('una respuesta vacía válida (transcript aún sin crear) deja la sesión sincronizada y sin mensajes, y los siguientes se leen desde el byte 0', () => {
    const vacia = applyConversation(EMPTY_CONVERSATION, resp({ from: 0, size: 0, events: [] }), 10);
    expect(vacia).toMatchObject({ synced: true, error: null, from: 0, size: 0 });
    expect(vacia.chat.items).toEqual([]);
    const luego = applyConversation(vacia, resp({ from: 120, size: 120, events: [{ type: 'user', text: 'primero', at: 5 }] }), 20);
    expect(luego.chat.items).toHaveLength(1);
    expect(luego.from).toBe(120);
  });

  it('lee por trozos: hasta el último no está sincronizada y guarda el byte siguiente', () => {
    const a = applyConversation(EMPTY_CONVERSATION, resp({ from: 50, size: 100, more: true }), 10);
    expect(a).toMatchObject({ sessionId: 's1', from: 50, size: 100, synced: false, lastOk: 10, error: null, failures: 0 });
    const b = applyConversation(a, resp({ from: 100, events: [{ type: 'message', text: 'vale', at: 2 }] }), 20);
    expect(b.synced).toBe(true);
    expect(b.chat.items.map((i) => i.kind)).toEqual(['user', 'agent']);
  });

  it('una vez al día, un trozo con más por leer no la desincroniza', () => {
    const a = applyConversation(EMPTY_CONVERSATION, resp(), 10);
    const b = applyConversation(a, resp({ from: 150, size: 400, more: true, events: [] }), 20);
    expect(b.synced).toBe(true);
  });

  it('borra el error y los fallos con una respuesta correcta', () => {
    const e = { ...EMPTY_CONVERSATION, error: 'x', failures: 3 };
    expect(applyConversation(e, resp(), 5)).toMatchObject({ error: null, failures: 0 });
  });

  it('reset descarta lo leído y empieza de cero', () => {
    const a = applyConversation(EMPTY_CONVERSATION, resp(), 10);
    const b = applyConversation(a, resp({ reset: true, from: 30, size: 30, events: [{ type: 'message', text: 'nueva', at: 3 }] }), 20);
    expect(b.chat.items.map((i) => i.kind)).toEqual(['agent']);
    expect(b.from).toBe(30);
  });

  it('si cambia la sesión de Claude, descarta todo y vuelve a leer desde el principio', () => {
    const a = applyConversation(EMPTY_CONVERSATION, resp(), 10);
    // Pedido desde el byte 100 de otro archivo: la respuesta no empieza al principio, se ignora y se relee.
    const b = applyConversation(a, resp({ sessionId: 's2', from: 140, size: 140, events: [{ type: 'user', text: 'tarde', at: 9 }] }), 20);
    expect(b).toMatchObject({ sessionId: 's2', from: 0, synced: false });
    expect(b.chat.items).toEqual([]);
    // La relectura desde 0 ya sí se aplica.
    const c = applyConversation(b, resp({ sessionId: 's2', from: 140, size: 140, events: [{ type: 'user', text: 'entera', at: 9 }] }), 30);
    expect(c.synced).toBe(true);
    expect(c.chat.items).toHaveLength(1);
  });
});

describe('applyConversation: eventos del mapa', () => {
  const tool = (id: string, at = 1): ConversationResponse['events'][number] => ({ type: 'tool', id, tool: 'Read', verb: 'Leo', target: 'a.ts', detail: 'x', at, station: 'archivos' });

  it('guarda una versión ligera: sin textos de mensajes, sin salidas ni detalles', () => {
    const r = applyConversation(
      EMPTY_CONVERSATION,
      resp({
        events: [
          { type: 'user', text: 'secreto', at: 1 },
          tool('a'),
          { type: 'result', id: 'a', error: false, summary: 'resumen', lines: 2, output: 'salida', at: 2 },
          { type: 'message', text: 'respuesta', at: 3 },
          { type: 'command-output', text: 'x', error: false, at: 4 },
        ],
      }),
      10,
    );
    expect(r.mapEvents.map((e) => e.type)).toEqual(['user', 'tool', 'result', 'message']);
    expect(JSON.stringify(r.mapEvents)).not.toMatch(/secreto|resumen|salida|respuesta/);
    expect(r.mapEvents[1]).not.toHaveProperty('detail');
    expect(r.mapTotal).toBe(4);
  });

  it('acumula entre respuestas y mapTotal cuenta lo que llega aunque se descarte lo antiguo', () => {
    const a = applyConversation(EMPTY_CONVERSATION, resp({ events: [tool('a')] }), 10);
    const b = applyConversation(a, resp({ events: [tool('b'), tool('c')] }), 20);
    expect(b.mapEvents.map((e) => (e.type === 'tool' ? e.id : ''))).toEqual(['a', 'b', 'c']);
    expect(b.mapTotal).toBe(3);
    // Sin eventos nuevos, el mismo array (no se copia).
    expect(applyConversation(b, resp({ events: [] }), 30).mapEvents).toBe(b.mapEvents);
  });

  it('limita los eventos guardados a los últimos MAP_MAX_EVENTS', () => {
    const muchos = Array.from({ length: MAP_MAX_EVENTS + 5 }, (_, i) => tool(`t${i}`));
    const r = applyConversation(EMPTY_CONVERSATION, resp({ events: muchos }), 10);
    expect(r.mapEvents).toHaveLength(MAP_MAX_EVENTS);
    expect(r.mapEvents[MAP_MAX_EVENTS - 1]).toMatchObject({ id: `t${MAP_MAX_EVENTS + 4}` });
    expect(r.mapTotal).toBe(MAP_MAX_EVENTS + 5);
  });

  it('se vacía con un reset y al cambiar de sesión (también cuando la respuesta no empieza al principio)', () => {
    const a = applyConversation(EMPTY_CONVERSATION, resp({ events: [tool('a'), tool('b')] }), 10);
    const reset = applyConversation(a, resp({ reset: true, events: [tool('z')] }), 20);
    expect(reset.mapEvents).toHaveLength(1);
    expect(reset.mapTotal).toBe(1);
    const otra = applyConversation(a, resp({ sessionId: 's2', from: 140, size: 140, events: [tool('t')] }), 30);
    expect(otra).toMatchObject({ mapEvents: [], mapTotal: 0, from: 0, synced: false });
    const releida = applyConversation(otra, resp({ sessionId: 's2', from: 140, size: 140, events: [tool('t')] }), 40);
    expect(releida.mapEvents).toHaveLength(1);
    expect(releida.mapTotal).toBe(1);
  });
});

describe('subscribeConversation: un solo sondeo por sesión', () => {
  const respuesta = (over: Partial<ConversationResponse> = {}) => ({ sessionId: 's1', from: 10, size: 10, reset: false, more: false, events: [], ...over });
  const NOMBRE = 'jdev-test-1';

  beforeEach(() => {
    vi.useFakeTimers();
    conversation.mockReset();
    conversation.mockResolvedValue(respuesta());
    forgetConversation(NOMBRE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const lector = (trabajando = false) => ({ trabajando: { current: trabajando } });
  /** Deja correr los temporizadores y las promesas pendientes. */
  const avanza = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('dos lectores de la misma sesión comparten el sondeo: una pregunta por turno, no dos', async () => {
    const a = subscribeConversation(NOMBRE, lector());
    const b = subscribeConversation(NOMBRE, lector());
    await avanza(0);
    expect(conversation).toHaveBeenCalledTimes(1);
    await avanza(3000);
    expect(conversation).toHaveBeenCalledTimes(2);
    a.dejar();
    b.dejar();
  });

  it('el sondeo sigue mientras quede un lector y se detiene al irse el último; otra sesión tiene el suyo', async () => {
    const a = subscribeConversation(NOMBRE, lector());
    const b = subscribeConversation(NOMBRE, lector());
    await avanza(0);
    a.dejar();
    await avanza(3000);
    expect(conversation).toHaveBeenCalledTimes(2);
    b.dejar();
    await avanza(10_000);
    expect(conversation).toHaveBeenCalledTimes(2);
    // Una sesión distinta pregunta por su cuenta.
    conversation.mockClear();
    const c = subscribeConversation('jdev-test-2', lector());
    await avanza(0);
    expect(conversation).toHaveBeenCalledWith('jdev-test-2', 0, expect.anything());
    c.dejar();
    forgetConversation('jdev-test-2');
  });

  it('el ritmo lo marca quien ve trabajar al agente: cada segundo si alguno trabaja, cada 3 s si ninguno', async () => {
    const ocioso = lector(false);
    const activo = lector(true);
    const a = subscribeConversation(NOMBRE, ocioso);
    const b = subscribeConversation(NOMBRE, activo);
    await avanza(0);
    conversation.mockClear();
    await avanza(3000);
    expect(conversation).toHaveBeenCalledTimes(3);
    activo.trabajando.current = false;
    conversation.mockClear();
    await avanza(3000);
    expect(conversation).toHaveBeenCalledTimes(1);
    a.dejar();
    b.dejar();
  });

  it('refrescar pregunta ya, sin esperar al siguiente turno', async () => {
    const a = subscribeConversation(NOMBRE, lector());
    await avanza(0);
    conversation.mockClear();
    a.refrescar();
    await avanza(0);
    expect(conversation).toHaveBeenCalledTimes(1);
    a.dejar();
  });
});

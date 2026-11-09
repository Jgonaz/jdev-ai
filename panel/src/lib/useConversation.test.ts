import { describe, expect, it } from 'vitest';
import type { ConversationResponse } from '../../shared/follow.ts';
import { EMPTY_CONVERSATION, applyConversation } from './useConversation.ts';

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

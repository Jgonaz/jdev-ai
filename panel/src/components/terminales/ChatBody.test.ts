// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ConversationResponse } from '../../../shared/follow.ts';
import type { SessionInfo } from '../../types.ts';
import { forgetConversation } from '../../lib/useConversation.ts';
import { ChatBody } from './ChatBody.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOMBRE = 'jdev-demo-1';
const sesion = (over: Partial<SessionInfo> = {}): SessionInfo =>
  ({ name: NOMBRE, agent: 'claude', state: 'idle', tracked: true, alive: true, done: null, notice: '', chat: { available: true, reason: null }, ...over }) as SessionInfo;

const eventos: AgentEvent[] = [
  { type: 'user', text: 'Prueba <b>typeLine</b>\ncon dos líneas', at: Date.UTC(2026, 10, 9, 10, 0) },
  { type: 'message', text: 'Se usa `typeLine` con **send-keys**.\n\n<script>alert(1)</script>', at: null },
  { type: 'tool', id: 'a', tool: 'Read', verb: 'Leo', target: 'server/tmux.ts', at: null },
  { type: 'tool', id: 'b', tool: 'Bash', verb: 'Ejecuto', target: 'pnpm test', at: null },
  { type: 'result', id: 'a', error: false, summary: 'x', lines: 3, output: 'export function TYPELINE() {}' },
  { type: 'result', id: 'b', error: true, summary: 'falló', lines: 1, output: 'Error: boom' },
];

let raiz: Root;
let contenedor: HTMLElement;
const peticiones: string[] = [];

beforeEach(() => {
  forgetConversation(NOMBRE);
  peticiones.length = 0;
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      peticiones.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/conversation')) {
        const r: ConversationResponse = { sessionId: 's1', from: 10, size: 10, reset: false, more: false, events: eventos };
        return new Response(JSON.stringify(r), { status: 200 });
      }
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    }),
  );
  // happy-dom no implementa scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  vi.unstubAllGlobals();
});

const monta = async (props: Partial<Parameters<typeof ChatBody>[0]> = {}) => {
  await act(async () => {
    raiz.render(createElement(ChatBody, { session: sesion(), active: true, searching: false, onSearching: () => undefined, searchTick: 0, onTerminal: () => undefined, ...props }));
  });
  // Deja resolver la primera lectura.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe('ChatBody', () => {
  it('pinta mensajes (la persona como texto plano), el Markdown saneado y las herramientas plegadas', async () => {
    await monta();
    expect(peticiones[0]).toBe(`GET /api/sessions/${NOMBRE}/conversation?from=0`);
    const burbuja = contenedor.querySelector('.chat__bubble')!;
    expect(burbuja.textContent).toBe('Prueba <b>typeLine</b>\ncon dos líneas');
    expect(burbuja.querySelector('b')).toBeNull();
    expect(contenedor.querySelector('.chat__agent script')).toBeNull();
    expect(contenedor.querySelector('.chat__agent strong')?.textContent).toBe('send-keys');
    expect(contenedor.textContent).toContain('Tú · ');
    const grupo = contenedor.querySelector<HTMLDetailsElement>('.chat__tools')!;
    expect(grupo.open).toBe(false);
    expect(grupo.textContent).toContain('2 acciones');
    expect(grupo.textContent).toContain('1 error');
    expect(grupo.querySelector('.chat__step')).toBeNull(); // plegado: no se pintan las acciones
  });

  it('al buscar resalta con <mark>, cuenta las coincidencias y abre los grupos que las contienen', async () => {
    await monta({ searching: true });
    const campo = contenedor.querySelector<HTMLInputElement>('.chat__searchinput')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(campo, 'TYPELINE');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 3');
    const marcas = [...contenedor.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marcas).toEqual(['typeLine', 'typeLine', 'TYPELINE']);
    expect(contenedor.querySelector<HTMLDetailsElement>('.chat__tools')!.open).toBe(true);
    expect(contenedor.querySelectorAll('.chat__hit--cur')).toHaveLength(1);
    // Enter pasa a la siguiente coincidencia.
    await act(async () => {
      campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('2 de 3');
  });

  it('enseña el aviso de espera con el botón para ir a la terminal', async () => {
    const alTerminal = vi.fn();
    await monta({ session: sesion({ state: 'waiting', notice: 'Pide permiso' }), onTerminal: alTerminal });
    const aviso = contenedor.querySelector('.chat__wait')!;
    expect(aviso.textContent).toContain('Claude espera tu respuesta en la terminal: Pide permiso');
    await act(async () => {
      aviso.querySelector('button')!.click();
    });
    expect(alTerminal).toHaveBeenCalled();
  });

  it('Enter envía el mensaje (con sus saltos de línea) y vacía la caja; Mayús+Enter no envía', async () => {
    await monta();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, 'línea 1\nlínea 2');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(peticiones.some((p) => p.startsWith('POST'))).toBe(false);
    await act(async () => {
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(peticiones).toContain(`POST /api/sessions/${NOMBRE}/input`);
    expect(area.value).toBe('');
  });

  it('si el envío falla conserva el texto y lo dice', async () => {
    await monta();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'La sesión ya no existe.' }), { status: 404 })),
    );
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'hola');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(area.value).toBe('hola');
    expect(contenedor.querySelector('.chat__senderr')?.textContent).toContain('La sesión ya no existe.');
    expect(contenedor.querySelector('.chat__senderr')?.textContent).toContain('El texto sigue en la caja');
  });
});

// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ConversationResponse } from '../../../shared/follow.ts';
import type { SessionInfo } from '../../types.ts';
import { parseAgentLines } from '../../../server/follow.ts';
import { comandosDeSistema } from '../../../server/follow-fixtures.ts';
import { forgetBtw } from '../../lib/btw.ts';
import { forgetConversation } from '../../lib/useConversation.ts';
import { ChatBody, RETARDO_BUSQUEDA } from './ChatBody.tsx';

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

/** IntersectionObserver de prueba (happy-dom no lo dispara): avisa al observar, según `esVisible`. */
let esVisible: (el: Element) => boolean = (el) => !el.classList.contains('chat__more');
class FalsoIO {
  constructor(private cb: (es: Array<{ target: Element; isIntersecting: boolean }>) => void) {}
  observe(el: Element) {
    queueMicrotask(() => this.cb([{ target: el, isIntersecting: esVisible(el) }]));
  }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  forgetConversation(NOMBRE);
  forgetBtw(NOMBRE);
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
  esVisible = (el) => !el.classList.contains('chat__more');
  vi.stubGlobal('IntersectionObserver', FalsoIO);
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

/** Deja pasar el retardo de la búsqueda y que se pinte su resultado. */
const esperaBusqueda = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, RETARDO_BUSQUEDA + 80));
  });

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
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 3');
    const marcas = [...contenedor.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marcas).toEqual(['typeLine', 'typeLine', 'TYPELINE']);
    expect(contenedor.querySelector<HTMLDetailsElement>('.chat__tools')!.open).toBe(true);
    expect(contenedor.querySelectorAll('.chat__hit--cur')).toHaveLength(1);
    // Enter pasa a la siguiente coincidencia.
    await act(async () => {
      campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      // El salto se aplica en el siguiente fotograma (requestAnimationFrame).
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('2 de 3');
  });

  it('enseña el aviso de espera con el botón para ir a la terminal', async () => {
    const alTerminal = vi.fn();
    await monta({ session: sesion({ state: 'waiting', notice: 'Pide permiso' }), onTerminal: alTerminal });
    const aviso = contenedor.querySelector('.chat__wait')!;
    expect(aviso.querySelector('.chat__waittext')?.firstChild?.textContent).toBe('Claude espera tu respuesta en la terminal.');
    // Lo que dijo el hook va aparte, entre comillas (no se traduce texto desconocido).
    expect(aviso.querySelector('.chat__waitdetail')?.textContent).toBe('«Pide permiso»');
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

// ---------------------------------------------------------------------- Comandos, /btw y ventanas abiertas

const eventosComando: AgentEvent[] = [
  { type: 'user', text: 'Hola', at: null },
  { type: 'command', name: 'goal', args: 'close', at: Date.UTC(2026, 10, 9, 10, 1) },
  { type: 'command-output', text: 'Objetivo CERRADO', error: false, at: null },
  { type: 'message', text: 'Hecho.', at: null },
];

/** fetch de prueba: la conversación con `eventosLista` y el envío como diga `alEnviar`. */
function stubFetch(eventosLista: AgentEvent[], alEnviar: (cuerpo: { text: string }) => Promise<Response> | Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      peticiones.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/conversation')) {
        // Como el servidor: lo leído desde el byte 0 y, después, nada nuevo.
        const r: ConversationResponse = { sessionId: 's1', from: 10, size: 10, reset: false, more: false, events: url.endsWith('from=0') ? eventosLista : [] };
        return new Response(JSON.stringify(r), { status: 200 });
      }
      return alEnviar(JSON.parse(String(init?.body)) as { text: string });
    }),
  );
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });

const escribeYEnvia = async (texto: string) => {
  const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, texto);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
  return area;
};

describe('ChatBody: sesión sin transcript todavía', () => {
  it('con la respuesta vacía válida del servidor enseña el estado vacío, no el error rojo, y empieza a mostrar mensajes en cuanto aparecen', async () => {
    let respuesta: AgentEvent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const from = Number(/from=(\d+)/.exec(url)?.[1] ?? 0);
        const r: ConversationResponse = { sessionId: 's1', from: respuesta.length > 0 && from === 0 ? 10 : from, size: respuesta.length > 0 ? 10 : 0, reset: false, more: false, events: from === 0 ? respuesta : [] };
        return new Response(JSON.stringify(r), { status: 200 });
      }),
    );
    await monta();
    expect(contenedor.textContent).toContain('Todavía no hay mensajes en esta sesión.');
    expect(contenedor.querySelector('.chat__alert')).toBeNull();
    // Aparece el transcript: el siguiente sondeo (a los 3 s) o «refrescar» lo trae.
    respuesta = [{ type: 'user', text: 'Primer mensaje', at: null }];
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3200));
    });
    expect(contenedor.textContent).toContain('Primer mensaje');
    expect(contenedor.textContent).not.toContain('Todavía no hay mensajes');
  });
});

describe('ChatBody: comandos', () => {
  it('pinta un comando como mensaje de la persona en monoespaciado, con su salida atenuada debajo, y no como un mensaje normal', async () => {
    stubFetch(eventosComando, () => json({ sent: true }));
    await monta();
    const cmd = contenedor.querySelector('.chat__cmd')!;
    expect(cmd.querySelector('.chat__bubble--cmd')?.textContent).toBe('/goal close');
    expect(cmd.querySelector('.chat__cmdout')?.textContent).toBe('Objetivo CERRADO');
    expect(cmd.textContent).toContain('Tú');
    expect(contenedor.querySelectorAll('.chat__user')).toHaveLength(2);
  });

  it('los comandos que Claude escribe como system/local_command (/rename, /resume…) se pintan igual que los de tipo user', async () => {
    // Del transcript tal cual (líneas `system`), pasando por el intérprete del servidor.
    const deSistema = parseAgentLines(comandosDeSistema().join('\n'), { primero: true, cwd: null, conversacion: true });
    stubFetch(deSistema, () => json({ sent: true }));
    await monta();
    const comandos = [...contenedor.querySelectorAll('.chat__cmd')];
    expect(comandos.map((c) => c.querySelector('.chat__bubble--cmd')?.textContent)).toEqual(['/rename mi sesión', '/resume']);
    expect(comandos.map((c) => c.querySelector('.chat__cmdout')?.textContent)).toEqual(['Session renamed to: mi sesión', 'Resume cancelled']);
  });

  it('entra en la búsqueda: resalta el comando y su salida', async () => {
    stubFetch(eventosComando, () => json({ sent: true }));
    await monta({ searching: true });
    const campo = contenedor.querySelector<HTMLInputElement>('.chat__searchinput')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, 'cerrado');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 1');
    expect(contenedor.querySelector('.chat__cmdout mark')?.textContent).toBe('CERRADO');
  });

  it('si el comando abre un menú en la terminal avisa de que espera, con el botón para ir a ella', async () => {
    stubFetch(eventosComando, () => json({ sent: true, awaitingTerminal: true }));
    const alTerminal = vi.fn();
    await monta({ onTerminal: alTerminal });
    await escribeYEnvia('/model');
    const aviso = [...contenedor.querySelectorAll('.chat__wait')].find((a) => a.textContent?.includes('El comando espera en la terminal'))!;
    expect(aviso).toBeTruthy();
    await act(async () => {
      aviso.querySelector<HTMLButtonElement>('.chat__waitbtn')!.click();
    });
    expect(alTerminal).toHaveBeenCalled();
    // Se puede descartar.
    await act(async () => {
      aviso.querySelector<HTMLButtonElement>('.link-btn')!.click();
    });
    expect(contenedor.textContent).not.toContain('El comando espera en la terminal');
  });
});

describe('ChatBody: /btw', () => {
  it('mientras espera enseña el estado y, al llegar, la respuesta como texto preformateado en un bloque aparte, tras el último elemento', async () => {
    let responde!: (r: Response) => void;
    stubFetch(eventosComando, () => new Promise<Response>((ok) => (responde = ok)));
    await monta();
    await escribeYEnvia('/btw ¿qué **archivo**?');
    const bloque = contenedor.querySelector('.chat__btw')!;
    expect(bloque.textContent).toContain('Pregunta al margen');
    expect(bloque.textContent).toContain('¿qué **archivo**?');
    expect(bloque.textContent).toContain('Esperando la respuesta de /btw…');
    // La caja conserva el texto mientras espera.
    expect(contenedor.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('/btw ¿qué **archivo**?');
    await act(async () => {
      responde(json({ sent: true, btw: { question: '¿qué **archivo**?', answer: 'Estábamos en **tmux.ts**\n\n    a = 1\n    b = 2\n<script>x</script>', truncated: false } }));
      await new Promise((r) => setTimeout(r, 20));
    });
    // Sin pasar por Markdown: ni negritas ni párrafos, y el texto exacto (saltos de línea y sangría) en un <pre>.
    expect(contenedor.querySelector('.chat__btw strong')).toBeNull();
    expect(contenedor.querySelector('.chat__btw .chat__md')).toBeNull();
    expect(contenedor.querySelector('.chat__btw pre.chat__btwans')?.textContent).toBe('Estábamos en **tmux.ts**\n\n    a = 1\n    b = 2\n<script>x</script>');
    expect(contenedor.querySelector('.chat__btw script')).toBeNull();
    expect(contenedor.querySelector('.chat__btw')?.textContent).not.toContain('Esperando');
    expect(contenedor.querySelector('.chat__btwnote')?.textContent).toContain('No forma parte de la conversación');
    expect(contenedor.querySelector('.chat__btwwarn')).toBeNull();
    expect(contenedor.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    // Va después de los elementos que había al enviarlo (la conversación tiene 4).
    const lista = contenedor.querySelector('.chat__list')!;
    expect(lista.lastElementChild).toBe(contenedor.querySelector('.chat__btw'));
  });

  it('una respuesta truncada lo avisa', async () => {
    stubFetch(eventosComando, () => json({ sent: true, btw: { question: 'q', answer: 'a medias', truncated: true } }));
    await monta();
    await escribeYEnvia('/btw q');
    expect(contenedor.querySelector('.chat__btwwarn')?.textContent).toContain('Puede estar incompleta');
  });

  it('si no llegó a tiempo (pending) avisa con el botón «Ir a la terminal»', async () => {
    stubFetch(eventosComando, () => json({ sent: true, btw: null, pending: true }));
    const alTerminal = vi.fn();
    await monta({ onTerminal: alTerminal });
    await escribeYEnvia('/btw lenta');
    const bloque = contenedor.querySelector('.chat__btw')!;
    expect(bloque.textContent).toContain('sigue abierta en la terminal');
    await act(async () => {
      bloque.querySelector<HTMLButtonElement>('button')!.click();
    });
    expect(alTerminal).toHaveBeenCalled();
  });

  it('si el envío falla no deja el bloque y conserva el texto', async () => {
    stubFetch(eventosComando, () => json({ error: 'La sesión no existe.' }, 404));
    await monta();
    const area = await escribeYEnvia('/btw q');
    expect(contenedor.querySelector('.chat__btw')).toBeNull();
    expect(area.value).toBe('/btw q');
  });

  it('un mensaje normal no crea bloque de /btw', async () => {
    stubFetch(eventosComando, () => json({ sent: true }));
    await monta();
    await escribeYEnvia('hola');
    expect(contenedor.querySelector('.chat__btw')).toBeNull();
  });
});

describe('ChatBody: ventana de Claude abierta (tui-busy)', () => {
  it('conserva el texto, explica que hay que cerrarla en la terminal y ofrece ir a ella', async () => {
    stubFetch(eventosComando, () =>
      json({ error: 'La terminal tiene abierta una ventana de Claude: ciérrala o respóndela en la terminal.', code: 'tui-busy' }, 409),
    );
    const alTerminal = vi.fn();
    await monta({ onTerminal: alTerminal });
    const area = await escribeYEnvia('mensaje que no debe perderse');
    expect(area.value).toBe('mensaje que no debe perderse');
    const aviso = contenedor.querySelector('.chat__senderr')!;
    expect(aviso.textContent).toContain('La terminal tiene abierta una ventana de Claude');
    expect(aviso.textContent).toContain('El texto sigue en la caja');
    await act(async () => {
      aviso.querySelector<HTMLButtonElement>('button')!.click();
    });
    expect(alTerminal).toHaveBeenCalled();
  });

  it('otro error de envío no ofrece ir a la terminal', async () => {
    stubFetch(eventosComando, () => json({ error: 'Falló.' }, 500));
    await monta();
    await escribeYEnvia('hola');
    expect(contenedor.querySelector('.chat__senderr button')).toBeNull();
  });
});

// ---------------------------------------------------------------------- Aviso de espera, accesibilidad, rendimiento

const escribeBusqueda = async (texto: string) => {
  const campo = contenedor.querySelector<HTMLInputElement>('.chat__searchinput')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return campo;
};

describe('ChatBody: aviso de espera', () => {
  it('traduce «needs your permission to use X» y lo enseña aparte de la frase propia', async () => {
    await monta({ session: sesion({ state: 'waiting', notice: 'Claude needs your permission to use Bash' }) });
    const aviso = contenedor.querySelector('.chat__wait')!;
    expect(aviso.querySelector('.chat__waittext')?.firstChild?.textContent).toBe('Claude espera tu respuesta en la terminal.');
    expect(aviso.querySelector('.chat__waitdetail')?.textContent).toBe('Pide permiso para usar Bash');
    expect(aviso.textContent).not.toContain('needs your permission');
  });

  it('un mensaje desconocido se enseña tal cual, entre comillas, sin traducirlo', async () => {
    await monta({ session: sesion({ state: 'waiting', notice: 'Something odd happened' }) });
    expect(contenedor.querySelector('.chat__waitdetail')?.textContent).toBe('«Something odd happened»');
  });

  it('sin mensaje del hook solo hay la frase', async () => {
    await monta({ session: sesion({ state: 'waiting', notice: '' }) });
    expect(contenedor.querySelector('.chat__waittext')?.textContent).toBe('Claude espera tu respuesta en la terminal.');
    expect(contenedor.querySelector('.chat__waitdetail')).toBeNull();
  });
});

describe('ChatBody: lectores de pantalla', () => {
  it('el log no es una región viva y hay una región «status» oculta aparte, más la de la pastilla', async () => {
    await monta();
    const log = contenedor.querySelector('[role="log"]')!;
    expect(log.getAttribute('aria-live')).toBe('off');
    expect(log.querySelector('[role="status"]')).toBeNull();
    const oculta = contenedor.querySelector('.sr-only[role="status"]')!;
    expect(oculta).toBeTruthy();
    expect(oculta.textContent).toBe(''); // la conversación ya cargada no se anuncia
    expect(contenedor.querySelector('.chat__pillslot[role="status"]')).toBeTruthy();
  });

  it('anuncia «Nueva respuesta de Claude» (sin leerla) cuando llega una respuesta, agrupada', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        peticiones.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/conversation')) {
          const primera = url.endsWith('from=0');
          const nuevos: AgentEvent[] = !primera && n++ === 0 ? [{ type: 'message', text: 'Segunda respuesta SECRETA', at: null }] : [];
          const r: ConversationResponse = { sessionId: 's1', from: 10, size: 10, reset: false, more: false, events: primera ? eventos : nuevos };
          return new Response(JSON.stringify(r), { status: 200 });
        }
        return new Response(JSON.stringify({ sent: true }), { status: 200 });
      }),
    );
    await monta();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'hola');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 40));
    });
    const oculta = contenedor.querySelector('.sr-only[role="status"]')!;
    expect(oculta.textContent).toBe(''); // aún dentro del retardo de agrupación
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    expect(oculta.textContent).toBe('Nueva respuesta de Claude');
    expect(oculta.textContent).not.toContain('SECRETA');
  });
});

describe('ChatBody: búsqueda en conversaciones largas', () => {
  /** `n` mensajes del agente; el de la posición `donde` lleva la palabra ZORRO. */
  const larga = (n: number, donde: number[]): AgentEvent[] =>
    Array.from({ length: n }, (_, i): AgentEvent => ({ type: 'message', text: donde.includes(i) ? `mensaje ${i} con ZORRO dentro` : `mensaje ${i}`, at: null }));

  it('espera a que se deje de escribir antes de buscar y mientras tanto no dice «Sin coincidencias»', async () => {
    await monta({ searching: true });
    await escribeBusqueda('TYPELINE');
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('Buscando…');
    expect(contenedor.querySelector('mark')).toBeNull();
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 3');
  });

  it('pinta solo los últimos elementos y carga más hacia arriba sin perder el sitio', async () => {
    stubFetch(larga(1000, []), () => json({ sent: true }));
    await monta();
    expect(contenedor.querySelectorAll('.chat__agent')).toHaveLength(400);
    expect(contenedor.querySelector('.chat__agent')?.textContent).toContain('mensaje 600');
    const mas = contenedor.querySelector<HTMLButtonElement>('.chat__more .chat__morebtn')!;
    expect(mas.textContent).toContain('600 más');
    await act(async () => {
      mas.click();
    });
    expect(contenedor.querySelectorAll('.chat__agent')).toHaveLength(700);
    expect(contenedor.querySelector('.chat__agent')?.textContent).toContain('mensaje 300');
  });

  it('cuenta todas las coincidencias, salta a una antigua pintando un tramo a su alrededor y deja volver al final', async () => {
    stubFetch(larga(1000, [10, 995]), () => json({ sent: true }));
    await monta({ searching: true });
    await escribeBusqueda('zorro');
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 2');
    // La primera coincidencia es la 10: no estaba pintada, y ahora sí, resaltada y como actual.
    const actual = contenedor.querySelector('.chat__hit--cur')!;
    expect(actual.textContent).toContain('mensaje 10 con');
    expect(actual.querySelector('mark')?.textContent).toBe('ZORRO');
    expect(contenedor.querySelectorAll('.chat__agent').length).toBeLessThanOrEqual(401);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const alFinal = [...contenedor.querySelectorAll<HTMLButtonElement>('.chat__morebtn')].find((b) => b.textContent?.includes('Ir al final'))!;
    await act(async () => {
      alFinal.click();
    });
    expect(contenedor.querySelector('.chat__agent:last-of-type')?.textContent).toContain('mensaje 999');
    expect([...contenedor.querySelectorAll('.chat__morebtn')].some((b) => b.textContent?.includes('Ir al final'))).toBe(false);
  });

  it('solo pinta <mark> en lo que está cerca de la pantalla y en la coincidencia actual', async () => {
    stubFetch(larga(300, [100, 101, 102]), () => json({ sent: true }));
    // Solo el elemento 101 «está cerca».
    esVisible = (el) => el.textContent?.includes('mensaje 101 ') === true;
    await monta({ searching: true });
    await escribeBusqueda('zorro');
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 3');
    const conMarca = [...contenedor.querySelectorAll('.chat__hit')].filter((e) => e.querySelector('mark')).map((e) => e.textContent);
    expect(contenedor.querySelectorAll('.chat__hit')).toHaveLength(3); // las tres cuentan como coincidencia
    expect(conMarca).toHaveLength(2); // la cercana y la actual (la primera)
    expect(conMarca.some((t) => t?.includes('mensaje 101 '))).toBe(true);
    expect(conMarca.some((t) => t?.includes('mensaje 100 '))).toBe(true);
  });

  /** Teclea Enter `n` veces fuera de `act` (cada tecla, una tarea del navegador) y deja pasar un par de fotogramas. */
  const rafagaDeEnter = async (campo: HTMLInputElement, n: number, tecla: Partial<KeyboardEventInit> = {}) => {
    const global = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    global.IS_REACT_ACT_ENVIRONMENT = false;
    const errores = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (let i = 0; i < n; i++) {
        campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ...tecla }));
        await new Promise((r) => setTimeout(r, 0));
      }
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      global.IS_REACT_ACT_ENVIRONMENT = true;
    }
    const avisos = errores.mock.calls.map((c) => String(c[0]));
    errores.mockRestore();
    return avisos.filter((a) => /Maximum update depth/.test(a));
  };

  it('una ráfaga de 400 Enter con coincidencias lejanas no encadena renders sin fin (React #185): acaba en la coincidencia esperada, pintada y centrada', async () => {
    // Coincidencias separadas por más que la ventana de render (400): cada Enter obligaría a mover la ventana.
    stubFetch(larga(4000, Array.from({ length: 20 }, (_, i) => i * 200)), () => json({ sent: true }));
    await monta({ searching: true });
    await escribeBusqueda('zorro');
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 20');
    const campo = contenedor.querySelector<HTMLInputElement>('.chat__searchinput')!;
    expect(await rafagaDeEnter(campo, 400)).toEqual([]);
    // 400 pasos = 20 vueltas completas a las 20 coincidencias: otra vez la primera.
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 20');
    expect(contenedor.querySelector('.chat__hit--cur')?.textContent).toContain('mensaje 0 con');
    expect(contenedor.querySelectorAll('.chat__agent').length).toBeLessThanOrEqual(401);
  }, 30000);

  it('las pulsaciones de Enter que llegan antes del siguiente fotograma se agrupan: el índice se acumula y se aplica un solo salto', async () => {
    stubFetch(larga(8000, Array.from({ length: 40 }, (_, i) => i * 200)), () => json({ sent: true }));
    await monta({ searching: true });
    await escribeBusqueda('zorro');
    await esperaBusqueda();
    const campo = contenedor.querySelector<HTMLInputElement>('.chat__searchinput')!;
    const saltos = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
    const global = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    global.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      for (let i = 0; i < 25; i++) campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
      // Hasta el fotograma no se mueve nada: ni la coincidencia ni la ventana.
      expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 40');
      await new Promise((r) => setTimeout(r, 150));
    } finally {
      global.IS_REACT_ACT_ENVIRONMENT = true;
    }
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('25 de 40');
    expect(contenedor.querySelector('.chat__hit--cur')?.textContent).toContain('mensaje 4800 con');
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length - saltos).toBe(1);
  });

  it('con 19 000 coincidencias, una ráfaga de 53 Enter y otra hacia atrás con Mayús+Enter no dan error y dejan la actual pintada', async () => {
    stubFetch(larga(18000, Array.from({ length: 18000 }, (_, i) => i)), () => json({ sent: true }));
    await monta({ searching: true });
    await escribeBusqueda('zorro');
    await esperaBusqueda();
    const campo = contenedor.querySelector<HTMLInputElement>('.chat__searchinput')!;
    expect(await rafagaDeEnter(campo, 53)).toEqual([]);
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toMatch(/^54 de /);
    expect(contenedor.querySelector('.chat__hit--cur')?.textContent).toContain('mensaje 53 con');
    expect(await rafagaDeEnter(campo, 60, { shiftKey: true })).toEqual([]);
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toMatch(/^17\.994 de /);
    expect(contenedor.querySelector('.chat__hit--cur')?.textContent).toContain('mensaje 17993 con');
  }, 60000);

  it('con más coincidencias de las que se resaltan, el contador lo dice', async () => {
    stubFetch(larga(2500, Array.from({ length: 2500 }, (_, i) => i)), () => json({ sent: true }));
    await monta({ searching: true });
    await escribeBusqueda('zorro');
    await esperaBusqueda();
    expect(contenedor.querySelector('.chat__count-hits')?.textContent).toBe('1 de 2.500 · resalte parcial');
  });
});

// ---------------------------------------------------------------------- Indicador de trabajo

describe('ChatBody: indicador de trabajo', () => {
  // Función: la hora se toma al ejecutar cada prueba, no al cargar el archivo.
  const turno = (): AgentEvent[] => [
    { type: 'user', text: 'Haz algo', at: Date.now() - 5000 },
    { type: 'usage', id: 'msg_a', output: 12, at: null },
    { type: 'usage', id: 'msg_a', output: 3400, at: null },
    { type: 'message', text: 'Empiezo.', at: null },
  ];

  it('mientras trabaja enseña el spinner, «Trabajando…», el tiempo y los tokens del turno, encima de la caja', async () => {
    stubFetch(turno(), () => json({ sent: true }));
    await monta({ session: sesion({ state: 'working', updatedAt: Date.now() - 60_000 }) });
    const ind = contenedor.querySelector('.chat__work')!;
    expect(ind).not.toBeNull();
    expect(ind.querySelector('.chat__spinner')).not.toBeNull();
    expect(ind.querySelector('[role="status"]')?.textContent).toBe('Trabajando…');
    // El tiempo cuenta desde el mensaje de la persona (unos 5 s), no desde que la sesión cambió de estado (60 s).
    expect(ind.querySelector('.chat__worknum')?.textContent).toMatch(/^[4-9] s · ↓ 3,4k tokens$/);
    // El reloj y los tokens quedan fuera de la región que lee el lector de pantalla: no se repiten cada segundo.
    expect(ind.querySelector('.chat__worknum')?.getAttribute('aria-hidden')).toBe('true');
    expect(ind.nextElementSibling).toBe(contenedor.querySelector('.chat__foot'));
  });

  it('sin mensaje de la persona ni tokens cuenta desde que empezó a trabajar y no enseña tokens', async () => {
    stubFetch([{ type: 'message', text: 'Hola', at: null }], () => json({ sent: true }));
    await monta({ session: sesion({ state: 'working', updatedAt: Date.now() - 125_000 }) });
    expect(contenedor.querySelector('.chat__worknum')?.textContent).toMatch(/^2 m \d+ s$/);
  });

  it('no aparece si no trabaja ni cuando espera (ya hay un aviso)', async () => {
    stubFetch(turno(), () => json({ sent: true }));
    await monta({ session: sesion({ state: 'idle' }) });
    expect(contenedor.querySelector('.chat__work')).toBeNull();
    await monta({ session: sesion({ state: 'waiting', notice: 'Pide permiso' }) });
    expect(contenedor.querySelector('.chat__work')).toBeNull();
    expect(contenedor.querySelector('.chat__wait')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------- Imágenes en la caja

describe('ChatBody: pegar y soltar imágenes en la caja', () => {
  const RUTA = '/home/u/.config/jdev-ai/uploads/captura.png';
  const png = (name = 'captura.png', size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });
  let subida: Promise<Response>;
  // Cada prueba usa su sesión: los borradores de la caja viven fuera del componente y pasarían de una a otra.
  let n = 0;
  const montaCaja = () => monta({ session: sesion({ name: `jdev-img-${n++}` }) });

  /** Conversación vacía y subidas que responde `subida`. */
  const preparaFetch = (alSubir?: () => Promise<Response>) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        peticiones.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/conversation')) return json({ sessionId: 's1', from: 0, size: 0, reset: false, more: false, events: [] });
        if (url === '/api/uploads') return alSubir ? alSubir() : json({ path: RUTA, name: 'captura.png', size: 10 });
        return json({ sent: true });
      }),
    );
  };

  const pega = async (area: HTMLTextAreaElement, files: File[], texto = '') => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { files, getData: () => texto, types: files.length > 0 ? ['Files'] : ['text/plain'] } });
    await act(async () => {
      area.dispatchEvent(ev);
      await new Promise((r) => setTimeout(r, 20));
    });
    return ev;
  };

  it('pegar una imagen sin texto la sube e inserta su ruta absoluta en el cursor, con un espacio detrás', async () => {
    preparaFetch();
    await montaCaja();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'mira  fin');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      area.setSelectionRange(5, 5);
    });
    const ev = await pega(area, [png()]);
    expect(ev.defaultPrevented).toBe(true);
    expect(peticiones).toContain('POST /api/uploads');
    expect(area.value).toBe(`mira ${RUTA} fin`);
    expect(area.selectionStart).toBe(`mira ${RUTA} `.length);
    expect(contenedor.querySelector('.chat__uploading')).toBeNull();
    expect(contenedor.querySelector('.chat__senderr')).toBeNull();
  });

  it('enseña «Subiendo imagen…» mientras sube', async () => {
    let termina!: (r: Response) => void;
    subida = new Promise<Response>((ok) => (termina = ok));
    preparaFetch(() => subida);
    await montaCaja();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await pega(area, [png()]);
    expect(contenedor.querySelector('.chat__uploading')?.textContent).toBe('Subiendo imagen…');
    await act(async () => {
      termina(json({ path: RUTA, name: 'captura.png', size: 10 }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(contenedor.querySelector('.chat__uploading')).toBeNull();
    expect(area.value).toBe(`${RUTA} `);
  });

  it('con texto en el portapapeles no hace nada especial: el pegado normal sigue', async () => {
    preparaFetch();
    await montaCaja();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    const ev = await pega(area, [png()], 'texto copiado');
    expect(ev.defaultPrevented).toBe(false);
    expect(peticiones).not.toContain('POST /api/uploads');
  });

  it('un archivo que no vale se explica en la zona de error de la caja y no escribe nada', async () => {
    preparaFetch();
    await montaCaja();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await pega(area, [png('vacia.png', 0)]);
    expect(contenedor.querySelector('.chat__senderr')?.textContent).toContain('«vacia.png» está vacío.');
    expect(area.value).toBe('');
  });

  it('si la subida falla lo dice en la zona de error y conserva el texto', async () => {
    preparaFetch(async () => json({ error: 'No hay espacio.' }, 507));
    await montaCaja();
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'hola');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pega(area, [png()]);
    expect(contenedor.querySelector('.chat__senderr')?.textContent).toContain('No hay espacio.');
    expect(area.value).toBe('hola');
  });

  it('soltar una imagen sobre la caja la sube y escribe su ruta; el texto arrastrado no se toca', async () => {
    preparaFetch();
    await montaCaja();
    const caja = contenedor.querySelector('.chat__box')!;
    const area = contenedor.querySelector<HTMLTextAreaElement>('textarea')!;
    const suelta = (tipos: string[], files: File[]) => {
      const ev = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { types: tipos, files } });
      return ev;
    };
    const texto = suelta(['text/plain'], []);
    await act(async () => {
      caja.dispatchEvent(texto);
    });
    expect(texto.defaultPrevented).toBe(false);
    expect(peticiones).not.toContain('POST /api/uploads');
    const imagen = suelta(['Files'], [png()]);
    await act(async () => {
      caja.dispatchEvent(imagen);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(imagen.defaultPrevented).toBe(true);
    expect(area.value).toBe(`${RUTA} `);
  });

  it('la pista menciona que se pueden pegar o soltar imágenes', async () => {
    preparaFetch();
    await montaCaja();
    expect(contenedor.querySelector('.chat__hint')?.textContent).toContain('pega o suelta imágenes');
  });
});

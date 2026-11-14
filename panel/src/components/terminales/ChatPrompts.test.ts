// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerRequest, PromptInfo } from '../../../shared/chat.ts';
import type { AgentEvent, ConversationResponse, QuestionItem } from '../../../shared/follow.ts';
import type { SessionInfo } from '../../types.ts';
import { forgetBtw } from '../../lib/btw.ts';
import { forgetPrompts } from '../../lib/prompts.ts';
import { forgetConversation } from '../../lib/useConversation.ts';
import { ChatBody, RETARDO_BUSQUEDA } from './ChatBody.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOMBRE = 'jdev-demo-1';
const sesion = (over: Partial<SessionInfo> = {}): SessionInfo =>
  ({ name: NOMBRE, agent: 'claude', state: 'waiting', tracked: true, alive: true, done: null, notice: '', chat: { available: true, reason: null }, ...over }) as SessionInfo;

const tamano: QuestionItem = {
  question: '¿Qué hacemos con ella?',
  header: 'Captura IA',
  multiSelect: false,
  options: [
    { label: 'Retirarla del todo', description: 'Cambio que borra las rutas.' },
    { label: 'Reactivar con cuota', description: 'Gemini de pago.' },
    { label: 'Dejarla como está', description: '' },
  ],
};
const limpieza: QuestionItem = {
  question: '¿Qué más retiro?',
  header: 'Limpieza',
  multiSelect: true,
  options: [
    { label: 'Variables de entorno', description: 'GEMINI_API_KEY.' },
    { label: 'Fixtures', description: 'Audio e imagen.' },
    { label: 'Guía de usuario', description: 'captura-ia.md.' },
  ],
};

const pregunta = (questions: QuestionItem[] = [tamano, limpieza]): AgentEvent => ({ type: 'question', id: 'q1', questions, at: null });
const menuAbierto: PromptInfo = { kind: 'question', id: 'q1', questions: [tamano, limpieza], screen: 'menu', tabs: [{ header: 'Captura IA', answered: false }, { header: 'Limpieza', answered: false }], active: 0 };
const permiso: PromptInfo = {
  kind: 'permission',
  tool: 'Bash',
  title: 'Bash command',
  question: 'Do you want to proceed?',
  options: [
    { n: 1, label: 'Yes' },
    { n: 2, label: "Yes, and don't ask again for git rm commands" },
    { n: 3, label: 'No, and tell Claude what to do differently' },
  ],
  toolUseId: 't1',
};

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });

type Escenario = {
  eventos: AgentEvent[];
  prompt: PromptInfo | null;
  /** Qué responde POST /answer. */
  answer: (cuerpo: AnswerRequest) => Response | Promise<Response>;
};

let raiz: Root;
let contenedor: HTMLElement;
let escenario: Escenario;
/** Cuántos eventos del escenario ya se han servido: cada lectura de la conversación devuelve solo los nuevos, como el servidor. */
let servidos = 0;
const peticiones: string[] = [];
const respuestas: AnswerRequest[] = [];

class FalsoIO {
  constructor(private cb: (es: Array<{ target: Element; isIntersecting: boolean }>) => void) {}
  observe(el: Element) {
    queueMicrotask(() => this.cb([{ target: el, isIntersecting: !el.classList.contains('chat__more') }]));
  }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  forgetConversation(NOMBRE);
  forgetBtw(NOMBRE);
  forgetPrompts(NOMBRE);
  peticiones.length = 0;
  respuestas.length = 0;
  servidos = 0;
  escenario = { eventos: [{ type: 'user', text: 'revisa la captura', at: null }, pregunta()], prompt: menuAbierto, answer: () => json({ answered: true }) };
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      peticiones.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/conversation')) {
        const events = escenario.eventos.slice(servidos);
        servidos = escenario.eventos.length;
        const r: ConversationResponse = { sessionId: 's1', from: servidos, size: servidos, reset: false, more: false, events };
        return json(r);
      }
      if (url.endsWith('/prompt')) return json({ prompt: escenario.prompt });
      if (url.endsWith('/answer')) {
        const cuerpo = JSON.parse(String(init?.body)) as AnswerRequest;
        respuestas.push(cuerpo);
        return escenario.answer(cuerpo);
      }
      return json({ sent: true });
    }),
  );
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IntersectionObserver', FalsoIO);
});

afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  vi.unstubAllGlobals();
});

const espera = (ms = 30) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const monta = async (props: Partial<Parameters<typeof ChatBody>[0]> = {}) => {
  await act(async () => {
    raiz.render(createElement(ChatBody, { session: sesion(), active: true, searching: false, onSearching: () => undefined, searchTick: 0, onTerminal: () => undefined, ...props }));
  });
  await espera();
};

const q = <T extends Element = HTMLElement>(sel: string): T => contenedor.querySelector<T>(sel)!;
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...contenedor.querySelectorAll<T>(sel)];
const campos = () => qa<HTMLFieldSetElement>('.chat__qset');
const opcion = (fs: number, i: number) => campos()[fs]!.querySelectorAll<HTMLInputElement>('.chat__qopt:not(.chat__qopt--other) input')[i]!;
const enviar = () => q<HTMLButtonElement>('.chat__qsend');
const clic = (el: HTMLElement) => act(async () => el.click());
const escribe = (el: HTMLInputElement, texto: string) =>
  act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, texto);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('tarjeta de pregunta pendiente', () => {
  it('pinta cada pregunta como fieldset con su cabecera, su texto y sus opciones con radio o casilla reales', async () => {
    await monta();
    expect(contenedor.querySelector('.chat__list .chat__q')).not.toBeNull();
    expect(q('.chat__qtitle').textContent).toBe('Claude te pregunta');
    expect(q('.chat__qhead').textContent).toContain('2 preguntas');
    expect(q('.chat__qprog').textContent).toBe('0 de 2 contestadas');
    const fs = campos();
    expect(fs).toHaveLength(2);
    expect(fs[0]!.querySelector('legend')?.textContent).toContain('Captura IA');
    expect(fs[0]!.querySelector('legend')?.textContent).toContain('¿Qué hacemos con ella?');
    expect(fs[0]!.querySelector('legend')?.textContent).not.toContain('Puedes elegir varias');
    expect(fs[1]!.querySelector('legend')?.textContent).toContain('Puedes elegir varias');
    expect(fs[0]!.querySelectorAll('input[type=radio]')).toHaveLength(4); // 3 opciones + «Otra respuesta»
    expect(fs[1]!.querySelectorAll('input[type=checkbox]')).toHaveLength(4);
    expect(fs[0]!.textContent).toContain('Cambio que borra las rutas.');
    // La descripción vacía no deja un párrafo vacío, y la descripción asocia a su opción.
    expect(fs[0]!.querySelectorAll('.chat__qdesc')).toHaveLength(2);
    expect(opcion(0, 0).getAttribute('aria-describedby')).toBe(fs[0]!.querySelector('.chat__qdesc')!.id);
    expect(opcion(0, 2).hasAttribute('aria-describedby')).toBe(false);
    expect(q('.chat__qtextin').getAttribute('aria-label')).toBe('Otra respuesta a la pregunta Captura IA');
    expect(q('.chat__qnote').textContent).toBe('El panel la contesta en la terminal por ti.');
    expect(contenedor.querySelector('.chat__wait')).toBeNull();
  });

  it('el botón está desactivado hasta contestar todas las preguntas y el progreso avanza', async () => {
    await monta();
    expect(enviar().disabled).toBe(true);
    await clic(opcion(0, 1));
    expect(q('.chat__qprog').textContent).toBe('1 de 2 contestadas');
    expect(opcion(0, 1).closest('label')!.className).toContain('chat__qopt--on');
    expect(enviar().disabled).toBe(true);
    await clic(opcion(1, 2));
    expect(q('.chat__qprog').textContent).toBe('2 de 2 contestadas');
    expect(enviar().disabled).toBe(false);
    // En la múltiple se puede desmarcar: vuelve a faltar una.
    await clic(opcion(1, 2));
    expect(enviar().disabled).toBe(true);
  });

  it('envía el cuerpo esperado (opciones desde 0, una entrada por pregunta) y pasa a «enviada» hasta que llegue el resultado', async () => {
    await monta();
    await clic(opcion(0, 1));
    await clic(opcion(1, 0));
    await clic(opcion(1, 2));
    await clic(enviar());
    await espera();
    expect(respuestas).toEqual([{ kind: 'question', id: 'q1', answers: [{ options: [1] }, { options: [0, 2] }] }]);
    expect(q('.chat__qstate').getAttribute('role')).toBe('status');
    expect(q('.chat__qstate').textContent).toContain('Respuesta enviada');
    expect(enviar().textContent).toBe('Enviada');
    expect(enviar().disabled).toBe(true);
    expect(campos().every((f) => f.hasAttribute('disabled'))).toBe(true);
    expect(contenedor.querySelector('[role=alert]')).toBeNull();
  });

  it('mientras se envía atenúa las opciones, dice «Contestando en la terminal…» y no deja enviar dos veces', async () => {
    let suelta: (r: Response) => void = () => undefined;
    escenario.answer = () => new Promise<Response>((r) => (suelta = r));
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 1));
    await clic(enviar());
    expect(q('.chat__qstate').textContent).toContain('Contestando en la terminal…');
    expect(enviar().textContent).toBe('Enviando…');
    expect(q('.chat__q').className).toContain('chat__q--locked');
    await clic(enviar());
    expect(respuestas).toHaveLength(1);
    await act(async () => suelta(json({ answered: true })));
    await espera();
    expect(q('.chat__qstate').textContent).toContain('Respuesta enviada');
  });

  it('«Otra respuesta»: enfocar el texto la marca (excluyente en las simples) y se envía como texto', async () => {
    escenario.eventos = [pregunta([tamano])];
    escenario.prompt = { ...menuAbierto, tabs: [{ header: 'Captura IA', answered: false }] };
    await monta();
    await clic(opcion(0, 0));
    await escribe(q<HTMLInputElement>('.chat__qtextin'), 'a mi manera');
    expect(opcion(0, 0).checked).toBe(false);
    expect(q<HTMLInputElement>('.chat__qopt--other input[type=radio]').checked).toBe(true);
    expect(q('.chat__qnote--field').textContent).toContain('una sola línea');
    await clic(enviar());
    await espera();
    expect(respuestas[0]).toEqual({ kind: 'question', id: 'q1', answers: [{ options: [], text: 'a mi manera' }] });
  });

  it('en las múltiples el texto libre se suma a las opciones, y vacío no cuenta', async () => {
    escenario.eventos = [pregunta([limpieza])];
    escenario.prompt = { ...menuAbierto, tabs: [{ header: 'Limpieza', answered: false }] };
    await monta();
    await escribe(q<HTMLInputElement>('.chat__qtextin'), '   ');
    expect(enviar().disabled).toBe(true);
    await clic(opcion(0, 1));
    await escribe(q<HTMLInputElement>('.chat__qtextin'), '  los mocks del SDK  ');
    expect(opcion(0, 1).checked).toBe(true);
    await clic(enviar());
    await espera();
    expect(respuestas[0]).toEqual({ kind: 'question', id: 'q1', answers: [{ options: [1], text: 'los mocks del SDK' }] });
  });

  it('la selección sobrevive a pasar a la terminal y volver (el chat se desmonta) y a las actualizaciones en directo', async () => {
    await monta();
    await clic(opcion(0, 2));
    await clic(opcion(1, 1));
    await escribe(qa<HTMLInputElement>('.chat__qtextin')[1]!, 'texto');
    act(() => raiz.render(createElement('div')));
    await monta();
    expect(opcion(0, 2).checked).toBe(true);
    expect(opcion(1, 1).checked).toBe(true);
    expect(qa<HTMLInputElement>('.chat__qtextin')[1]!.value).toBe('texto');
    // Llega un mensaje más: la tarjeta se mantiene con lo elegido.
    escenario.eventos = [...escenario.eventos, { type: 'message', text: 'sigo aquí', at: null }];
    await espera(3200);
    expect(contenedor.textContent).toContain('sigo aquí');
    expect(opcion(0, 2).checked).toBe(true);
  });

  it('si la terminal no muestra su menú: las opciones se ven, el botón no se activa y se explica', async () => {
    escenario.prompt = null;
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 0));
    expect(enviar().disabled).toBe(true);
    expect(q('.chat__qnote').textContent).toBe('Esperando a que la terminal muestre la pregunta…');
    expect(q('.chat__qlink').textContent).toBe('Contestar en la terminal');
  });

  it('si ya se ha empezado a contestar en la terminal, se termina allí', async () => {
    escenario.prompt = { ...menuAbierto, tabs: [{ header: 'Captura IA', answered: true }, { header: 'Limpieza', answered: false }] };
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 0));
    expect(enviar().disabled).toBe(true);
    expect(q('.chat__qnote').textContent).toContain('termínala allí');
  });

  it('«Contestar en la terminal» cambia a la vista terminal', async () => {
    const alTerminal = vi.fn();
    await monta({ onTerminal: alTerminal });
    await clic(q('.chat__qlink'));
    expect(alTerminal).toHaveBeenCalledOnce();
  });

  it('un tui-mismatch deja la tarjeta pendiente con lo elegido, con una alerta con el motivo del servidor y el botón de la terminal', async () => {
    escenario.answer = () => json({ code: 'tui-mismatch', step: 'pregunta', error: 'La terminal no muestra lo que el panel esperaba. No se ha pulsado ninguna tecla.' }, 409);
    const alTerminal = vi.fn();
    await monta({ onTerminal: alTerminal });
    await clic(opcion(0, 1));
    await clic(opcion(1, 0));
    await clic(enviar());
    await espera();
    const alerta = q('[role=alert]');
    expect(alerta.textContent).toContain('No se ha podido contestar desde el chat.');
    expect(alerta.textContent).toContain('No se ha pulsado ninguna tecla.');
    expect(opcion(0, 1).checked).toBe(true);
    expect(campos().some((f) => f.hasAttribute('disabled'))).toBe(false);
    expect(enviar().textContent).toBe('Enviar respuestas');
    await clic(alerta.querySelector('button')!);
    expect(alTerminal).toHaveBeenCalledOnce();
    // Al cambiar algo la alerta se va.
    await clic(opcion(1, 1));
    expect(contenedor.querySelector('[role=alert]')).toBeNull();
  });

  it('un fallo de red también se explica, sin dar la respuesta por enviada', async () => {
    escenario.answer = () => Promise.reject(new TypeError('red'));
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 0));
    await clic(enviar());
    await espera();
    expect(q('[role=alert]').textContent).toContain('No se pudo contactar con el panel.');
    expect(contenedor.querySelector('.chat__qstate')).toBeNull();
  });

  it('not-pending no muestra error: espera a que la conversación la marque como respondida', async () => {
    escenario.answer = () => json({ code: 'not-pending', error: 'La pregunta ya no está pendiente.' }, 409);
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 0));
    await clic(enviar());
    await espera();
    expect(contenedor.querySelector('[role=alert]')).toBeNull();
    escenario.eventos = [...escenario.eventos, { type: 'result', id: 'q1', error: false, summary: 'ok', lines: 1, answers: { '¿Qué hacemos con ella?': 'Retirarla del todo', '¿Qué más retiro?': 'Variables de entorno' } }];
    await espera(1300);
    expect(contenedor.querySelector('.chat__qa')).not.toBeNull();
    expect(contenedor.querySelector('.chat__q')).toBeNull();
  });
});

describe('pregunta que solo conoce el hook (sin línea en la transcripción)', () => {
  const sinLinea = (): AgentEvent[] => [{ type: 'user', text: 'revisa la captura', at: null }];

  it('la tarjeta sale al final, antes de la caja, y se contesta con el id del hook', async () => {
    escenario.eventos = sinLinea();
    await monta();
    expect(contenedor.querySelector('.chat__list .chat__q')).toBeNull();
    expect(contenedor.querySelectorAll('.chat__q')).toHaveLength(1);
    const tarjeta = q('.chat__prompt .chat__q');
    expect(tarjeta.querySelector('.chat__qtitle')?.textContent).toBe('Claude te pregunta');
    expect(q('.chat__prompt').nextElementSibling?.className ?? '').not.toContain('chat__q');
    expect(q('.chat__composer, .chat__input')).not.toBeNull();
    expect(contenedor.querySelector('.chat__wait')).toBeNull();
    await clic(opcion(0, 1));
    await clic(opcion(1, 0));
    await clic(enviar());
    await espera();
    expect(respuestas).toEqual([{ kind: 'question', id: 'q1', answers: [{ options: [1] }, { options: [0] }] }]);
  });

  it('cuando llega la línea pasa a su sitio, sin duplicarse y con la selección en curso', async () => {
    escenario.eventos = sinLinea();
    await monta();
    await clic(opcion(0, 2));
    await clic(opcion(1, 1));
    await escribe(qa<HTMLInputElement>('.chat__qtextin')[1]!, 'mi texto');
    escenario.eventos = [...escenario.eventos, pregunta()];
    await espera(3200);
    expect(contenedor.querySelectorAll('.chat__q')).toHaveLength(1);
    expect(contenedor.querySelector('.chat__prompt .chat__q')).toBeNull();
    expect(contenedor.querySelector('.chat__list .chat__q')).not.toBeNull();
    expect(opcion(0, 2).checked).toBe(true);
    expect(opcion(1, 1).checked).toBe(true);
    expect(qa<HTMLInputElement>('.chat__qtextin')[1]!.value).toBe('mi texto');
  });

  it('con el envío en marcha al cambiar de sitio, la tarjeta sigue «Contestando…» y no deja enviar otra vez', async () => {
    escenario.eventos = sinLinea();
    let suelta: (r: Response) => void = () => undefined;
    escenario.answer = () => new Promise<Response>((r) => (suelta = r));
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 0));
    await clic(enviar());
    expect(q('.chat__qstate').textContent).toContain('Contestando en la terminal…');
    escenario.eventos = [...escenario.eventos, pregunta()];
    await espera(3200);
    expect(contenedor.querySelector('.chat__list .chat__q')).not.toBeNull();
    expect(q('.chat__qstate').textContent).toContain('Contestando en la terminal…');
    expect(enviar().disabled).toBe(true);
    await act(async () => suelta(json({ answered: true })));
    await espera();
    expect(respuestas).toHaveLength(1);
    expect(q('.chat__qstate').textContent).toContain('Respuesta enviada');
  });

  it('con el resultado en la transcripción es una tarjeta respondida y no queda nada al final', async () => {
    escenario.eventos = sinLinea();
    await monta();
    escenario.eventos = [...escenario.eventos, pregunta(), { type: 'result', id: 'q1', error: false, summary: 'ok', lines: 1, answers: { '¿Qué hacemos con ella?': 'Retirarla del todo', '¿Qué más retiro?': 'Fixtures' } }];
    await espera(3200);
    expect(contenedor.querySelectorAll('.chat__qa')).toHaveLength(1);
    expect(contenedor.querySelector('.chat__q')).toBeNull();
    expect(contenedor.querySelector('.chat__wait')).toBeNull();
  });

  it('se anuncia a los lectores de pantalla una vez', async () => {
    escenario.eventos = sinLinea();
    await monta();
    await espera(120);
    expect(qa('.sr-only[role=status]').some((e) => e.textContent === 'Claude te pregunta')).toBe(true);
  });
});

describe('detalles de la tarjeta de pregunta', () => {
  it('«1 pregunta» y «0 de 1 contestada» en singular', async () => {
    escenario.eventos = [pregunta([tamano])];
    escenario.prompt = { ...menuAbierto, tabs: [{ header: 'Captura IA', answered: false }] };
    await monta();
    expect(q('.chat__qhead').textContent).toContain('1 pregunta');
    expect(q('.chat__qhead').textContent).not.toContain('1 preguntas');
    expect(q('.chat__qprog').textContent).toBe('0 de 1 contestada');
    await clic(opcion(0, 0));
    expect(q('.chat__qprog').textContent).toBe('1 de 1 contestada');
  });

  it('«(Recommended)» sale como pastilla «Recomendada» y el texto visible no lo lleva; se envía el índice', async () => {
    const conRec: QuestionItem = { ...tamano, options: [{ label: 'Retirarla del todo (Recommended)', description: 'Borra las rutas.' }, { label: 'Reactivar (Recomendado)', description: '' }, { label: 'Dejarla', description: '' }] };
    escenario.eventos = [pregunta([conRec])];
    escenario.prompt = { ...menuAbierto, questions: [conRec], tabs: [{ header: 'Captura IA', answered: false }] };
    await monta();
    const etiquetas = qa('.chat__qopt:not(.chat__qopt--other) .chat__qlabel');
    expect(etiquetas.map((e) => e.querySelector('.chat__qrec') !== null)).toEqual([true, true, false]);
    expect(etiquetas[0]!.textContent).toBe('Retirarla del todoRecomendada');
    expect(etiquetas[0]!.textContent).not.toContain('Recommended');
    expect(etiquetas[1]!.textContent).not.toContain('Recomendado');
    await clic(opcion(0, 0));
    await clic(enviar());
    await espera();
    expect(respuestas).toEqual([{ kind: 'question', id: 'q1', answers: [{ options: [0] }] }]);
  });

  it('un error de envío lleva la alerta a la vista y le da el foco', async () => {
    escenario.answer = () => json({ code: 'tui-mismatch', step: 'pregunta', error: 'La terminal no muestra lo que el panel esperaba.' }, 409);
    await monta();
    await clic(opcion(0, 1));
    await clic(opcion(1, 0));
    await clic(enviar());
    await espera();
    const alerta = q('[role=alert]');
    expect(document.activeElement).toBe(alerta);
    expect(alerta.getAttribute('tabindex')).toBe('-1');
    const llamadas = (Element.prototype.scrollIntoView as unknown as { mock: { contexts: unknown[] } }).mock.contexts;
    expect(llamadas).toContain(alerta);
  });
});

describe('tarjeta de pregunta respondida', () => {
  const respondida = (): AgentEvent[] => [
    { type: 'user', text: 'revisa', at: null },
    pregunta(),
    { type: 'result', id: 'q1', error: false, summary: 'User has answered', lines: 1, answers: { '¿Qué hacemos con ella?': 'Retirarla del todo', '¿Qué más retiro?': 'Variables de entorno, Guía de usuario, los mocks del SDK' } },
  ];

  it('con la hora de la línea del resultado la enseña en HH:MM local, y sin ella no enseña nada', async () => {
    const at = new Date(2026, 10, 14, 9, 5).getTime();
    escenario.eventos = [...respondida().slice(0, 2), { ...(respondida()[2] as Extract<AgentEvent, { type: 'result' }>), at }];
    await monta({ session: sesion({ state: 'working' }) });
    expect(q('.chat__qahead').textContent).toBe('Respondida· 09:05');
    act(() => raiz.render(createElement('div')));
    forgetConversation(NOMBRE);
    servidos = 0;
    escenario.eventos = respondida();
    await monta({ session: sesion({ state: 'working' }) });
    expect(q('.chat__qahead').textContent).toBe('Respondida');
  });

  it('queda compacta, con lo elegido de cada pregunta, sin controles, y no consulta la terminal', async () => {
    escenario.eventos = respondida();
    escenario.prompt = null;
    await monta({ session: sesion({ state: 'working' }) });
    const tarjeta = q('.chat__qa');
    expect(tarjeta.querySelector('.chat__qadone')?.textContent).toBe('Respondida');
    expect(tarjeta.textContent).toContain('Captura IA');
    expect(tarjeta.textContent).toContain('¿Qué hacemos con ella? → Retirarla del todo');
    expect(tarjeta.textContent).toContain('Variables de entorno, Guía de usuario, «los mocks del SDK» (texto propio)');
    expect(tarjeta.querySelector('input, button')).toBeNull();
    expect(tarjeta.textContent).not.toContain('desde el chat');
    expect(peticiones.some((p) => p.endsWith('/prompt'))).toBe(false);
  });

  it('dice «desde el chat» si la acaba de contestar este chat', async () => {
    await monta();
    await clic(opcion(0, 0));
    await clic(opcion(1, 0));
    await clic(enviar());
    await espera();
    escenario.eventos = respondida();
    await espera(1300);
    expect(q('.chat__qa').textContent).toContain('· desde el chat');
  });

  it('sin respuestas estructuradas enseña el resumen, y un error se dice «Sin respuesta»', async () => {
    escenario.eventos = [pregunta([tamano]), { type: 'result', id: 'q1', error: false, summary: 'Respuesta registrada', lines: 1 }];
    await monta({ session: sesion({ state: 'idle' }) });
    expect(q('.chat__qanote').textContent).toBe('Respuesta registrada');
    expect(q('.chat__qa').textContent).not.toContain('→');
  });

  it('un rechazo se muestra como «Sin respuesta»', async () => {
    escenario.eventos = [pregunta([tamano]), { type: 'result', id: 'q1', error: true, summary: 'El usuario rechazó la pregunta', lines: 1 }];
    await monta({ session: sesion({ state: 'idle' }) });
    expect(q('.chat__qadone').textContent).toBe('Sin respuesta');
    expect(q('.chat__qanote').textContent).toBe('El usuario rechazó la pregunta');
  });

  it('el texto respondido se busca y se resalta', async () => {
    escenario.eventos = respondida();
    await monta({ session: sesion({ state: 'idle' }), searching: true });
    const campo = q<HTMLInputElement>('.chat__searchinput');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, 'MOCKS del sdk');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await espera(RETARDO_BUSQUEDA + 80);
    expect(q('.chat__count-hits').textContent).toBe('1 de 1');
    expect(qa('.chat__qa mark').map((m) => m.textContent)).toEqual(['mocks del SDK']);
    expect(q('.chat__qa').closest('.chat__hit--cur')).not.toBeNull();
  });

  it('la pendiente también se busca (preguntas, opciones y descripciones)', async () => {
    await monta({ searching: true });
    const campo = q<HTMLInputElement>('.chat__searchinput');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, 'gemini_api');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await espera(RETARDO_BUSQUEDA + 80);
    expect(q('.chat__count-hits').textContent).toBe('1 de 1');
    expect(qa('.chat__q mark').map((m) => m.textContent)).toEqual(['GEMINI_API']);
  });

  it('el texto de la transcripción es texto plano, nunca HTML', async () => {
    escenario.eventos = [
      pregunta([{ ...tamano, header: '<b>x</b>', question: '<img src=x onerror=alert(1)>', options: [{ label: '<script>1</script>', description: '<i>d</i>' }] }]),
    ];
    await monta();
    expect(contenedor.querySelector('.chat__q img, .chat__q script, .chat__q b, .chat__q i')).toBeNull();
    expect(q('.chat__qtext').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('tarjeta de permiso', () => {
  const conTool: AgentEvent[] = [{ type: 'tool', id: 't1', tool: 'Bash', verb: 'Ejecuto', target: 'git rm -r src/features/captura-ia', detail: 'borrar', at: null }];

  beforeEach(() => {
    escenario.eventos = conTool;
    escenario.prompt = permiso;
  });

  it('pinta herramienta, lo que quiere hacer (de la conversación) y las opciones tal cual, con la primera resaltada', async () => {
    await monta({ session: sesion({ notice: 'Claude needs your permission to use Bash' }) });
    const t = q('.chat__perm');
    expect(t.querySelector('.chat__qtitle')?.textContent).toBe('Claude pide permiso');
    expect(t.querySelector('.chat__qmeta')?.textContent).toBe('para usar Bash');
    expect(t.querySelector('pre')?.textContent).toBe('git rm -r src/features/captura-ia');
    const botones = qa<HTMLButtonElement>('.chat__permopt');
    expect(botones.map((b) => b.querySelector('.chat__permlabel')!.textContent)).toEqual(permiso.options.map((o) => o.label));
    expect(botones.map((b) => b.querySelector('.chat__permn')!.textContent)).toEqual(['1', '2', '3']);
    expect(botones[0]!.className).toContain('chat__permopt--first');
    expect(botones[1]!.className).not.toContain('chat__permopt--first');
    expect(t.textContent).toContain('Opciones tal como las ofrece la terminal. Al elegir, el panel la pulsa por ti.');
    expect(t.querySelector('.chat__qlink')?.textContent).toBe('Ver en la terminal');
    // No hay aviso de espera: el permiso lo sustituye.
    expect(contenedor.querySelector('.chat__wait')).toBeNull();
  });

  it('con el detalle del hook: frase, directorio, comando entero, explicación y la pregunta de la terminal', async () => {
    escenario.eventos = [];
    escenario.prompt = {
      ...permiso,
      toolUseId: undefined,
      input: { verb: 'Ejecuto', target: 'git rm -r src', text: 'git rm -r src/features/captura-ia\ngit status --short', description: 'Borrar la captura IA y sus tests', where: 'projects/fitnessia' },
    };
    await monta({ session: sesion({ notice: 'Claude needs your permission' }) });
    const t = q('.chat__perm');
    expect(t.querySelector('.chat__qmeta')?.textContent).toBe('para usar Bash');
    expect(t.querySelector('.chat__permlead')?.textContent).toBe('Ejecutar este comando en projects/fitnessia:');
    expect(t.querySelector('.chat__permlead code')?.textContent).toBe('projects/fitnessia');
    expect(t.querySelector('pre')?.textContent).toBe('git rm -r src/features/captura-ia\ngit status --short');
    expect(t.querySelector('.chat__permdetail')?.textContent).toBe('Borrar la captura IA y sus tests');
    expect(t.querySelector('.chat__permask')?.textContent).toBe('Do you want to proceed?');
    // Las opciones y lo que se envía siguen siendo los de la pantalla.
    expect(qa('.chat__permlabel').map((e) => e.textContent)).toEqual(permiso.options.map((o) => o.label));
    await clic(qa('.chat__permopt')[1]!);
    await espera();
    expect(respuestas).toEqual([{ kind: 'permission', option: 2, label: "Yes, and don't ask again for git rm commands" }]);
  });

  it('el detalle del hook manda sobre el paso de la conversación; sin directorio no dice «en»; con otras herramientas, su frase', async () => {
    escenario.eventos = conTool;
    escenario.prompt = { ...permiso, input: { verb: 'Edito', target: 'src/a.ts', text: 'src/a.ts', detail: '(+2 −1)' } };
    await monta();
    expect(q('.chat__permlead').textContent).toBe('Editar este archivo:');
    expect(q('.chat__permpre').textContent).toBe('src/a.ts');
    expect(q('.chat__permdetail').textContent).toBe('(+2 −1)');
  });

  it('el texto del hook es texto plano, nunca HTML', async () => {
    escenario.eventos = [];
    escenario.prompt = { ...permiso, toolUseId: undefined, input: { verb: 'Ejecuto', target: '<img src=x onerror=alert(1)>', text: '<img src=x onerror=alert(1)>', description: '<b>x</b>', where: '<i>d</i>' } };
    await monta();
    expect(contenedor.querySelector('.chat__perm img, .chat__perm b, .chat__perm i')).toBeNull();
    expect(q('.chat__permpre').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('sin la herramienta en la conversación solo enseña el título del diálogo', async () => {
    escenario.eventos = [];
    escenario.prompt = { ...permiso, toolUseId: undefined };
    await monta();
    expect(q('.chat__permlead').textContent).toBe('Bash command');
    expect(contenedor.querySelector('.chat__permpre')).toBeNull();
  });

  it('elegir una opción envía su número y su etiqueta exacta', async () => {
    await monta();
    await clic(qa('.chat__permopt')[1]!);
    await espera();
    expect(respuestas).toEqual([{ kind: 'permission', option: 2, label: "Yes, and don't ask again for git rm commands" }]);
  });

  it('desaparece al contestar, cuando la terminal ya no tiene el diálogo', async () => {
    escenario.answer = () => {
      escenario.prompt = null;
      return json({ answered: true });
    };
    await monta();
    await clic(qa('.chat__permopt')[0]!);
    await espera();
    expect(contenedor.querySelector('.chat__perm')).toBeNull();
  });

  it('mientras envía deshabilita las opciones y, si no coincide la pantalla, explica el motivo y deja volver a elegir', async () => {
    escenario.answer = () => json({ code: 'tui-mismatch', step: 'etiqueta', error: 'La opción 1 ya no es «Yes». No se ha pulsado ninguna tecla.' }, 409);
    const alTerminal = vi.fn();
    await monta({ onTerminal: alTerminal });
    await clic(qa('.chat__permopt')[0]!);
    await espera();
    const alerta = q('[role=alert]');
    expect(alerta.textContent).toContain('La opción 1 ya no es «Yes»');
    expect(qa<HTMLButtonElement>('.chat__permopt').every((b) => !b.disabled)).toBe(true);
    await clic(alerta.querySelector('button')!);
    expect(alTerminal).toHaveBeenCalledOnce();
  });
});

describe('aviso de espera', () => {
  it('con una pregunta o un permiso que el chat contesta no sale el aviso', async () => {
    await monta();
    expect(contenedor.querySelector('.chat__wait')).toBeNull();
  });

  it('sale con otra ventana abierta, con detalle del hook', async () => {
    escenario.prompt = { kind: 'other', hint: '/model' };
    await monta({ session: sesion({ notice: 'Something odd' }) });
    expect(q('.chat__waittext').firstChild?.textContent).toBe('Claude espera tu respuesta en la terminal.');
    expect(contenedor.querySelector('.chat__perm')).toBeNull();
  });

  it('sale si no hay nada abierto en la pantalla', async () => {
    escenario.eventos = [{ type: 'user', text: 'hola', at: null }];
    escenario.prompt = null;
    await monta();
    expect(contenedor.querySelector('.chat__wait')).not.toBeNull();
  });

  it('sale si falla la consulta de lo que hay abierto', async () => {
    escenario.eventos = [{ type: 'user', text: 'hola', at: null }];
    const normal = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.endsWith('/prompt') ? json({ error: 'boom' }, 500) : normal(url, init))));
    await monta();
    expect(contenedor.querySelector('.chat__wait')).not.toBeNull();
  });

  it('no sale mientras aún se lee lo que hay abierto', async () => {
    escenario.eventos = [{ type: 'user', text: 'hola', at: null }];
    const normal = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.endsWith('/prompt') ? new Promise<Response>(() => undefined) : normal(url, init))));
    await monta();
    expect(contenedor.querySelector('.chat__wait')).toBeNull();
  });
});

describe('consulta de lo que hay abierto (GET /prompt)', () => {
  it('solo se consulta mientras la sesión espera, y se repite con un sondeo moderado', async () => {
    await monta({ session: sesion({ state: 'idle' }) });
    await espera(60);
    expect(peticiones.filter((p) => p.endsWith('/prompt'))).toHaveLength(0);
  });

  it('al esperar consulta enseguida y vuelve a consultar cada segundo y medio, y para al salir de waiting', async () => {
    await monta();
    expect(peticiones.filter((p) => p.endsWith('/prompt'))).toHaveLength(1);
    await espera(1700);
    expect(peticiones.filter((p) => p.endsWith('/prompt')).length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      raiz.render(createElement(ChatBody, { session: sesion({ state: 'working' }), active: true, searching: false, onSearching: () => undefined, searchTick: 0, onTerminal: () => undefined }));
    });
    const antes = peticiones.filter((p) => p.endsWith('/prompt')).length;
    await espera(1700);
    expect(peticiones.filter((p) => p.endsWith('/prompt')).length).toBe(antes);
  });
});

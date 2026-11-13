// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../types.ts';
import { forgetConversation } from '../../lib/useConversation.ts';
import { MapPanel, noMapReason } from './MapPanel.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { conversation } = vi.hoisted(() => ({ conversation: vi.fn() }));
vi.mock('../../api.ts', () => ({ ApiError: class ApiError extends Error {}, api: { conversation } }));

let raiz: Root;
let contenedor: HTMLElement;

beforeEach(() => {
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  conversation.mockReset();
  conversation.mockResolvedValue({ sessionId: 's1', from: 0, size: 0, reset: false, more: false, events: [] });
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  forgetConversation('jdev-demo-1');
});

const sesion = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  name: 'jdev-demo-1',
  project: 'demo',
  agent: 'claude',
  worktree: '',
  branch: 'main',
  state: 'working',
  tracked: true,
  title: 'Demo',
  done: null,
  conversationKey: 'k',
  alive: true,
  updatedAt: 0,
  created: 0,
  notice: '',
  usage: { model: 'Opus 5.5', effort: 'high', context: { used: 340, size: 1000, percent: 34 }, worktree: null, updatedAt: 0 },
  activity: { subagents: [{ id: 'a1', type: 'implementer', since: null }, { id: 'a2', type: 'qa', since: null }], shells: [], artifacts: [] },
  archived: false,
  run: null,
  chat: { available: true, reason: null },
  ...over,
});
const monta = (s: SessionInfo, active = true, activityOpen = false, onActivityToggle: (o: boolean) => void = () => undefined) =>
  act(async () => {
    raiz.render(createElement(MapPanel, { session: s, active, activityOpen, onActivityToggle }));
  });

describe('MapPanel: estados sin mapa', () => {
  it('sesión de Codex: una línea que explica que el mapa es solo para sesiones de Claude del panel, sin recuadro grande', async () => {
    const s = sesion({ agent: 'codex', chat: { available: false, reason: 'solo Claude' } });
    await monta(s);
    expect(contenedor.textContent).toBe('Sin mapa: solo está disponible para las sesiones de Claude lanzadas desde el panel.');
    expect(contenedor.querySelector('.context__nomap')).not.toBeNull();
    expect(contenedor.querySelector('.map__none')).toBeNull();
    expect(contenedor.querySelector('.map__svg')).toBeNull();
    expect(conversation).not.toHaveBeenCalled();
  });

  it('terminal sin agente: la misma nota', async () => {
    const s = sesion({ agent: 'shell' });
    await monta(s);
    expect(contenedor.textContent).toBe(noMapReason(s));
    expect(contenedor.textContent).toContain('Sin mapa');
    expect(conversation).not.toHaveBeenCalled();
  });

  it('conversación no disponible: usa el motivo que trae la sesión', async () => {
    await monta(sesion({ chat: { available: false, reason: 'Aún no hay transcripción: espera.' } }));
    expect(contenedor.textContent).toBe('Mapa no disponible: Aún no hay transcripción: espera.');
    expect(contenedor.querySelector('.map__svg')).toBeNull();
    expect(conversation).not.toHaveBeenCalled();
  });

  it('conversación no disponible sin motivo: texto por defecto', () => {
    expect(noMapReason(sesion({ chat: { available: false, reason: null } }))).toBe('Mapa no disponible: la conversación de esta sesión no está disponible.');
  });

  it('una sesión de Claude con conversación tiene mapa (sin motivo)', () => {
    expect(noMapReason(sesion())).toBeNull();
  });
});

describe('MapPanel: sesión de Claude', () => {
  it('lee la conversación y pinta el mapa con el contexto, el modelo y los subagentes de la cabecera', async () => {
    await monta(sesion());
    expect(conversation).toHaveBeenCalledWith('jdev-demo-1', 0, expect.anything());
    expect(contenedor.querySelector('.map__model')!.textContent).toBe('Opus 5.5');
    expect(contenedor.querySelector('.map__pct')!.textContent).toMatch(/^34\s%$/);
    expect(contenedor.querySelectorAll('.map__orbit circle')).toHaveLength(2);
  });

  it('sin datos de uso: anillo vacío, sin porcentaje ni modelo', async () => {
    await monta(sesion({ usage: null, activity: null }));
    expect(contenedor.querySelector('.map__pct')!.textContent).toBe('');
    expect(contenedor.querySelector('.map__model')!.textContent).toBe('');
    expect(contenedor.querySelector('.map__orbit')).toBeNull();
  });

  it('con la pantalla oculta (active false) no lee la conversación', async () => {
    await monta(sesion(), false);
    expect(conversation).not.toHaveBeenCalled();
  });
});

describe('MapPanel: «Actividad reciente»', () => {
  it('empieza cerrado y el mapa se actualiza igualmente con lo que lee de la conversación', async () => {
    conversation.mockResolvedValue({
      sessionId: 's1',
      from: 10,
      size: 10,
      reset: false,
      more: false,
      events: [{ type: 'tool', id: 'a', tool: 'Bash', verb: 'Ejecuto', target: 'pnpm test', at: Date.now() - 5000, station: 'shell' }],
    });
    await monta(sesion(), true, false);
    const boton = contenedor.querySelector<HTMLButtonElement>('.collapsible__btn')!;
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(boton.getAttribute('aria-label')).toBe('Actividad reciente (1)');
    expect(contenedor.querySelector('.map__rows')).toBeNull();
    expect(contenedor.querySelector('.map__nowtext')!.textContent).toBe('Shell · pnpm test');
    expect(contenedor.querySelector('[data-station="shell"]')!.textContent).toContain('en marcha');
  });

  it('abierto muestra las filas y avisa al cerrar', async () => {
    conversation.mockResolvedValue({
      sessionId: 's1',
      from: 10,
      size: 10,
      reset: false,
      more: false,
      events: [{ type: 'tool', id: 'a', tool: 'Bash', verb: 'Ejecuto', target: 'pnpm test', at: Date.now() - 5000, station: 'shell' }],
    });
    const alAlternar = vi.fn();
    await monta(sesion(), true, true, alAlternar);
    expect(contenedor.querySelector('.collapsible__btn')!.getAttribute('aria-expanded')).toBe('true');
    expect(contenedor.querySelectorAll('.map__row')).toHaveLength(1);
    await act(async () => contenedor.querySelector<HTMLButtonElement>('.collapsible__btn')!.click());
    expect(alAlternar).toHaveBeenCalledWith(false);
  });
});

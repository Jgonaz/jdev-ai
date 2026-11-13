// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '../../types.ts';
import { MapPanel } from './MapPanel.tsx';
import { RightViewSwitch } from './RightViewSwitch.tsx';

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
const monta = (s: SessionInfo | null, active = true) =>
  act(async () => {
    raiz.render(createElement(MapPanel, { session: s, active }));
  });

describe('MapPanel: estados sin mapa', () => {
  it('sin terminal activa', async () => {
    await monta(null);
    expect(contenedor.textContent).toContain('Abre una terminal de Claude');
    expect(conversation).not.toHaveBeenCalled();
  });

  it('sesión de Codex: explica que el mapa es solo para sesiones de Claude del panel', async () => {
    await monta(sesion({ agent: 'codex', chat: { available: false, reason: 'solo Claude' } }));
    expect(contenedor.textContent).toContain('El mapa solo está disponible para las sesiones de Claude lanzadas desde el panel.');
    expect(contenedor.textContent).toContain('Esta es una sesión de Codex.');
    expect(contenedor.querySelector('.map__svg')).toBeNull();
    expect(conversation).not.toHaveBeenCalled();
  });

  it('terminal sin agente', async () => {
    await monta(sesion({ agent: 'shell' }));
    expect(contenedor.textContent).toContain('Esta es una terminal sin agente.');
  });

  it('conversación no disponible: usa el motivo que trae la sesión', async () => {
    await monta(sesion({ chat: { available: false, reason: 'Aún no hay transcripción: espera.' } }));
    expect(contenedor.textContent).toContain('Aún no hay transcripción: espera.');
    expect(contenedor.querySelector('.map__svg')).toBeNull();
    expect(conversation).not.toHaveBeenCalled();
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

describe('RightViewSwitch', () => {
  it('dos botones con aria-pressed y el cambio de vista', async () => {
    const onView = vi.fn();
    await act(async () => {
      raiz.render(createElement(RightViewSwitch, { view: 'map', onView }));
    });
    const [contexto, mapa] = [...contenedor.querySelectorAll<HTMLButtonElement>('button')];
    expect([contexto!.textContent, contexto!.getAttribute('aria-pressed')]).toEqual(['Contexto', 'false']);
    expect([mapa!.textContent, mapa!.getAttribute('aria-pressed')]).toEqual(['Mapa', 'true']);
    expect(contenedor.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Vista del panel derecho');
    await act(async () => contexto!.click());
    expect(onView).toHaveBeenCalledWith('context');
  });
});

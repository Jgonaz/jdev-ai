// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetConversation } from '../../lib/useConversation.ts';
import type { ProjectInfo, SessionInfo } from '../../types.ts';
import { ContextPanel } from './ContextPanel.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { conversation, entorno } = vi.hoisted(() => ({
  conversation: vi.fn(),
  entorno: { sessions: [] as unknown[], projects: [] as unknown[], tmuxSocket: 'sock' as string | null, active: null as string | null, dialogOpen: false },
}));
vi.mock('../../api.ts', () => ({ ApiError: class ApiError extends Error {}, api: { conversation } }));
vi.mock('../../state/SessionsContext.tsx', () => ({
  useSessions: () => ({ sessions: entorno.sessions, projects: entorno.projects, tmuxSocket: entorno.tmuxSocket }),
}));
// Las preferencias se comportan como en WorkspaceProvider: estado en memoria que se guarda en localStorage y se lee al montar.
vi.mock('../../state/WorkspaceContext.tsx', async () => {
  const { useState } = await import('react');
  const { loadUiPrefs, saveUiPrefs } = await import('../../lib/workspace.ts');
  return {
    useWorkspace: () => {
      const [prefs, setPrefsState] = useState(() => loadUiPrefs());
      return {
        workspace: { tabs: [], active: entorno.active, layout: 1, start: 0 },
        contextOverlay: false,
        closeContextOverlay: () => undefined,
        dialogOpen: entorno.dialogOpen,
        prefs,
        setPrefs: (parche: Partial<typeof prefs>) => {
          const siguiente = { ...prefs, ...parche };
          saveUiPrefs(siguiente);
          setPrefsState(siguiente);
        },
      };
    },
  };
});

let raiz: Root;
let contenedor: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  // Los desplegables empiezan abiertos; casi todas las pruebas parten de ambos cerrados para abrirlos a mano.
  localStorage.setItem('jdev-panel:ui', '{"mapActivityOpen":false,"mapSessionOpen":false}');
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  conversation.mockReset();
  conversation.mockResolvedValue({ sessionId: 's1', from: 0, size: 0, reset: false, more: false, events: [] });
  entorno.sessions = [];
  entorno.projects = [{ id: 'demo', name: 'Demo', path: '/home/x/demo', color: '#fff' } as ProjectInfo];
  entorno.tmuxSocket = 'sock';
  entorno.active = null;
  entorno.dialogOpen = false;
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
  title: 'Mapa unificado',
  done: null,
  conversationKey: 'k',
  alive: true,
  updatedAt: 0,
  created: 0,
  notice: '',
  usage: null,
  activity: null,
  archived: false,
  run: null,
  chat: { available: true, reason: null },
  ...over,
});
const eventosShell = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ type: 'tool', id: `t${i}`, tool: 'Bash', verb: 'Ejecuto', target: 'pnpm test', at: Date.now() - 5000, station: 'shell' }));

const monta = (s: SessionInfo | null, hidden = false) => {
  entorno.sessions = s ? [s] : [];
  entorno.active = s?.name ?? null;
  return act(async () => {
    raiz.render(createElement(ContextPanel, { hidden }));
  });
};
const q = <T extends Element>(sel: string) => contenedor.querySelector<T>(sel);
const botones = () => [...contenedor.querySelectorAll<HTMLButtonElement>('.collapsible__btn')];
const clic = (b: HTMLElement) => act(async () => b.click());

describe('ContextPanel: sin terminal activa', () => {
  it('solo el aviso, sin mapa ni desplegables ni lectura de la conversación', async () => {
    await monta(null);
    expect(q('aside')!.getAttribute('aria-label')).toBe('Sesión y actividad');
    expect(contenedor.textContent).toBe('Abre una terminal para ver aquí su mapa de actividad y su sesión.');
    expect(q('.collapsible')).toBeNull();
    expect(conversation).not.toHaveBeenCalled();
  });
});

describe('ContextPanel: sesión de Claude con mapa', () => {
  it('orden: cabecera, mapa, línea de ahora, «Actividad reciente» y «Sesión»; sin selector de vistas', async () => {
    await monta(sesion());
    const aside = q('aside')!;
    expect(aside.getAttribute('aria-label')).toBe('Sesión y actividad');
    const orden = ['.context__who', '.map__fit', '.map__now', '.collapsible', '.context__ses'].map((sel) => aside.querySelector(sel)!);
    for (let i = 1; i < orden.length; i++) {
      expect(orden[i - 1]!.compareDocumentPosition(orden[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(q('.context__whoname')!.textContent).toBe('Mapa unificado');
    expect(q('.context__whoagent')!.textContent).toBe('claude');
    expect(botones().map((b) => b.querySelector('.collapsible__title')!.textContent)).toEqual(['Actividad reciente', 'Sesión']);
    expect(contenedor.textContent).not.toContain('Contexto');
    expect(q('.viewsw')).toBeNull();
  });

  it('los dos desplegables empiezan abiertos', async () => {
    localStorage.clear();
    await monta(sesion());
    expect(botones().map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
    expect(q('.sesinfo')).not.toBeNull();
  });

  it('cerrados, no muestran su contenido', async () => {
    await monta(sesion());
    expect(botones().map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    expect(q('.map__rows')).toBeNull();
    expect(q('.sesinfo')).toBeNull();
    // El resumen de «Sesión» va a la vista: proyecto y rama.
    expect(botones()[1]!.querySelector('.collapsible__summary')!.textContent).toBe('Demo · main');
  });

  it('«Sesión» abierta muestra proyecto, rama, worktree, agente, ruta, comando y enlaces', async () => {
    await monta(sesion({ worktree: 'mapa', branch: 'feat/mapa' }));
    await clic(botones()[1]!);
    expect(botones()[1]!.getAttribute('aria-expanded')).toBe('true');
    const dl = q('.sesinfo__dl')!;
    expect([...dl.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Proyecto', 'Rama', 'Worktree', 'Agente', 'Ruta']);
    expect([...dl.querySelectorAll('dd')].map((e) => e.textContent)).toEqual(['Demo', 'feat/mapa', 'mapa', 'claude', '/home/x/demo']);
    expect(q('.sesinfo__cmd')!.textContent).toBe('tmux -L sock attach -t jdev-demo-1');
    expect([...contenedor.querySelectorAll('.sesinfo__actions > *')].map((e) => e.textContent)).toEqual(['Copiar comando', 'Ver backlog', 'Historial del proyecto']);
    expect(q<HTMLAnchorElement>('a[aria-label="Ver backlog de Demo"]')).not.toBeNull();
  });

  it('copiar el comando lo escribe en el portapapeles y avisa', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await monta(sesion());
    await clic(botones()[1]!);
    await clic(q<HTMLButtonElement>('.sesinfo__actions button')!);
    expect(writeText).toHaveBeenCalledWith('tmux -L sock attach -t jdev-demo-1');
    expect(q('.sesinfo__actions button')!.textContent).toBe('Copiado');
  });

  it('sin socket de tmux, el comando carga y no se puede copiar', async () => {
    entorno.tmuxSocket = null;
    await monta(sesion());
    await clic(botones()[1]!);
    expect(q('.sesinfo__cmd')!.textContent).toBe('Cargando…');
    expect(q<HTMLButtonElement>('.sesinfo__actions button')!.disabled).toBe(true);
  });

  it('el estado de cada desplegable se recuerda al recargar el panel, de forma independiente', async () => {
    conversation.mockResolvedValue({ sessionId: 's1', from: 10, size: 10, reset: false, more: false, events: eventosShell(2) });
    const s = sesion();
    await monta(s);
    await clic(botones()[0]!);
    expect(JSON.parse(localStorage.getItem('jdev-panel:ui')!)).toMatchObject({ mapActivityOpen: true, mapSessionOpen: false });
    act(() => raiz.unmount());
    raiz = createRoot(contenedor);
    forgetConversation('jdev-demo-1');
    await monta(s);
    expect(botones().map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
    expect(botones()[0]!.getAttribute('aria-label')).toBe('Actividad reciente (2)');
    expect(q('.map__rows')).not.toBeNull();
    expect(q('.sesinfo')).toBeNull();
    // Cerrarla de nuevo se recuerda también.
    await clic(botones()[0]!);
    expect(JSON.parse(localStorage.getItem('jdev-panel:ui')!)).toMatchObject({ mapActivityOpen: false });
  });

  it('la conversación se sigue leyendo con la actividad plegada, y no con el panel oculto o con un diálogo encima', async () => {
    conversation.mockResolvedValue({ sessionId: 's1', from: 10, size: 10, reset: false, more: false, events: eventosShell(1) });
    await monta(sesion());
    expect(conversation).toHaveBeenCalledWith('jdev-demo-1', 0, expect.anything());
    expect(botones()[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(q('.map__nowtext')!.textContent).toBe('Shell · pnpm test');
    act(() => raiz.unmount());
    raiz = createRoot(contenedor);
    forgetConversation('jdev-demo-1');
    conversation.mockClear();
    await monta(sesion(), true);
    expect(conversation).not.toHaveBeenCalled();
    act(() => raiz.unmount());
    raiz = createRoot(contenedor);
    entorno.dialogOpen = true;
    await monta(sesion());
    expect(conversation).not.toHaveBeenCalled();
  });
});

describe('ContextPanel: sesiones sin mapa', () => {
  it('Codex: nota de una línea con el motivo y «Sesión» a la vista, sin desplegables ni recuadro grande', async () => {
    await monta(sesion({ agent: 'codex', title: 'Revisión del backlog', chat: { available: false, reason: 'solo Claude' } }));
    expect(q('.context__nomap')!.textContent).toBe('Sin mapa: solo está disponible para las sesiones de Claude lanzadas desde el panel.');
    expect(q('.context__whoname')!.textContent).toBe('Revisión del backlog');
    expect(q('.collapsible')).toBeNull();
    expect(q('.map__none')).toBeNull();
    expect(q('.map__svg')).toBeNull();
    expect(q('.sesinfo__dl')).not.toBeNull();
    expect(q('.sesinfo__cmd')!.textContent).toBe('tmux -L sock attach -t jdev-demo-1');
    expect([...contenedor.querySelectorAll('.sesinfo__actions > *')].map((e) => e.textContent)).toEqual(['Copiar comando', 'Ver backlog', 'Historial del proyecto']);
    // La nota va antes que la sesión.
    expect(q('.context__nomap')!.compareDocumentPosition(q('.sesinfo')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(conversation).not.toHaveBeenCalled();
  });

  it('terminal sin agente: la nota y la sesión, con el agente como «Terminal (sin agente)»', async () => {
    await monta(sesion({ agent: 'shell', title: 'zsh' }));
    expect(q('.context__whoagent')!.textContent).toBe('terminal');
    expect(q('.context__nomap')!.textContent).toContain('Sin mapa');
    expect(contenedor.textContent).toContain('Terminal (sin agente)');
    expect(q('.collapsible')).toBeNull();
  });

  it('Claude sin conversación disponible: el motivo de la sesión y la sesión a la vista', async () => {
    await monta(sesion({ chat: { available: false, reason: 'Aún no hay transcripción: espera.' } }));
    expect(q('.context__nomap')!.textContent).toBe('Mapa no disponible: Aún no hay transcripción: espera.');
    expect(q('.collapsible')).toBeNull();
    expect(q('.sesinfo')).not.toBeNull();
  });

  it('no toca el estado recordado de los desplegables', async () => {
    const antes = localStorage.getItem('jdev-panel:ui');
    await monta(sesion({ agent: 'codex', chat: { available: false, reason: null } }));
    expect(localStorage.getItem('jdev-panel:ui')).toBe(antes);
  });
});

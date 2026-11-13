// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../../shared/follow.ts';
import type { Station } from '../../../shared/stations.ts';
import { ActivityMap } from './ActivityMap.tsx';
import type { ActivityMapProps } from './ActivityMap.tsx';
import { formatPercent } from '../../lib/statusline.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let contenedor: HTMLElement;
let raf: ReturnType<typeof vi.spyOn>;
let cancelRaf: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  contenedor = document.createElement('div');
  document.body.append(contenedor);
  raiz = createRoot(contenedor);
  // Sin fotogramas reales: se cuentan las peticiones y no se ejecuta nada.
  raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 7);
  cancelRaf = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => raiz.unmount());
  contenedor.remove();
  vi.restoreAllMocks();
});

const tool = (id: string, station: Station, at: number, target = ''): AgentEvent => ({
  type: 'tool',
  id,
  tool: station === 'shell' ? 'Bash' : 'Read',
  verb: 'Uso',
  target,
  at,
  station,
});
const result = (id: string, at: number, error = false): AgentEvent => ({ type: 'result', id, error, summary: '', lines: 0, at });
const msg = (at: number): AgentEvent => ({ type: 'message', text: '', at });

const LEJOS = Date.now() - 3_600_000;
const HISTORIA: AgentEvent[] = [tool('h1', 'archivos', LEJOS, 'src/App.tsx'), result('h1', LEJOS + 300), msg(LEJOS + 500)];

const props = (over: Partial<ActivityMapProps> = {}): ActivityMapProps => ({
  events: HISTORIA,
  total: HISTORIA.length,
  epoch: 's1',
  synced: true,
  state: 'working',
  percent: 34,
  model: 'Opus 5.5',
  subagents: 0,
  active: true,
  ...over,
});
const pinta = (p: ActivityMapProps) =>
  act(async () => {
    raiz.render(createElement(ActivityMap, p));
  });
const q = <T extends Element>(sel: string) => contenedor.querySelector<T>(sel);
const qa = (sel: string) => [...contenedor.querySelectorAll<HTMLElement>(sel)];

describe('ActivityMap: dibujo', () => {
  it('pinta las nueve estaciones con nombre, el núcleo con el contexto y el modelo, y el SVG es decorativo', async () => {
    await pinta(props());
    expect(qa('.map__st .map__name').map((e) => e.textContent)).toEqual(['Tú', 'Modelo', 'Memoria', 'Archivos', 'Shell', 'Red', 'Navegador', 'Agentes', 'Skills']);
    expect(q('.map__pct')!.textContent).toBe(formatPercent(34));
    expect(q('.map__brand')!.textContent).toBe('CLAUDE');
    expect(q('.map__model')!.textContent).toBe('Opus 5.5');
    expect(q('.map__svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(q('[data-station="archivos"] .map__uses')!.textContent).toBe('1');
  });

  it('sin datos de contexto, el anillo queda vacío y sin porcentaje', async () => {
    await pinta(props({ percent: null, model: '' }));
    expect(q('.map__pct')!.textContent).toBe('');
    expect(q<SVGCircleElement>('.map__ctx')!.getAttribute('stroke-dasharray')).toMatch(/^0 /);
  });

  it('el color del anillo sigue los umbrales de la cabecera, con variables del tema', async () => {
    await pinta(props({ percent: 55 }));
    expect(q<SVGCircleElement>('.map__ctx')!.getAttribute('style')).toContain('var(--waiting)');
    await pinta(props({ percent: 85 }));
    expect(q<SVGCircleElement>('.map__ctx')!.getAttribute('style')).toContain('var(--danger)');
  });

  it('ninguna estación ni el dibujo llevan un color fijo: solo variables del tema', async () => {
    await pinta(props({ events: [...HISTORIA, tool('a', 'shell', Date.now()), tool('b', 'shell', Date.now())], total: 5, subagents: 2 }));
    const estilos = qa('[style]').map((e) => e.getAttribute('style') ?? '');
    expect(estilos.some((s) => /#[0-9a-f]{3,8}\b|rgb\(/i.test(s))).toBe(false);
  });

  it('varias llamadas en marcha: ×N, halo y puntos de subagentes', async () => {
    const ahora = Date.now();
    const ev = [tool('a', 'shell', ahora - 5000), tool('b', 'shell', ahora - 1000)];
    await pinta(props({ events: ev, total: 2, subagents: 2 }));
    expect(q('[data-station="shell"] .map__count')!.textContent).toBe('×2');
    // Halo en Shell y en Agentes: los subagentes activos la mantienen en marcha.
    expect(qa('.map__svg circle[r="31"]')).toHaveLength(2);
    expect(q('[data-station="agentes"] .map__count')!.textContent).toBe('×2');
    expect(qa('.map__orbit circle')).toHaveLength(2);
  });

  it('los errores dejan su contador hasta el siguiente mensaje de la persona', async () => {
    const ahora = Date.now();
    const ev = [tool('a', 'shell', ahora - 5000), result('a', ahora - 4000, true)];
    await pinta(props({ events: ev, total: 2 }));
    expect(q('[data-station="shell"] .map__err')!.textContent).toBe('1');
    await pinta(props({ events: [...ev, { type: 'user', text: '', at: ahora }], total: 3 }));
    expect(q('[data-station="shell"] .map__err')).toBeNull();
  });

  it('interrumpida: las llamadas sin resultado no tienen halo ni ×N y la fila no está en marcha', async () => {
    const ahora = Date.now();
    const ev = [tool('a', 'shell', ahora - 5000, 'pnpm dev'), tool('b', 'shell', ahora - 4000, 'pnpm test')];
    await pinta(props({ events: ev, total: 2, state: 'other' }));
    expect(qa('.map__svg circle[r="31"]')).toHaveLength(0);
    expect(q('.map__count')).toBeNull();
    expect(qa('.map__row').map((r) => r.dataset.status)).toEqual(['interrupted', 'interrupted']);
    expect(q('.map__nowtext')!.textContent).toMatch(/^Interrumpida/);
    // «waiting» (a la espera de la persona) sigue contando como en marcha.
    await pinta(props({ events: ev, total: 2, state: 'waiting' }));
    expect(qa('.map__svg circle[r="31"]')).toHaveLength(1);
  });
});

describe('ActivityMap: lista de actividad', () => {
  it('sin actividad: el texto vacío y «Esperando la primera herramienta» en la línea de ahora', async () => {
    await pinta(props({ events: [], total: 0 }));
    expect(q('.map__empty')!.textContent).toBe('Aún no hay actividad. El mapa se llena en cuanto el agente use una herramienta.');
    expect(q('.map__nowtext')!.textContent).toBe('Esperando la primera herramienta');
    expect(q('.map__rows')).toBeNull();
  });

  it('las filas llevan glifo, estación, herramienta con objetivo (solo nombres) y duración; la línea de ahora es aria-live educada', async () => {
    const ahora = Date.now();
    const ev = [tool('a', 'archivos', ahora - 10_000, 'src/App.tsx'), result('a', ahora - 9700), tool('b', 'shell', ahora - 42_000, 'curl -H "x: secreto" https://a.b/c')];
    await pinta(props({ events: ev, total: 3 }));
    const filas = qa('.map__row');
    expect(filas).toHaveLength(2);
    expect(filas[0]!.querySelector('.map__glyph')!.textContent).toBe('●');
    expect(filas[0]!.querySelector('.map__rwhat')!.textContent).toBe('Bash curl');
    expect(filas[0]!.querySelector('.map__rtime')!.textContent).toBe('42 s');
    expect(filas[1]!.querySelector('.map__rwhat')!.textContent).toBe('Read App.tsx');
    expect(filas[1]!.querySelector('.map__rtime')!.textContent).toBe('0,3 s');
    expect(contenedor.textContent).not.toContain('secreto');
    expect(q('.map__nowtext')!.getAttribute('aria-live')).toBe('polite');
    expect(q('.map__nowtext')!.textContent).toBe('Shell · curl');
  });
});

describe('ActivityMap: animación', () => {
  it('en reposo no pide ni un fotograma ni repinta cada segundo', async () => {
    const intervalo = vi.spyOn(window, 'setInterval');
    await pinta(props());
    expect(raf).not.toHaveBeenCalled();
    expect(intervalo).not.toHaveBeenCalled();
  });

  it('una sesión retomada no lanza pulsos de lo ya terminado ni siquiera al acabar de leerla', async () => {
    await pinta(props({ events: [], total: 0, synced: false }));
    await pinta(props({ synced: false }));
    await pinta(props({ synced: true }));
    expect(raf).not.toHaveBeenCalled();
    expect(q('.map__wave')).toBeNull();
  });

  it('un evento que llega tras la primera sincronización lanza pulsos y pide fotogramas; al desmontar los cancela', async () => {
    await pinta(props());
    const nuevos = [...HISTORIA, tool('a', 'shell', Date.now())];
    await pinta(props({ events: nuevos, total: nuevos.length }));
    expect(raf).toHaveBeenCalled();
    act(() => raiz.unmount());
    expect(cancelRaf).toHaveBeenCalled();
    raiz = createRoot(contenedor);
  });

  it('con la vista oculta (pantalla fuera de vista o diálogo encima) no pide fotogramas', async () => {
    await pinta(props({ active: false }));
    const nuevos = [...HISTORIA, tool('a', 'shell', Date.now())];
    await pinta(props({ events: nuevos, total: nuevos.length, active: false }));
    expect(raf).not.toHaveBeenCalled();
    // Al volver, lo que ocurrió mientras estaba oculta no se reproduce.
    await pinta(props({ events: nuevos, total: nuevos.length, active: true }));
    expect(raf).not.toHaveBeenCalled();
  });

  it('sin foco de la página (document hidden) no pide fotogramas', async () => {
    await pinta(props());
    const oculta = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const nuevos = [...HISTORIA, tool('a', 'shell', Date.now())];
    await pinta(props({ events: nuevos, total: nuevos.length }));
    expect(raf).not.toHaveBeenCalled();
    oculta.mockRestore();
  });

  it('con movimiento reducido no hay pulsos ni onda, pero la estación se enciende', async () => {
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation((consulta: string) => ({ matches: consulta.includes('reduce'), media: consulta, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);
    await pinta(props());
    const nuevos = [...HISTORIA, tool('a', 'archivos', Date.now()), result('a', Date.now()), msg(Date.now())];
    await pinta(props({ events: nuevos, total: nuevos.length }));
    expect(raf).not.toHaveBeenCalled();
    expect(q('.map__wave')).toBeNull();
    expect(q('[data-station="archivos"] .map__disc')!.getAttribute('style')).toContain('var(--agent-claude)');
    mm.mockRestore();
  });

  it('la onda sale una vez cuando el estado pasa a «respuesta lista», no al montar con la respuesta ya lista', async () => {
    const ahora = Date.now();
    const trabajo = [tool('a', 'archivos', ahora - 3000), result('a', ahora - 2000)];
    // Montada con la respuesta ya lista: sin onda.
    await pinta(props({ events: [...trabajo, msg(ahora - 1000)], total: 3 }));
    expect(q('.map__wave')).toBeNull();
    act(() => raiz.unmount());
    raiz = createRoot(contenedor);
    // Trabajando y luego respuesta: una onda.
    await pinta(props({ events: trabajo, total: 2 }));
    expect(q('.map__wave')).toBeNull();
    await pinta(props({ events: [...trabajo, msg(ahora)], total: 3 }));
    expect(qa('.map__wave')).toHaveLength(1);
  });

  it('cambiar de sesión de Claude reinicia lo visto: lo que llega no cuenta como nuevo', async () => {
    await pinta(props());
    const otra = [tool('z', 'shell', Date.now())];
    await pinta(props({ epoch: 's2', events: otra, total: 1 }));
    expect(raf).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/follow.ts';
import type { Station } from '../../shared/stations.ts';
import { formatPercent } from './statusline.ts';
import { ROUTE_FADE_MS, ROUTE_VISIBLE_MS, buildBoard } from './activityMap.ts';
import {
  LIT_MS,
  PULSE_MS,
  arcPath,
  commandName,
  contextRing,
  formatCallDuration,
  hostOf,
  needsTick,
  nowLine,
  planPulses,
  pulsePoint,
  pulseProgress,
  routeFade,
  routeLegs,
  spokeEnds,
  stationPoint,
  stationViews,
  subagentDots,
  targetLabel,
  toolLabel,
  viewRows,
} from './mapView.ts';

const T0 = Date.parse('2026-11-02T10:00:00.000Z');
const s = (seg: number): number => T0 + seg * 1000;

const tool = (id: string, name: string, station: Station, at: number | null, target = ''): AgentEvent => ({ type: 'tool', id, tool: name, verb: 'Uso', target, at, station });
const result = (id: string, at: number | null, error = false): AgentEvent => ({ type: 'result', id, error, summary: '', lines: 0, at });
const NINGUNO: ReadonlySet<Station> = new Set();
const vistas = (events: AgentEvent[], now: number, over: Partial<{ interrupted: boolean; errorPulses: ReadonlySet<Station>; thinking: boolean; subagents: number }> = {}) =>
  stationViews(buildBoard(events, now), { now, interrupted: false, errorPulses: NINGUNO, ...over });
const de = (vs: ReturnType<typeof vistas>, id: Station) => vs.find((v) => v.id === id)!;

describe('geometría', () => {
  it('las etiquetas de la mitad superior van encima del disco, para que su radio no las pise', () => {
    const v = vistas([], T0);
    expect(v.filter((e) => e.labelUp).map((e) => e.id)).toEqual(['tu', 'modelo', 'skills']);
  });

  it('las nueve estaciones van de 40 en 40 grados desde arriba, a 118 px del centro', () => {
    expect(stationPoint('tu')).toMatchObject({ x: 156, y: 66 });
    for (const id of ['tu', 'modelo', 'memoria', 'archivos', 'shell', 'red', 'navegador', 'agentes', 'skills'] as const) {
      const p = stationPoint(id);
      expect(Math.hypot(p.x - 156, p.y - 184)).toBeCloseTo(118, 0);
    }
  });

  it('el radio va del borde del anillo de contexto (44) al borde del disco (20)', () => {
    const e = spokeEnds('tu');
    expect(e).toEqual({ x1: 156, y1: 140, x2: 156, y2: 86 });
    const d = spokeEnds('archivos');
    const p = stationPoint('archivos');
    expect(Math.hypot(d.x1 - 156, d.y1 - 184)).toBeCloseTo(44, 0);
    expect(Math.hypot(d.x2 - p.x, d.y2 - p.y)).toBeCloseTo(20, 0);
  });

  it('un arco parte de las 12 y marca si pasa de media vuelta', () => {
    expect(arcPath(100, 100, 26, 0.25)).toBe('M 100 74 A 26 26 0 0 1 126 100');
    expect(arcPath(100, 100, 26, 0.75)).toContain('0 1 1');
  });

  it('los puntos de subagentes se reparten por igual a 27 px y se limitan a 8', () => {
    const o = stationPoint('agentes');
    const d = subagentDots(2);
    expect(d).toHaveLength(2);
    expect(d[0]).toEqual({ x: Math.round((o.x + 27) * 10) / 10, y: o.y });
    expect(d[1]!.x).toBeCloseTo(o.x - 27, 0);
    expect(subagentDots(0)).toEqual([]);
    expect(subagentDots(30)).toHaveLength(8);
  });
});

describe('estaciones', () => {
  it('el radio engorda con los usos (1 + 3 · usos/30, tope en 30) y sin uso queda fino y apagado', () => {
    const eventos = Array.from({ length: 40 }, (_, i) => [tool(`a${i}`, 'Read', 'archivos', s(i)), result(`a${i}`, s(i) + 0.1)]).flat();
    const v = vistas(eventos, s(1000));
    expect(de(v, 'archivos').spoke.width).toBe(4);
    expect(de(v, 'archivos').uses).toBe(40);
    expect(de(v, 'archivos').spoke.tone).toBe('muted');
    expect(de(v, 'red').spoke).toMatchObject({ width: 1, tone: 'dim', opacity: 0.8 });
    expect(de(v, 'red')).toMatchObject({ ring: 'idle', usesLabel: '' });
  });

  it('los subagentes en segundo plano mantienen Agentes en marcha con ×N y sin manecillas', () => {
    // El Agent en segundo plano devuelve su resultado al instante: la llamada ya no está en marcha.
    const ev = [tool('a1', 'Agent', 'agentes', s(0)), result('a1', s(1)), tool('a2', 'Agent', 'agentes', s(1)), result('a2', s(2))];
    const ag = de(vistas(ev, s(30), { subagents: 2 }), 'agentes');
    expect(ag).toMatchObject({ running: true, count: '×2', halo: { tone: 'accent', inner: null, outer: null } });
    expect(de(vistas(ev, s(30), { subagents: 2, interrupted: true }), 'agentes').running).toBe(false);
    expect(nowLine(buildBoard(ev, s(30)), { interrupted: false, working: true, subagents: 2 })).toMatchObject({ text: 'Agentes · 2 subagentes en marcha' });
  });

  it('mientras el modelo piensa, Modelo se enciende con halo y sin manecillas', () => {
    const v = vistas([], s(5), { thinking: true });
    expect(de(v, 'modelo')).toMatchObject({ ring: 'accent', running: false, halo: { tone: 'accent', inner: null, outer: null } });
    expect(de(v, 'shell').halo).toBeNull();
    expect(de(vistas([], s(5)), 'modelo').halo).toBeNull();
  });

  it('una llamada en marcha enciende la estación con halo y manecillas según lo que lleva', () => {
    const v = vistas([tool('a', 'Bash', 'shell', s(0))], s(42));
    const sh = de(v, 'shell');
    expect(sh).toMatchObject({ running: true, ring: 'accent', count: '' });
    expect(sh.spoke).toMatchObject({ tone: 'accent', opacity: 0.85 });
    // 42 s de 60 en el aro interior; 42 s de 600 en el exterior.
    expect(sh.halo).toMatchObject({ tone: 'accent', inner: arcPath(sh.halo!.x, sh.halo!.y, 26, 0.7), outer: arcPath(sh.halo!.x, sh.halo!.y, 30, 0.07) });
    // Las que no están en marcha no tienen halo.
    expect(de(v, 'archivos').halo).toBeNull();
  });

  it('con varias llamadas en marcha muestra ×N y cuenta lo que lleva la más antigua', () => {
    const v = vistas([tool('a', 'Agent', 'agentes', s(0)), tool('b', 'Agent', 'agentes', s(50))], s(60));
    const ag = de(v, 'agentes');
    expect(ag.count).toBe('×2');
    expect(ag.halo!.inner).toBeNull(); // 60 s = una vuelta entera: la fracción vuelve a 0
    expect(ag.halo!.outer).not.toBeNull();
  });

  it('sin hora conocida no hay manecillas pero sí halo', () => {
    const sh = de(vistas([tool('a', 'Bash', 'shell', null)], s(10)), 'shell');
    expect(sh.running).toBe(true);
    expect(sh.halo).toMatchObject({ inner: null, outer: null });
  });

  it('interrumpida: lo que no devolvió resultado no cuenta como en marcha (sin halo, sin ×N, apagado)', () => {
    const eventos = [tool('a', 'Agent', 'agentes', s(0)), tool('b', 'Agent', 'agentes', s(1))];
    const sh = de(vistas(eventos, s(600), { interrupted: true }), 'agentes');
    expect(sh).toMatchObject({ running: false, count: '', halo: null, ring: 'used', lit: false });
  });

  it('una estación usada hace poco queda encendida (LIT_MS) y luego se apaga', () => {
    const eventos = [tool('a', 'Read', 'archivos', s(0)), result('a', s(1))];
    expect(de(vistas(eventos, s(1) + LIT_MS - 1), 'archivos')).toMatchObject({ lit: true, ring: 'accent', labelTone: 'fg' });
    expect(de(vistas(eventos, s(1) + LIT_MS), 'archivos')).toMatchObject({ lit: false, ring: 'used', labelTone: 'soft' });
  });

  it('los errores tiñen el disco y dejan su contador; un pulso de error tiñe el radio', () => {
    const eventos = [tool('a', 'Bash', 'shell', s(0)), result('a', s(1), true)];
    const sh = de(vistas(eventos, s(100), { errorPulses: new Set<Station>(['shell']) }), 'shell');
    expect(sh).toMatchObject({ errors: 1, ring: 'danger', iconTone: 'dangerText' });
    expect(sh.spoke).toMatchObject({ tone: 'danger', opacity: 0.85 });
  });

  it('Memoria lleva su tinte y sus usos con flecha', () => {
    const m = de(vistas([tool('a', 'Read', 'memoria', s(0)), result('a', s(1))], s(100)), 'memoria');
    expect(m).toMatchObject({ usesLabel: '↓1', usesTone: 'memory' });
    const enMarcha = de(vistas([tool('a', 'Read', 'memoria', s(0))], s(2)), 'memoria');
    expect(enMarcha).toMatchObject({ ring: 'memory', halo: { tone: 'memory' } });
  });
});

describe('ruta', () => {
  const ruta = (...paradas: [Station, number][]) => paradas.map(([station, seg]) => ({ station, at: s(seg) }));

  it('se ve entera hasta ROUTE_VISIBLE_MS y se apaga durante ROUTE_FADE_MS', () => {
    expect(routeFade(s(0), s(0) + ROUTE_VISIBLE_MS)).toBe(1);
    expect(routeFade(s(0), s(0) + ROUTE_VISIBLE_MS + ROUTE_FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(routeFade(s(0), s(0) + ROUTE_VISIBLE_MS + ROUTE_FADE_MS)).toBe(0);
    expect(routeFade(null, s(9999))).toBe(1);
  });

  it('un tramo por cada par de paradas; el último en acento y más grueso, y los anteriores se atenúan', () => {
    const legs = routeLegs(ruta(['tu', 0], ['memoria', 1], ['archivos', 2], ['shell', 3]), s(4));
    expect(legs).toHaveLength(3);
    expect(legs.map((l) => l.tone)).toEqual(['soft', 'soft', 'accent']);
    expect(legs.map((l) => l.width)).toEqual([1.25, 1.25, 1.75]);
    expect(legs.map((l) => l.opacity)).toEqual([0.3, 0.4, 0.9]);
    expect(legs[0]!.d).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  });

  it('el punto de control se desplaza 0,45 hacia el centro', () => {
    const [a, b] = [stationPoint('tu'), stationPoint('shell')];
    const [mx, my] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const l = routeLegs(ruta(['tu', 0], ['shell', 1]), s(2))[0]!;
    const q = /Q ([\d.]+) ([\d.]+)/.exec(l.d)!;
    expect(Number(q[1])).toBeCloseTo(mx + (156 - mx) * 0.45, 1);
    expect(Number(q[2])).toBeCloseTo(my + (184 - my) * 0.45, 1);
  });

  it('con la ruta apagada del todo no queda ningún tramo; sin paradas suficientes, tampoco', () => {
    expect(routeLegs(ruta(['tu', 0], ['shell', 1]), s(1) + ROUTE_VISIBLE_MS + ROUTE_FADE_MS)).toEqual([]);
    expect(routeLegs(ruta(['tu', 0]), s(1))).toEqual([]);
    expect(routeLegs([], s(1))).toEqual([]);
  });
});

describe('anillo de contexto', () => {
  it('colores con los umbrales de la cabecera, redondeando', () => {
    expect(contextRing(34)).toMatchObject({ ring: 'soft', text: 'muted', label: formatPercent(34) });
    expect(contextRing(49.4).ring).toBe('soft');
    expect(contextRing(49.6)).toMatchObject({ ring: 'warn', text: 'warnText', label: formatPercent(50) });
    expect(contextRing(79.4).ring).toBe('warn');
    expect(contextRing(79.6)).toMatchObject({ ring: 'danger', text: 'dangerText', label: formatPercent(80) });
  });

  it('el arco es la fracción de la circunferencia; sin dato, vacío y sin porcentaje', () => {
    const c = Math.round(2 * Math.PI * 44 * 10) / 10;
    expect(contextRing(50).dash).toBe(`${Math.round(Math.PI * 44 * 10) / 10} ${c}`);
    expect(contextRing(null)).toMatchObject({ dash: `0 ${c}`, label: '', ring: 'soft' });
    expect(contextRing(150).dash).toBe(`${c} ${c}`);
  });
});

describe('pulsos', () => {
  it('una herramienta lanza un pulso de ida y su resultado, uno de vuelta (rojo si falla) que espera al de ida del lote', () => {
    const eventos = [tool('a', 'Bash', 'shell', s(0)), result('a', s(1), true)];
    const p = planPulses(eventos, 2, 1000, 7);
    expect(p).toMatchObject([
      { key: 7, station: 'shell', dir: 'out', kind: 'ok', start: 1000 },
      { key: 8, station: 'shell', dir: 'back', kind: 'error', start: 1000 + PULSE_MS },
    ]);
  });

  it('un resultado de una llamada anterior al lote busca su estación hacia atrás y sale enseguida', () => {
    const eventos = [tool('a', 'Read', 'archivos', s(0)), { type: 'message', text: '', at: s(1) } as AgentEvent, result('a', s(2))];
    expect(planPulses(eventos, 1, 500, 0)).toMatchObject([{ station: 'archivos', dir: 'back', kind: 'ok', start: 500 }]);
    // Sin su llamada (historial recortado) no hay a dónde ir.
    expect(planPulses([result('zzz', s(2))], 1, 500, 0)).toEqual([]);
  });

  it('la persona y el modelo lanzan un pulso que llega al núcleo; lo demás, ninguno', () => {
    const eventos: AgentEvent[] = [
      { type: 'user', text: '', at: s(0) },
      { type: 'message', text: '', at: s(1) },
      { type: 'command', name: 'goal', args: '', at: s(2) },
      { type: 'command-output', text: 'x', error: false, at: s(2) },
    ];
    const p = planPulses(eventos, 4, 0, 0);
    expect(p.map((x) => [x.station, x.dir])).toEqual([
      ['tu', 'back'],
      ['modelo', 'back'],
      ['tu', 'back'],
    ]);
    expect(p.map((x) => x.start)).toEqual([0, 180, 360]);
  });

  it('solo mira los eventos nuevos y se queda con los últimos 8', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => tool(`t${i}`, 'Read', 'archivos', s(i)));
    expect(planPulses(muchos, 0, 0, 0)).toEqual([]);
    expect(planPulses(muchos, 1, 0, 0)).toHaveLength(1);
    const p = planPulses(muchos, 12, 0, 100);
    expect(p).toHaveLength(8);
    expect(p[0]!.key).toBe(100);
  });

  it('el progreso va de 0 a 1 durante PULSE_MS y fuera de ese rato no se dibuja', () => {
    const p = planPulses([tool('a', 'Bash', 'shell', s(0))], 1, 1000, 0)[0]!;
    expect(pulseProgress(p, 999)).toBeNull();
    expect(pulseProgress(p, 1000)).toBe(0);
    expect(pulseProgress(p, 1000 + PULSE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(pulseProgress(p, 1000 + PULSE_MS)).toBeNull();
  });

  it('la ida corre del anillo al disco y la vuelta, al revés', () => {
    const e = spokeEnds('shell');
    const ida = planPulses([tool('a', 'Bash', 'shell', s(0))], 1, 0, 0)[0]!;
    expect(pulsePoint(ida, 0)).toEqual({ x: e.x1, y: e.y1 });
    expect(pulsePoint(ida, 1)).toEqual({ x: e.x2, y: e.y2 });
    const vuelta = { ...ida, dir: 'back' as const };
    expect(pulsePoint(vuelta, 0)).toEqual({ x: e.x2, y: e.y2 });
  });
});

describe('duraciones', () => {
  it.each([
    [null, '—'],
    [0, '0,1 s'],
    [100, '0,1 s'],
    [300, '0,3 s'],
    [3100, '3,1 s'],
    [9800, '9,8 s'],
    [10_000, '10 s'],
    [42_900, '42 s'],
    [60_000, '1 min'],
    [180_000, '3 min'],
    [252_000, '4 min 12 s'],
    [600_000, '10 min'],
    [730_000, '12 min'],
    [3_900_000, '1 h 05 min'],
  ])('%s -> %s', (ms, texto) => expect(formatCallDuration(ms)).toBe(texto));
});

describe('etiquetas: solo nombres, nunca contenidos', () => {
  it('archivos: el nombre sin carpetas', () => {
    expect(targetLabel('Edit', 'panel/src/App.tsx')).toBe('App.tsx');
    expect(targetLabel('Read', 'C:\\proyectos\\x\\MEMORY.md')).toBe('MEMORY.md');
    expect(targetLabel('Write', '')).toBe('');
  });

  it('Grep no enseña lo que se busca, solo dónde; Glob enseña su patrón', () => {
    expect(targetLabel('Grep', '«API_KEY=abc123» en panel/src')).toBe('src');
    expect(targetLabel('Grep', '«API_KEY=abc123»')).toBe('');
    expect(targetLabel('Glob', 'panel/src/**/*.tsx en panel')).toBe('panel/src/**/*.tsx');
    expect(targetLabel('Skill', 'artifact-design')).toBe('artifact-design');
  });

  it('comandos: el nombre (y el subcomando de los gestores), nunca los argumentos', () => {
    expect(commandName('gh pr view 12')).toBe('gh');
    expect(commandName('pnpm test --filter x')).toBe('pnpm test');
    expect(commandName('git -C /ruta status')).toBe('git');
    expect(commandName('API_TOKEN=secreto curl -H "Authorization: x" https://a.b')).toBe('curl');
    expect(commandName('cd panel && pnpm typecheck')).toBe('pnpm typecheck');
    expect(commandName('sudo -u root ./bin/check --fast')).toBe('check');
    expect(commandName('echo hola')).toBe('');
    expect(commandName('$(rm -rf x)')).toBe('');
    expect(targetLabel('Bash', 'curl -H "Authorization: Bearer abc" https://api.x.com')).toBe('curl');
  });

  it('red: el host de la URL, sin ruta ni consulta', () => {
    expect(hostOf('https://github.com/a/b?token=abc')).toBe('github.com');
    expect(hostOf('localhost:3000/x')).toBe('localhost');
    expect(targetLabel('WebFetch', 'https://docs.x.dev/a?key=1')).toBe('docs.x.dev');
  });

  it('MCP: la herramienta y su servidor; el resto de herramientas, sin objetivo', () => {
    expect(toolLabel('mcp__playwright__browser_snapshot')).toBe('browser_snapshot');
    expect(toolLabel('Bash')).toBe('Bash');
    expect(targetLabel('mcp__playwright__browser_snapshot', 'playwright · browser_snapshot')).toBe('playwright');
    expect(targetLabel('ToolSearch', 'lo que sea')).toBe('');
  });

  it('se recorta lo largo', () => {
    expect(targetLabel('Read', `a/${'x'.repeat(80)}.ts`).length).toBeLessThanOrEqual(36);
  });
});

describe('filas y línea de ahora', () => {
  const eventos = [tool('a', 'Edit', 'archivos', s(0), 'src/App.tsx'), result('a', s(0.3)), tool('b', 'Bash', 'shell', s(1), 'pnpm test'), result('b', s(2), true), tool('c', 'Bash', 'shell', s(3), 'pnpm dev')];

  it('glifo y tono según el estado: en marcha, hecha o fallida', () => {
    const f = viewRows(buildBoard(eventos, s(45)), false);
    expect(f.map((r) => [r.status, r.glyph, r.station, r.tool, r.target, r.time])).toEqual([
      ['running', '●', 'Shell', 'Bash', 'pnpm dev', '42 s'],
      ['failed', '✕', 'Shell', 'Bash', 'pnpm test', '1,0 s'],
      ['done', '·', 'Archivos', 'Edit', 'App.tsx', '0,3 s'],
    ]);
    expect(f[0]).toMatchObject({ glyphTone: 'accent', timeTone: 'accent' });
    expect(f[1]).toMatchObject({ glyphTone: 'dangerText', toolTone: 'dangerText', statusText: 'Fallida' });
  });

  it('agrupa las hechas consecutivas de una estación con +N', () => {
    const ev = [tool('a', 'Read', 'archivos', s(0), 'a.ts'), result('a', s(1)), tool('b', 'Read', 'archivos', s(2), 'b.ts'), result('b', s(3)), tool('c', 'Read', 'archivos', s(4), 'c.ts'), result('c', s(5))];
    const f = viewRows(buildBoard(ev, s(9)), false);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ target: 'c.ts', fold: '+2' });
  });

  it('interrumpida: la fila sin resultado deja de estar en marcha', () => {
    const f = viewRows(buildBoard(eventos, s(600)), true);
    expect(f[0]).toMatchObject({ status: 'interrupted', glyph: '·', time: 'interrumpida', statusText: 'Interrumpida', timeTone: 'faint' });
  });

  it('la línea de ahora cuenta lo que se ejecuta, lo que lleva y cuántas más hay', () => {
    const ev = [tool('a', 'Bash', 'shell', s(0), 'pnpm test'), tool('b', 'Agent', 'agentes', s(10), 'qa')];
    expect(nowLine(buildBoard(ev, s(12)), { interrupted: false, working: true })).toEqual({ glyph: '●', tone: 'accent', text: 'Agentes · qa · +1 en marcha', time: '2,0 s' });
    expect(nowLine(buildBoard(ev, s(12)), { interrupted: true, working: false })).toMatchObject({ glyph: '·', tone: 'faint', text: 'Interrumpida · Agentes · qa', time: '' });
  });

  it('respuesta lista con lo que tardó el turno; sin actividad, esperando la primera herramienta', () => {
    const ev: AgentEvent[] = [{ type: 'user', text: '', at: s(0) }, { type: 'message', text: '', at: s(252) }];
    expect(nowLine(buildBoard(ev, s(300)), { interrupted: false, working: false })).toEqual({ glyph: '·', tone: 'faint', text: 'Respuesta lista', time: '4 min 12 s' });
    expect(nowLine(buildBoard([], s(1)), { interrupted: false, working: true })).toMatchObject({ text: 'Esperando la primera herramienta' });
  });

  it('tras un mensaje de la persona o un resultado, si trabaja, está pensando; si no, sin actividad', () => {
    const ev: AgentEvent[] = [tool('a', 'Read', 'archivos', s(0)), result('a', s(1))];
    expect(nowLine(buildBoard(ev, s(2)), { interrupted: false, working: true })).toMatchObject({ glyph: '●', text: 'Modelo · pensando la respuesta' });
    expect(nowLine(buildBoard(ev, s(2)), { interrupted: true, working: false })).toMatchObject({ glyph: '·', text: 'Sin actividad' });
  });
});

describe('needsTick', () => {
  it('en reposo (nada en marcha, nada encendido, ruta apagada) no hace falta repintar', () => {
    const ev = [tool('a', 'Read', 'archivos', s(0)), result('a', s(1))];
    const tarde = s(1) + ROUTE_VISIBLE_MS + ROUTE_FADE_MS + 10;
    expect(needsTick(buildBoard(ev, tarde), tarde, false)).toBe(false);
    expect(needsTick(buildBoard([], s(0)), s(0), false)).toBe(false);
  });

  it('hace falta con una llamada en marcha, una estación encendida o la ruta apagándose; una interrumpida no cuenta', () => {
    const marcha = [tool('a', 'Bash', 'shell', s(0))];
    expect(needsTick(buildBoard(marcha, s(500)), s(500), false)).toBe(true);
    const hecha = [tool('a', 'Read', 'archivos', s(0)), result('a', s(1))];
    expect(needsTick(buildBoard(hecha, s(2)), s(2), false)).toBe(true);
    expect(needsTick(buildBoard(hecha, s(1) + ROUTE_VISIBLE_MS - 1), s(1) + ROUTE_VISIBLE_MS - 1, false)).toBe(true);
    const fin = s(1) + ROUTE_VISIBLE_MS + ROUTE_FADE_MS + 10;
    expect(needsTick(buildBoard(marcha, fin), fin, true)).toBe(false);
    expect(needsTick(buildBoard(marcha, fin), fin, false)).toBe(true);
  });
});

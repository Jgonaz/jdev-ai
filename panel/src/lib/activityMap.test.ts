import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/follow.ts';
import type { Station } from '../../shared/stations.ts';
import { BOARD_ROWS, ROUTE_FADE_MS, ROUTE_STOPS, ROUTE_VISIBLE_MS, buildBoard, lightMapEvent } from './activityMap.ts';

const T0 = Date.parse('2026-11-02T10:00:00.000Z');
const s = (seg: number): number => T0 + seg * 1000;

const user = (at: number | null, text = 'haz esto'): AgentEvent => ({ type: 'user', text, at });
const msg = (at: number | null, text = 'listo'): AgentEvent => ({ type: 'message', text, at });
const tool = (id: string, name: string, station: Station | undefined, at: number | null, target = ''): AgentEvent => ({
  type: 'tool',
  id,
  tool: name,
  verb: 'Uso',
  target,
  at,
  ...(station !== undefined ? { station } : {}),
});
const result = (id: string, at: number | null, error = false): AgentEvent => ({ type: 'result', id, error, summary: '', lines: 1, at });

describe('buildBoard: estaciones', () => {
  it('sin eventos, todo a cero y esperando', () => {
    const b = buildBoard([], s(0));
    expect(Object.keys(b.stations)).toEqual(['tu', 'modelo', 'memoria', 'archivos', 'shell', 'red', 'navegador', 'agentes', 'skills']);
    expect(Object.values(b.stations).every((x) => x.uses === 0 && x.errors === 0 && x.running.length === 0 && x.lastAt === null)).toBe(true);
    expect(b.route).toEqual([]);
    expect(b.rows).toEqual([]);
    expect(b.now).toEqual({ kind: 'waiting' });
  });

  it('cuenta los usos: Tú por cada user o command, Modelo por cada mensaje, y las herramientas en su estación', () => {
    const b = buildBoard(
      [
        user(s(0)),
        { type: 'command', name: 'goal', args: 'close', at: s(1) },
        { type: 'command-output', text: 'ok', error: false, at: s(1) },
        msg(s(2)),
        tool('a', 'Read', 'archivos', s(3)),
        result('a', s(4)),
        tool('b', 'Bash', 'shell', s(5)),
        result('b', s(6)),
        tool('c', 'Edit', 'archivos', s(7)),
        result('c', s(8)),
        msg(s(9)),
      ],
      s(10),
    );
    expect(b.stations.tu.uses).toBe(2);
    expect(b.stations.modelo.uses).toBe(2);
    expect(b.stations.archivos.uses).toBe(2);
    expect(b.stations.shell.uses).toBe(1);
    expect(b.stations.red.uses).toBe(0);
  });

  it('la hora del último uso es la del último inicio o fin de llamada de la estación', () => {
    const b = buildBoard([tool('a', 'Bash', 'shell', s(1)), result('a', s(30)), tool('b', 'Read', 'archivos', s(5)), result('b', s(6))], s(40));
    expect(b.stations.shell.lastAt).toBe(s(30));
    expect(b.stations.archivos.lastAt).toBe(s(6));
    expect(b.stations.red.lastAt).toBeNull();
  });

  it('una herramienta sin estación (transcript viejo) se clasifica por su nombre o cae en Shell', () => {
    const b = buildBoard([tool('a', 'WebFetch', undefined, s(1)), tool('b', 'Rara', undefined, s(2)), tool('c', 'Skill', 'invalida' as Station, s(3))], s(4));
    expect(b.stations.red.uses).toBe(1);
    expect(b.stations.shell.uses).toBe(1);
    expect(b.stations.skills.uses).toBe(1);
  });
});

describe('buildBoard: llamadas en marcha', () => {
  it('una llamada sin resultado está en marcha, con cuánto lleva', () => {
    const b = buildBoard([tool('a', 'Bash', 'shell', s(10), 'pnpm test')], s(25));
    expect(b.stations.shell.running).toEqual([{ id: 'a', tool: 'Bash', target: 'pnpm test', since: s(10), elapsedMs: 15_000 }]);
    expect(b.now).toEqual({ kind: 'running', station: 'shell', tool: 'Bash', target: 'pnpm test', elapsedMs: 15_000, others: 0 });
    expect(b.rows[0]).toMatchObject({ id: 'a', status: 'running', durationMs: 15_000, veces: 1 });
  });

  it('las llamadas paralelas se emparejan por id aunque los resultados lleguen en otro orden', () => {
    const ev = [tool('a', 'Agent', 'agentes', s(1), 'uno'), tool('b', 'Agent', 'agentes', s(1), 'dos'), tool('c', 'Read', 'archivos', s(2)), result('b', s(5)), result('c', s(6))];
    const b = buildBoard(ev, s(10));
    expect(b.stations.agentes.running.map((r) => r.id)).toEqual(['a']);
    expect(b.stations.archivos.running).toEqual([]);
    expect(b.now).toMatchObject({ kind: 'running', station: 'agentes', target: 'uno', others: 0 });

    const dos = buildBoard(ev.slice(0, 2), s(10));
    expect(dos.stations.agentes.running).toHaveLength(2);
    // «Ahora» es la más reciente de las dos en marcha.
    expect(dos.now).toMatchObject({ kind: 'running', target: 'dos', others: 1 });
  });

  it('una llamada sin hora está en marcha pero sin duración', () => {
    const b = buildBoard([tool('a', 'Bash', 'shell', null)], s(5));
    expect(b.stations.shell.running[0]).toMatchObject({ since: null, elapsedMs: null });
    expect(b.rows[0]!.durationMs).toBeNull();
  });

  it('una sesión retomada, con todo terminado, no tiene nada en marcha', () => {
    const b = buildBoard([user(s(0)), tool('a', 'Read', 'archivos', s(1)), result('a', s(2)), tool('b', 'Bash', 'shell', s(3)), result('b', s(4), true), msg(s(5))], s(3600));
    expect(Object.values(b.stations).flatMap((x) => x.running)).toEqual([]);
    expect(b.rows.every((r) => r.status !== 'running')).toBe(true);
    expect(b.now).toEqual({ kind: 'ready', turnMs: 5000 });
  });

  it('un resultado repetido o sin su llamada no altera nada', () => {
    const b = buildBoard([result('x', s(1), true), tool('a', 'Read', 'archivos', s(2)), result('a', s(3)), result('a', s(4), true)], s(5));
    expect(Object.values(b.stations).reduce((n, x) => n + x.errors, 0)).toBe(0);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ status: 'done', durationMs: 1000 });
  });

  it('una llamada repetida con el mismo id cuenta una vez', () => {
    const b = buildBoard([tool('a', 'Read', 'archivos', s(1)), tool('a', 'Read', 'archivos', s(1))], s(2));
    expect(b.stations.archivos.uses).toBe(1);
  });
});

describe('buildBoard: errores', () => {
  it('los errores quedan en su estación hasta el siguiente mensaje de la persona', () => {
    const ev = [user(s(0)), tool('a', 'Bash', 'shell', s(1)), result('a', s(2), true), tool('b', 'Bash', 'shell', s(3)), result('b', s(4), true), tool('c', 'Read', 'archivos', s(5)), result('c', s(6))];
    const b = buildBoard(ev, s(7));
    expect(b.stations.shell.errors).toBe(2);
    expect(b.stations.archivos.errors).toBe(0);
    expect(b.rows.map((r) => r.status)).toEqual(['done', 'failed', 'failed']);

    const limpio = buildBoard([...ev, user(s(8), 'sigue')], s(9));
    expect(limpio.stations.shell.errors).toBe(0);
    // Los usos y las filas no se limpian.
    expect(limpio.stations.shell.uses).toBe(2);
    expect(limpio.rows.some((r) => r.status === 'failed')).toBe(true);
  });

  it('un comando o un mensaje del agente no limpian los errores', () => {
    const ev = [tool('a', 'Bash', 'shell', s(1)), result('a', s(2), true), { type: 'command', name: 'goal', args: '', at: s(3) } as AgentEvent, msg(s(4))];
    expect(buildBoard(ev, s(5)).stations.shell.errors).toBe(1);
  });
});

describe('buildBoard: ruta', () => {
  it('une las últimas estaciones sin Modelo ni repeticiones consecutivas, con la hora de la última visita', () => {
    const ev = [
      tool('a', 'Read', 'archivos', s(1)),
      msg(s(2)),
      tool('b', 'Edit', 'archivos', s(3)),
      tool('c', 'Bash', 'shell', s(4)),
      tool('d', 'WebFetch', 'red', s(5)),
      tool('e', 'Bash', 'shell', s(6)),
    ];
    expect(buildBoard(ev, s(7)).route).toEqual([
      { station: 'archivos', at: s(3) },
      { station: 'shell', at: s(4) },
      { station: 'red', at: s(5) },
      { station: 'shell', at: s(6) },
    ]);
  });

  it('conserva solo las 5 últimas paradas, y los mensajes de la persona cuentan como visitas a Tú', () => {
    const estaciones: Station[] = ['archivos', 'shell', 'red', 'skills', 'agentes', 'navegador'];
    const ev = estaciones.map((st, i) => tool(`t${i}`, 'X', st, s(i)));
    const b = buildBoard(ev, s(10));
    expect(b.route.map((p) => p.station)).toEqual(['shell', 'red', 'skills', 'agentes', 'navegador']);
    expect(b.route).toHaveLength(ROUTE_STOPS);
    expect(buildBoard([user(s(0)), tool('a', 'Read', 'archivos', s(1))], s(2)).route.map((p) => p.station)).toEqual(['tu', 'archivos']);
  });

  it('exporta los tiempos del desvanecido', () => {
    expect([ROUTE_VISIBLE_MS, ROUTE_FADE_MS]).toEqual([40_000, 20_000]);
  });
});

describe('buildBoard: filas', () => {
  it('lleva estado, estación, herramienta, objetivo y duración, de la más reciente a la más antigua', () => {
    const ev = [tool('a', 'Read', 'archivos', s(1), 'a.ts'), result('a', s(2)), tool('b', 'Bash', 'shell', s(3), 'pnpm lint'), result('b', s(5), true), tool('c', 'Edit', 'archivos', s(6), 'b.ts')];
    expect(buildBoard(ev, s(10)).rows).toEqual([
      { id: 'c', status: 'running', station: 'archivos', tool: 'Edit', target: 'b.ts', durationMs: 4000, veces: 1 },
      { id: 'b', status: 'failed', station: 'shell', tool: 'Bash', target: 'pnpm lint', durationMs: 2000, veces: 1 },
      { id: 'a', status: 'done', station: 'archivos', tool: 'Read', target: 'a.ts', durationMs: 1000, veces: 1 },
    ]);
  });

  it('agrupa las terminadas y consecutivas de una misma estación, y suma sus duraciones', () => {
    const ev = [
      tool('a', 'Read', 'archivos', s(1), 'a'),
      result('a', s(2)),
      tool('b', 'Grep', 'archivos', s(3), 'b'),
      result('b', s(5)),
      tool('c', 'Edit', 'archivos', s(6), 'c'),
      result('c', s(9)),
      tool('d', 'Bash', 'shell', s(10), 'd'),
      result('d', s(11)),
    ];
    const rows = buildBoard(ev, s(20)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: 'c', station: 'archivos', tool: 'Edit', target: 'c', veces: 3, durationMs: 6000 });
  });

  it('no agrupa las fallidas ni las que están en marcha, y un cambio de estación corta el grupo', () => {
    const ev = [
      tool('a', 'Read', 'archivos', s(1)),
      result('a', s(2)),
      tool('b', 'Read', 'archivos', s(3)),
      result('b', s(4), true),
      tool('c', 'Read', 'archivos', s(5)),
      result('c', s(6)),
      tool('d', 'Bash', 'shell', s(7)),
      result('d', s(8)),
      tool('e', 'Read', 'archivos', s(9)),
      result('e', s(10)),
      tool('f', 'Read', 'archivos', s(11)),
    ];
    expect(buildBoard(ev, s(12)).rows.map((r) => [r.id, r.status, r.veces])).toEqual([
      ['f', 'running', 1],
      ['e', 'done', 1],
      ['d', 'done', 1],
      ['c', 'done', 1],
      ['b', 'failed', 1],
      ['a', 'done', 1],
    ]);
  });

  it('una duración sin horas es null, también al agrupar', () => {
    const rows = buildBoard([tool('a', 'Read', 'archivos', null), result('a', null), tool('b', 'Read', 'archivos', s(1)), result('b', s(3))], s(5)).rows;
    expect(rows).toEqual([{ id: 'b', status: 'done', station: 'archivos', tool: 'Read', target: '', durationMs: 2000, veces: 2 }]);
    const sola = buildBoard([tool('a', 'Read', 'archivos', null), result('a', null)], s(5)).rows;
    expect(sola[0]!.durationMs).toBeNull();
  });

  it('se queda con las 16 últimas', () => {
    const ev: AgentEvent[] = [];
    for (let i = 0; i < 30; i++) {
      ev.push(tool(`t${i}`, 'X', i % 2 === 0 ? 'archivos' : 'shell', s(i * 2)), result(`t${i}`, s(i * 2 + 1)));
    }
    const rows = buildBoard(ev, s(100)).rows;
    expect(rows).toHaveLength(BOARD_ROWS);
    expect(rows[0]!.id).toBe('t29');
    expect(rows[15]!.id).toBe('t14');
  });
});

describe('buildBoard: ahora', () => {
  it('un mensaje del agente da la respuesta por lista, con lo que tardó el turno desde la última petición', () => {
    const b = buildBoard([user(s(0)), msg(s(1)), user(s(10)), tool('a', 'Read', 'archivos', s(11)), result('a', s(12)), msg(s(40))], s(100));
    expect(b.now).toEqual({ kind: 'ready', turnMs: 30_000 });
  });

  it('la respuesta lista sin petición conocida no tiene duración', () => {
    expect(buildBoard([msg(s(1))], s(2)).now).toEqual({ kind: 'ready', turnMs: null });
  });

  it('un comando local tras la respuesta no la quita de «lista»', () => {
    const ev = [user(s(0)), msg(s(4)), { type: 'command-output', text: 'x', error: false, at: s(5) } as AgentEvent];
    expect(buildBoard(ev, s(6)).now).toEqual({ kind: 'ready', turnMs: 4000 });
  });

  it('entre la petición y la respuesta, sin nada en marcha, espera', () => {
    expect(buildBoard([user(s(0))], s(1)).now).toEqual({ kind: 'waiting' });
    expect(buildBoard([user(s(0)), tool('a', 'Read', 'archivos', s(1)), result('a', s(2))], s(3)).now).toEqual({ kind: 'waiting' });
  });

  it('con varias en marcha, la más reciente y cuántas más hay', () => {
    const b = buildBoard([tool('a', 'Bash', 'shell', s(1), 'uno'), tool('b', 'WebFetch', 'red', s(2), 'dos'), tool('c', 'Read', 'archivos', s(3), 'tres')], s(5));
    expect(b.now).toMatchObject({ kind: 'running', target: 'tres', others: 2, elapsedMs: 2000 });
  });
});

describe('lightMapEvent', () => {
  it('quita textos, salidas, resúmenes y detalles, y deja lo que usa el mapa', () => {
    expect(lightMapEvent({ type: 'message', text: 'contenido largo', at: 5 })).toEqual({ type: 'message', text: '', at: 5 });
    expect(lightMapEvent({ type: 'user', text: 'secreto', at: 6, images: 2 })).toEqual({ type: 'user', text: '', at: 6 });
    expect(lightMapEvent({ type: 'command', name: 'goal', args: 'close', at: 7 })).toEqual({ type: 'command', name: 'goal', args: '', at: 7 });
    expect(lightMapEvent({ type: 'result', id: 'a', error: true, summary: 'boom', lines: 3, output: 'salida enorme', at: 8 })).toEqual({
      type: 'result',
      id: 'a',
      error: true,
      summary: '',
      lines: 0,
      at: 8,
    });
    expect(lightMapEvent({ type: 'tool', id: 'a', tool: 'Edit', verb: 'Edito', target: 'a.ts', detail: '+2 −1', at: 1, station: 'archivos' })).toEqual({
      type: 'tool',
      id: 'a',
      tool: 'Edit',
      verb: 'Edito',
      target: 'a.ts',
      at: 1,
      station: 'archivos',
    });
  });

  it('un resultado de un servidor antiguo (sin hora) y una herramienta sin estación se conservan tal cual', () => {
    expect(lightMapEvent({ type: 'result', id: 'a', error: false, summary: 'x', lines: 1 })).toMatchObject({ at: null });
    expect(lightMapEvent({ type: 'tool', id: 'a', tool: 'Bash', verb: 'Ejecuto', target: '', at: null })).not.toHaveProperty('station');
  });

  it('descarta los eventos que el mapa no usa, y buildBoard da lo mismo con los ligeros que con los completos', () => {
    expect(lightMapEvent({ type: 'task', text: 'x' })).toBeNull();
    expect(lightMapEvent({ type: 'command-output', text: 'x', error: false, at: 1 })).toBeNull();
    const completos: AgentEvent[] = [
      user(s(0)),
      msg(s(1)),
      tool('a', 'Read', 'archivos', s(2), 'x.ts'),
      { type: 'result', id: 'a', error: true, summary: 'no', lines: 1, output: 'no', at: s(3) },
      tool('b', 'Bash', 'shell', s(4), 'pnpm test'),
    ];
    const ligeros = completos.flatMap((e) => lightMapEvent(e) ?? []);
    expect(buildBoard(ligeros, s(10))).toEqual(buildBoard(completos, s(10)));
  });
});

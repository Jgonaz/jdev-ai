import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../types.ts';
import {
  HISTORY_COLLAPSED,
  NO_HISTORY_FILTERS,
  dayLabel,
  doneDateLabel,
  entryTime,
  filterEntries,
  groupByDay,
  groupByProject,
  hasFilters,
  listReload,
  loadHistoryFilters,
  loadHistoryView,
  longDate,
  plainText,
  projectOptions,
  rememberHistoryFilters,
  resumePrompt,
  saveHistoryFilters,
  saveHistoryView,
  stateClass,
  stateText,
  visibleInGroup,
} from './history.ts';

const entrada = (parcial: Partial<HistoryEntry> & { file: string }): HistoryEntry => ({
  project: 'demo',
  title: parcial.file,
  date: '2026-10-31 10:00',
  approxDate: false,
  state: 'finalizada',
  firstPending: null,
  openPending: 0,
  totalPending: 0,
  etag: '1-1',
  ...parcial,
});

// Domingo 1 de noviembre de 2026, a mediodía.
const AHORA = new Date(2026, 10, 1, 12, 0);

describe('textos de fecha', () => {
  it('día: Hoy, Ayer, día de la semana y año si no es el actual', () => {
    expect(dayLabel('2026-11-01', AHORA)).toBe('Hoy');
    expect(dayLabel('2026-10-31', AHORA)).toBe('Ayer');
    expect(dayLabel('2026-10-30', AHORA)).toBe('Viernes 30 de octubre');
    expect(dayLabel('2026-10-28', AHORA)).toBe('Miércoles 28 de octubre');
    expect(dayLabel('2025-12-31', AHORA)).toBe('Miércoles 31 de diciembre de 2025');
    // Ayer cruzando el cambio de mes y de año.
    expect(dayLabel('2025-12-31', new Date(2026, 0, 1, 9))).toBe('Ayer');
    expect(dayLabel('rara', AHORA)).toBe('rara');
  });

  it('fecha larga del lector, hora de la lista y fecha de hecho', () => {
    expect(longDate('2026-10-31 00:27')).toBe('31 oct 2026, 00:27');
    expect(longDate('2026-09-18')).toBe('18 sept 2026');
    expect(longDate('basura')).toBe('basura');
    expect(entryTime('2026-10-31 00:27')).toBe('00:27');
    expect(entryTime('2026-10-31')).toBe('');
    expect(doneDateLabel('2026-11-01')).toBe('1 nov 2026');
  });
});

describe('agrupación por día', () => {
  it('agrupa en el orden recibido, con las entradas sin hora en su día', () => {
    const g = groupByDay(
      [
        entrada({ file: 'a.md', date: '2026-11-01 10:10' }),
        entrada({ file: 'b.md', date: '2026-10-31 19:00' }),
        entrada({ file: 'c.md', date: '2026-10-31 00:27' }),
        entrada({ file: 'd.md', date: '2026-10-31' }),
        entrada({ file: 'e.md', date: '2026-10-29 22:00' }),
      ],
      AHORA,
    );
    expect(g.map((x) => [x.label, x.entries.map((e) => e.file)])).toEqual([
      ['Hoy', ['a.md']],
      ['Ayer', ['b.md', 'c.md', 'd.md']],
      ['Jueves 29 de octubre', ['e.md']],
    ]);
    expect(groupByDay([], AHORA)).toEqual([]);
  });
});

describe('filtros', () => {
  const lista = [
    entrada({ file: 'a.md', project: 'jdev-ai', state: 'en curso', openPending: 1 }),
    entrada({ file: 'b.md', project: 'balanz.io', state: 'bloqueada', openPending: 0, totalPending: 2 }),
    entrada({ file: 'c.md', project: 'oculto', state: 'finalizada', openPending: 3 }),
    entrada({ file: 'd.md', project: 'balanz.io', state: 'desconocido' }),
  ];
  const archivos = (l: HistoryEntry[]) => l.map((e) => e.file);

  it('por proyecto, estado, pendientes abiertos y proyectos visibles', () => {
    expect(archivos(filterEntries(lista, NO_HISTORY_FILTERS))).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
    expect(archivos(filterEntries(lista, { ...NO_HISTORY_FILTERS, project: 'balanz.io' }))).toEqual(['b.md', 'd.md']);
    expect(archivos(filterEntries(lista, { ...NO_HISTORY_FILTERS, state: 'bloqueada' }))).toEqual(['b.md']);
    expect(archivos(filterEntries(lista, { ...NO_HISTORY_FILTERS, state: 'desconocido' }))).toEqual(['d.md']);
    // Solo pendientes sin marcar: b tiene dos, pero ya hechos.
    expect(archivos(filterEntries(lista, { ...NO_HISTORY_FILTERS, pending: true }))).toEqual(['a.md', 'c.md']);
    expect(archivos(filterEntries(lista, { ...NO_HISTORY_FILTERS, pending: true }, new Set(['jdev-ai', 'balanz.io'])))).toEqual(['a.md']);
    expect(hasFilters(NO_HISTORY_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_HISTORY_FILTERS, pending: true })).toBe(true);
  });

  it('opciones de proyecto: el harness primero y el resto por nombre sin distinguir mayúsculas', () => {
    const mas = [...lista, entrada({ file: 'e.md', project: 'Zeta' }), entrada({ file: 'f.md', project: 'alfa' }), entrada({ file: 'g.md', project: 'Beta' })];
    expect(projectOptions(mas, 'jdev-ai')).toEqual(['jdev-ai', 'alfa', 'balanz.io', 'Beta', 'oculto', 'Zeta']);
    expect(projectOptions(mas, 'otro')).toEqual(['alfa', 'balanz.io', 'Beta', 'jdev-ai', 'oculto', 'Zeta']);
    expect(projectOptions(mas)).toEqual(['alfa', 'balanz.io', 'Beta', 'jdev-ai', 'oculto', 'Zeta']);
  });

  it('recuerda los filtros y tolera almacenamiento roto o valores raros', () => {
    const datos = new Map<string, string>();
    const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
    const f = { project: 'balanz.io', state: 'en curso' as const, pending: true };
    saveHistoryFilters(f, almacen);
    expect(loadHistoryFilters(almacen)).toEqual(f);
    datos.set('jdev-panel:historial:filtros', '{"project":3,"state":"rara","pending":"sí"}');
    expect(loadHistoryFilters(almacen)).toEqual(NO_HISTORY_FILTERS);
    datos.set('jdev-panel:historial:filtros', 'no-json');
    expect(loadHistoryFilters(almacen)).toEqual(NO_HISTORY_FILTERS);
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadHistoryFilters(roto)).toEqual(NO_HISTORY_FILTERS);
    expect(() => saveHistoryFilters(f, roto)).not.toThrow();
    expect(loadHistoryFilters(null)).toEqual(NO_HISTORY_FILTERS);
  });

  it('al abrir Historial desde otra pantalla quita los filtros y conserva la vista', () => {
    const datos = new Map<string, string>();
    const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
    saveHistoryFilters({ project: 'balanz.io', state: 'bloqueada', pending: true }, almacen);
    saveHistoryView('project', almacen);
    rememberHistoryFilters({}, almacen);
    expect(loadHistoryFilters(almacen)).toEqual(NO_HISTORY_FILTERS);
    expect(loadHistoryView(almacen)).toBe('project');
    rememberHistoryFilters({ project: 'jdev-ai' }, almacen);
    expect(loadHistoryFilters(almacen)).toEqual({ ...NO_HISTORY_FILTERS, project: 'jdev-ai' });
    rememberHistoryFilters({ pending: true }, almacen);
    expect(loadHistoryFilters(almacen)).toEqual({ ...NO_HISTORY_FILTERS, pending: true });
  });
});

describe('textos de la pantalla', () => {
  it('prompt de Retomar y estados', () => {
    expect(resumePrompt('2026-10-31-0027-teclado.md')).toBe(
      'Ponte al día con la entrada del historial `.agent/history/2026-10-31-0027-teclado.md` y sigue su continuación recomendada.',
    );
    expect(stateClass('en curso')).toBe('curso');
    expect(stateText('desconocido')).toBe('sin estado');
    expect(stateText('bloqueada')).toBe('bloqueada');
    expect(plainText('Revisar `backlog/` y `todo/`.')).toBe('Revisar backlog/ y todo/.');
  });

  it('texto plano: enlaces, imágenes, HTML, énfasis y entidades', () => {
    expect(plainText('Lee [la guía](docs/guia.md) y ![logo](a.png).')).toBe('Lee la guía y logo.');
    expect(plainText('Panel <b>gráfico</b> con <br/> salto')).toBe('Panel gráfico con salto');
    expect(plainText('**Muy** importante, *ojo* y ~~no~~')).toBe('Muy importante, ojo y no');
    expect(plainText('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
    // El código se queda tal cual, aunque parezca HTML o un enlace.
    expect(plainText('Cambiar `<div>` y `[a](b)`')).toBe('Cambiar <div> y [a](b)');
    // Los identificadores con guiones bajos o asteriscos sueltos no se tocan.
    expect(plainText('snake_case_var y 2 * 3 * 4')).toBe('snake_case_var y 2 * 3 * 4');
    expect(plainText('a < b y c > d')).toBe('a < b y c > d');
  });
});

describe('recarga del lector por el etag de la lista', () => {
  it('recarga una sola vez por etag nuevo y nunca en bucle', () => {
    // La lista trae otro etag: recarga y lo da por tratado.
    let r = listReload({ listEtag: 'e2', handled: 'e1', detailEtag: 'e1', busy: false });
    expect(r).toEqual({ reload: true, handled: 'e2' });
    // La recarga trae otro etag distinto (la lista va por detrás): no repite.
    expect(listReload({ listEtag: 'e2', handled: r.handled, detailEtag: 'e3', busy: false })).toEqual({ reload: false, handled: 'e2' });
    // Mismo etag que el detalle: se trata sin recargar.
    r = listReload({ listEtag: 'e3', handled: 'e2', detailEtag: 'e3', busy: false });
    expect(r).toEqual({ reload: false, handled: 'e3' });
  });

  it('espera sin detalle, sin lista o mientras se marca', () => {
    expect(listReload({ listEtag: undefined, handled: 'e1', detailEtag: 'e1', busy: false })).toEqual({ reload: false, handled: 'e1' });
    expect(listReload({ listEtag: 'e2', handled: undefined, detailEtag: undefined, busy: false })).toEqual({ reload: false, handled: undefined });
    expect(listReload({ listEtag: 'e2', handled: 'e1', detailEtag: 'e1', busy: true })).toEqual({ reload: false, handled: 'e1' });
    // Al terminar de marcar, el detalle ya trae el etag nuevo: no recarga.
    expect(listReload({ listEtag: 'e2', handled: 'e1', detailEtag: 'e2', busy: false })).toEqual({ reload: false, handled: 'e2' });
  });

  it('simulación: cada setDetalle vuelve a evaluar y solo hay una petición', () => {
    // El servidor siempre devuelve un etag distinto del de la lista (el caso que hacía bucle).
    let handled: string | undefined;
    let detalle: string | undefined = 'e1';
    let peticiones = 0;
    for (let render = 0; render < 20; render++) {
      const r = listReload({ listEtag: 'lista', handled, detailEtag: detalle, busy: false });
      handled = r.handled;
      if (r.reload) {
        peticiones++;
        detalle = `servidor-${render}`;
      }
    }
    expect(peticiones).toBe(1);
  });
});

describe('vista por proyecto', () => {
  const lista = [
    entrada({ project: 'fitnessia', file: 'f3.md', date: '2026-11-01 12:00' }),
    entrada({ project: 'balanz.io', file: 'b2.md', date: '2026-11-01 10:00' }),
    entrada({ project: 'fitnessia', file: 'f2.md', date: '2026-10-31 09:00' }),
    entrada({ project: 'fitnessia', file: 'f1.md', date: '2026-10-30 09:00' }),
    entrada({ project: 'balanz.io', file: 'b1.md', date: '2026-10-29 09:00' }),
    entrada({ project: 'fitnessia', file: 'f0.md', date: '2026-10-28 09:00' }),
  ];

  it('agrupa por proyecto, ordena los grupos por su entrada más reciente y conserva el orden interno', () => {
    const g = groupByProject(lista);
    expect(g.map((x) => x.project)).toEqual(['fitnessia', 'balanz.io']);
    expect(g[0]?.entries.map((e) => e.file)).toEqual(['f3.md', 'f2.md', 'f1.md', 'f0.md']);
    expect(groupByProject([])).toEqual([]);
  });

  it('pliega a las tres más recientes salvo que esté desplegado o la seleccionada quede oculta', () => {
    const fit = groupByProject(lista)[0]!.entries;
    expect(HISTORY_COLLAPSED).toBe(3);
    expect(visibleInGroup(fit, false, null)).toMatchObject({ hidden: 1 });
    expect(visibleInGroup(fit, false, null).shown.map((e) => e.file)).toEqual(['f3.md', 'f2.md', 'f1.md']);
    expect(visibleInGroup(fit, true, null)).toMatchObject({ hidden: 0 });
    expect(visibleInGroup(fit, false, 'fitnessia/f0.md')).toMatchObject({ hidden: 0 });
    expect(visibleInGroup(fit, false, 'balanz.io/b1.md')).toMatchObject({ hidden: 1 });
  });

  it('recuerda la vista y vuelve a «por fecha» ante valores ilegibles', () => {
    const datos = new Map<string, string>();
    const almacen = { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v) };
    expect(loadHistoryView(almacen)).toBe('date');
    saveHistoryView('project', almacen);
    expect(loadHistoryView(almacen)).toBe('project');
    datos.set('jdev-panel:historial:vista', 'otra');
    expect(loadHistoryView(almacen)).toBe('date');
    expect(loadHistoryView({ getItem: () => { throw new Error('bloqueado'); } })).toBe('date');
    expect(loadHistoryView(null)).toBe('date');
  });
});

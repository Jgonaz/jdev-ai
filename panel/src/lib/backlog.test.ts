import { describe, expect, it } from 'vitest';
import type { BacklogItem } from '../types.ts';
import {
  aheadBehind,
  allowedTargets,
  detailWithoutSummary,
  emptyColumnText,
  filterItems,
  filterOptions,
  formatReadTime,
  groupByState,
  headerText,
  loadLastProject,
  NO_FILTERS,
  openCount,
  pendingLabel,
  pickWorktreesProject,
  rememberDecision,
  pickProject,
  priorityBars,
  resolveLocalPath,
  saveLastProject,
  shortDate,
  visibleWarnings,
  workPrompt,
} from './backlog.ts';

const item = (parcial: Partial<BacklogItem> & { id: string }): BacklogItem => ({
  file: `${parcial.id}.md`,
  status: 'backlog',
  title: parcial.id,
  type: null,
  priority: null,
  created: null,
  updated: null,
  summary: null,
  readSeconds: 0,
  warnings: [],
  etag: '1-1',
  ...parcial,
});

const ITEMS: BacklogItem[] = [
  item({ id: 'BL-1', title: 'Migrar a TypeScript 7', type: 'todo', priority: 'baja', created: '2026-10-24', summary: 'Esperar a vue-tsc.' }),
  item({ id: 'BL-2', title: 'Landing en inglés', type: 'feature', priority: 'media', status: 'todo', created: '2026-10-24' }),
  item({ id: 'BL-3', title: 'Analíticas de la landing', type: 'feature', priority: 'alta', created: '2026-10-20' }),
  item({ id: 'BL-4', title: 'Páginas legales', type: 'feature', status: 'done', updated: '2026-10-25' }),
  item({ id: 'BL-5', title: 'Scripts de Prettier', type: 'fix', status: 'done', updated: '2026-10-28' }),
  item({ id: 'BL-6', title: 'Idea descartada', status: 'discarded' }),
];

describe('groupByState', () => {
  it('agrupa por carpeta y ordena los abiertos por prioridad y los cerrados por actualización', () => {
    const g = groupByState(ITEMS);
    expect(g.backlog.map((i) => i.id)).toEqual(['BL-3', 'BL-1']);
    expect(g.todo.map((i) => i.id)).toEqual(['BL-2']);
    expect(g['in-progress']).toEqual([]);
    expect(g.done.map((i) => i.id)).toEqual(['BL-5', 'BL-4']);
    expect(g.discarded.map((i) => i.id)).toEqual(['BL-6']);
  });

  it('en hecho y descartado ordena por updated desc y, a igualdad, por id desc', () => {
    const g = groupByState([
      item({ id: 'BL-20261020-0900-a', status: 'done', updated: '2026-10-28' }),
      item({ id: 'BL-20261021-0900-b', status: 'done', updated: '2026-10-28' }),
      item({ id: 'BL-20261019-0900-c', status: 'done', updated: '2026-10-30' }),
      item({ id: 'BL-20261022-0900-d', status: 'done', created: '2026-10-22' }),
      item({ id: 'BL-20261023-0900-e', status: 'discarded' }),
      item({ id: 'BL-20261024-0900-f', status: 'discarded' }),
    ]);
    // Sin updated se usa created; sin ninguno de los dos, va al final.
    expect(g.done.map((i) => i.id)).toEqual(['BL-20261019-0900-c', 'BL-20261021-0900-b', 'BL-20261020-0900-a', 'BL-20261022-0900-d']);
    expect(g.discarded.map((i) => i.id)).toEqual(['BL-20261024-0900-f', 'BL-20261023-0900-e']);
  });

  it('distingue la columna vacía por los filtros de la vacía de verdad', () => {
    expect(emptyColumnText(true, 3)).toBe('Sin coincidencias con los filtros.');
    expect(emptyColumnText(true, 0)).toBe('Nada por aquí.');
    expect(emptyColumnText(false, 3)).toBe('Nada por aquí.');
  });

  it('cuenta como abiertos backlog, por hacer y en curso', () => {
    expect(openCount(ITEMS)).toBe(3);
    expect(openCount([])).toBe(0);
  });
});

describe('filterItems', () => {
  it('sin filtros devuelve todo', () => {
    expect(filterItems(ITEMS, NO_FILTERS)).toHaveLength(ITEMS.length);
  });

  it('filtra por tipo y prioridad', () => {
    expect(filterItems(ITEMS, { ...NO_FILTERS, type: 'feature' }).map((i) => i.id)).toEqual(['BL-2', 'BL-3', 'BL-4']);
    expect(filterItems(ITEMS, { ...NO_FILTERS, type: 'feature', priority: 'alta' }).map((i) => i.id)).toEqual(['BL-3']);
  });

  it('busca en título, identificador y resumen, sin acentos ni mayúsculas y con todas las palabras', () => {
    expect(filterItems(ITEMS, { ...NO_FILTERS, text: 'analiticas' }).map((i) => i.id)).toEqual(['BL-3']);
    expect(filterItems(ITEMS, { ...NO_FILTERS, text: 'bl-5' }).map((i) => i.id)).toEqual(['BL-5']);
    expect(filterItems(ITEMS, { ...NO_FILTERS, text: 'VUE-TSC' }).map((i) => i.id)).toEqual(['BL-1']);
    expect(filterItems(ITEMS, { ...NO_FILTERS, text: 'landing inglés' }).map((i) => i.id)).toEqual(['BL-2']);
    expect(filterItems(ITEMS, { ...NO_FILTERS, text: '   ' })).toHaveLength(ITEMS.length);
  });

  it('ofrece los tipos y prioridades presentes, con la prioridad de alta a baja', () => {
    expect(filterOptions(ITEMS)).toEqual({ types: ['feature', 'fix', 'todo'], priorities: ['alta', 'media', 'baja'] });
  });
});

describe('allowedTargets', () => {
  it('refleja las transiciones del servidor', () => {
    expect(allowedTargets('backlog')).toEqual(['todo', 'in-progress', 'done', 'discarded']);
    expect(allowedTargets('todo')).toEqual(['in-progress', 'done', 'discarded', 'backlog']);
    expect(allowedTargets('in-progress')).toEqual(['done', 'discarded', 'todo', 'backlog']);
    expect(allowedTargets('done')).toEqual(['backlog', 'todo', 'in-progress']);
    expect(allowedTargets('discarded')).toEqual(['backlog', 'todo', 'in-progress']);
  });

  it('nunca propone el estado actual ni done ↔ discarded', () => {
    expect(allowedTargets('done')).not.toContain('discarded');
    expect(allowedTargets('discarded')).not.toContain('done');
    for (const s of ['backlog', 'todo', 'in-progress', 'done', 'discarded'] as const) expect(allowedTargets(s)).not.toContain(s);
  });
});

describe('formatos', () => {
  it('pinta las barras de prioridad del diseño', () => {
    expect(priorityBars('baja')).toBe('▂▁▁');
    expect(priorityBars('media')).toBe('▂▄▁');
    expect(priorityBars('Alta')).toBe('▂▄▆');
    expect(priorityBars('urgente')).toBeNull();
    expect(priorityBars(null)).toBeNull();
  });

  it('formatea el tiempo de lectura', () => {
    expect(formatReadTime(0)).toBe('');
    expect(formatReadTime(40)).toBe('≈ 40 s de lectura');
    expect(formatReadTime(60)).toBe('≈ 1 min de lectura');
    expect(formatReadTime(90)).toBe('≈ 1 min 30 s de lectura');
  });

  it('da la fecha corta, con año si no es el actual', () => {
    const hoy = new Date(2026, 10, 1);
    expect(shortDate('2026-10-24', hoy)).toBe('24 oct');
    expect(shortDate('2026-09-03', hoy)).toBe('3 sept');
    expect(shortDate('2025-01-05', hoy)).toBe('5 ene 2025');
    expect(shortDate('ayer', hoy)).toBe('ayer');
    expect(shortDate(null, hoy)).toBe('');
  });

  it('cuenta los cambios sin commit y el adelanto respecto a la base', () => {
    expect(pendingLabel(0)).toBe('');
    expect(pendingLabel(1)).toBe('1 cambio del backlog sin commit');
    expect(pendingLabel(3)).toBe('3 cambios del backlog sin commit');
    expect(aheadBehind(2, 0)).toBe('+2 / −0');
    expect(aheadBehind(null, 1)).toBeNull();
  });

  it('compone el prompt de «Trabajar en esto»', () => {
    expect(workPrompt({ id: 'BL-1', title: 'Migrar' }, 'docs/backlog/backlog/BL-1.md')).toBe(
      'Aborda el elemento del backlog BL-1 (docs/backlog/backlog/BL-1.md): Migrar',
    );
  });

  it('no repite el aviso de formato antiguo si ya avisa de YAML inválido', () => {
    expect(visibleWarnings(['legacy', 'invalid-yaml'])).toEqual(['invalid-yaml']);
    expect(visibleWarnings(['legacy'])).toEqual(['legacy']);
  });
});

describe('Markdown del detalle', () => {
  const fuente = '---\nid: BL-1\nstatus: backlog\n---\n\n# Título\n\n## Resumen\n\nEl resumen.\nSigue.\n\n## Contexto\n\nTexto.\n';

  it('extrae el texto de la cabecera', () => {
    expect(headerText(fuente)).toBe('id: BL-1\nstatus: backlog');
    expect(headerText('# Sin cabecera')).toBeNull();
    expect(headerText('---\nid: x\n')).toBeNull();
  });

  it('quita el resumen del detalle y conserva el resto', () => {
    expect(detailWithoutSummary('## Resumen\n\nEl resumen.\nSigue.\n\n## Contexto\n\nTexto.')).toBe('## Contexto\n\nTexto.');
    expect(detailWithoutSummary('## Resumen\n\nUno.\n\nDos.')).toBe('Dos.');
    expect(detailWithoutSummary('## Contexto\n\nTexto.')).toBe('## Contexto\n\nTexto.');
    expect(detailWithoutSummary('```\n## Resumen\n```\n')).toBe('```\n## Resumen\n```');
  });

  it('resuelve las rutas locales de imagen respecto a la carpeta del documento', () => {
    expect(resolveLocalPath('/p/docs/backlog/todo', '../../img/a.png')).toBe('/p/docs/img/a.png');
    expect(resolveLocalPath('/p/docs', './a%20b.png')).toBe('/p/docs/a b.png');
    expect(resolveLocalPath('/p/docs', '/tmp/x.png')).toBe('/tmp/x.png');
    expect(resolveLocalPath('/p/docs', '~/x.png')).toBeNull();
    expect(resolveLocalPath('', 'x.png')).toBeNull();
  });
});

describe('proyecto elegido', () => {
  it('prefiere el pedido, luego el último usado y luego el primero', () => {
    expect(pickProject(['a', 'b'], 'b', 'a')).toBe('b');
    expect(pickProject(['a', 'b'], 'zz', 'b')).toBe('b');
    expect(pickProject(['a', 'b'], null, 'zz')).toBe('a');
    expect(pickProject([], null, null)).toBeNull();
  });

  it('Worktrees prefiere el pedido, luego el primero con worktrees y luego el primero', () => {
    const conWt = new Set(['b', 'c']);
    // La ruta manda, aunque no tenga worktrees.
    expect(pickWorktreesProject(['a', 'b', 'c'], 'a', conWt)).toBe('a');
    expect(pickWorktreesProject(['a', 'b', 'c'], null, conWt)).toBe('b');
    // Un proyecto pedido que no existe (u oculto) se ignora.
    expect(pickWorktreesProject(['a', 'b', 'c'], 'zz', conWt)).toBe('b');
    expect(pickWorktreesProject(['a', 'b', 'c'], null, new Set(['c']))).toBe('c');
    // Un proyecto con worktrees que no es visible no cuenta.
    expect(pickWorktreesProject(['a', 'b'], null, new Set(['oculto']))).toBe('a');
    expect(pickWorktreesProject(['a', 'b'], null, new Set())).toBe('a');
    expect(pickWorktreesProject([], null, conWt)).toBeNull();
  });

  it('Worktrees no recuerda el proyecto que escoge solo: abrir #/backlog/ccc, #/worktrees (abre bbb) y #/backlog muestra ccc', () => {
    const mapa = new Map<string, string>();
    const almacen = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v) };
    const ids = ['aaa', 'bbb', 'ccc'];
    const conWt = new Set(['bbb']);
    // Lo que hace useProjectScreen en cada render con efecto.
    let automatico: string | null = null;
    const abrir = (pantalla: 'backlog' | 'worktrees', pedido: string | null) => {
      const mostrado =
        pantalla === 'worktrees' ? pickWorktreesProject(ids, pedido, conWt)! : pickProject(ids, pedido, loadLastProject(almacen))!;
      const d = rememberDecision(pantalla, pedido, mostrado, automatico);
      automatico = d.automatico;
      if (d.remember) saveLastProject(mostrado, almacen);
      return mostrado;
    };
    expect(abrir('backlog', 'ccc')).toBe('ccc');
    // Worktrees sin proyecto abre bbb y la URL se corrige a #/worktrees/bbb.
    expect(abrir('worktrees', null)).toBe('bbb');
    expect(abrir('worktrees', 'bbb')).toBe('bbb');
    expect(loadLastProject(almacen)).toBe('ccc');
    expect(abrir('backlog', null)).toBe('ccc');
  });

  it('rememberDecision: recuerda lo que elige la persona y no lo que escoge Worktrees', () => {
    expect(rememberDecision('backlog', null, 'a', null)).toEqual({ remember: true, automatico: null });
    expect(rememberDecision('guias', 'b', 'b', null)).toEqual({ remember: true, automatico: null });
    expect(rememberDecision('worktrees', null, 'b', null)).toEqual({ remember: false, automatico: 'b' });
    // Un proyecto pedido que no existe: lo escoge la pantalla.
    expect(rememberDecision('worktrees', 'zz', 'b', null)).toEqual({ remember: false, automatico: 'b' });
    expect(rememberDecision('worktrees', 'b', 'b', 'b')).toEqual({ remember: false, automatico: 'b' });
    // Otro proyecto elegido en la ruta o con un clic.
    expect(rememberDecision('worktrees', 'c', 'c', 'b')).toEqual({ remember: true, automatico: null });
    expect(rememberDecision('worktrees', 'b', 'b', null)).toEqual({ remember: true, automatico: null });
  });

  it('recuerda el último proyecto y tolera un almacenamiento que lanza', () => {
    const mapa = new Map<string, string>();
    const almacen = { getItem: (k: string) => mapa.get(k) ?? null, setItem: (k: string, v: string) => void mapa.set(k, v) };
    saveLastProject('balanz.io', almacen);
    expect(loadLastProject(almacen)).toBe('balanz.io');
    const roto = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(loadLastProject(roto)).toBeNull();
    expect(() => saveLastProject('x', roto)).not.toThrow();
    expect(loadLastProject(null)).toBeNull();
  });
});

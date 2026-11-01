import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BacklogError,
  BacklogStore,
  BacklogWatcher,
  ITEM_ID_RE,
  STATES,
  allowedTransitions,
  editHeader,
  extractSummary,
  localDate,
  parseItem,
  pendingChanges,
  readSeconds,
} from './backlog.ts';
import type { BacklogState } from './backlog.ts';
import { LEGACY, itemSource } from './backlog-fixtures.ts';

const ctx = (id = 'BL-20261024-1145-ejemplo', status: BacklogState = 'backlog') => ({ id, file: `${id}.md`, status, etag: '1-1' });

describe('análisis de un elemento', () => {
  it('lee cabecera, título, resumen, cuerpo y tiempo de lectura', () => {
    const d = parseItem(itemSource('BL-20261024-1145-ejemplo', 'backlog'), ctx());
    expect(d).toMatchObject({
      id: 'BL-20261024-1145-ejemplo',
      status: 'backlog',
      title: 'Título con comillas',
      type: 'feature',
      priority: 'alta',
      created: '2026-10-24',
      updated: '2026-10-25',
      summary: 'Primer párrafo\nen dos líneas.',
      readSeconds: 10,
      warnings: [],
      path: 'docs/backlog/backlog/BL-20261024-1145-ejemplo.md',
    });
    expect(d.header).toMatchObject({ refs: ['`a.ts`'], status: 'backlog' });
    expect(d.body.startsWith('## Resumen')).toBe(true);
  });

  it('estima la lectura a 200 ppm redondeando a 10 s con mínimo de 10 s', () => {
    expect(readSeconds(null)).toBe(0);
    expect(readSeconds('uno dos')).toBe(10);
    expect(readSeconds(Array(400).fill('palabra').join(' '))).toBe(120);
    expect(readSeconds(Array(350).fill('p').join(' '))).toBe(110); // 105 s → 110
    expect(extractSummary('## Contexto\n\nalgo')).toBeNull();
    expect(extractSummary('```\n## Resumen\n```\n\n## Resumen\n\nBueno.')).toBe('Bueno.');
  });

  it('formato antiguo: título del documento y metadatos de la lista, con aviso', () => {
    const d = parseItem(LEGACY, ctx('BL-20260101-0000-viejo', 'todo'));
    expect(d).toMatchObject({
      title: 'Título antiguo',
      type: 'fix',
      priority: 'alta',
      created: '2026-01-01',
      status: 'todo',
      summary: 'Resumen viejo.',
      warnings: ['legacy'],
      header: null,
    });
  });

  it('YAML inválido, sin cerrar o con etiquetas propias se trata como formato antiguo', () => {
    for (const fuente of [
      '---\nid: [sin cerrar\n---\n\n# Roto\n',
      '---\nid: x\n\n# Sin cierre\n',
      '---\nid: !!js/function "function(){}"\n---\n\n# Etiqueta\n',
      '---\n- una\n- lista\n---\n\n# Lista\n',
      '---\nid: a\nid: b\n---\n\n# Duplicada\n',
    ]) {
      const d = parseItem(fuente, ctx());
      expect(d.warnings, fuente).toEqual(['legacy', 'invalid-yaml']);
      expect(d.header).toBeNull();
    }
    expect(parseItem('---\nid: [x\n---\n\n# Roto\n', ctx()).title).toBe('Roto');
  });

  it('avisa si status o id no coinciden con la carpeta y el archivo', () => {
    const d = parseItem(itemSource('BL-20261024-1145-otro', 'todo'), ctx());
    expect(d.status).toBe('backlog');
    expect(d.warnings).toEqual(['status-mismatch', 'id-mismatch']);
  });

  it('el patrón de identificador no admite rutas', () => {
    expect(ITEM_ID_RE.test('BL-20261024-1145-typescript-7')).toBe(true);
    for (const malo of ['BL-20261024-1145-../x', 'BL-20261024-1145-a/b', 'BL-20261024-1145-', 'BL-2026-1145-a', 'BL-20261024-1145-A', 'BL-20261024-1145-a.md']) {
      expect(ITEM_ID_RE.test(malo), malo).toBe(false);
    }
  });
});

describe('edición mínima de la cabecera', () => {
  it('cambia solo status y updated, conservando comillas y comentarios', () => {
    const antes = itemSource('BL-20261024-1145-ejemplo', 'backlog');
    const despues = editHeader(antes, 'todo', '2026-11-01');
    expect(despues).toBe(
      antes.replace("status: 'backlog' # estado", "status: 'todo' # estado").replace('updated: 2026-10-25', 'updated: 2026-11-01'),
    );
  });

  it('añade updated tras status si falta y respeta CRLF', () => {
    const antes = '---\r\nid: BL-20261024-1145-ejemplo\r\nstatus: backlog\r\npriority: baja\r\n---\r\n\r\n# T\r\n';
    expect(editHeader(antes, 'done', '2026-11-01')).toBe(
      '---\r\nid: BL-20261024-1145-ejemplo\r\nstatus: done\r\nupdated: 2026-11-01\r\npriority: baja\r\n---\r\n\r\n# T\r\n',
    );
  });

  it('añade status al final si falta', () => {
    expect(editHeader('---\nid: x\n---\n# T\n', 'todo', '2026-11-01')).toBe('---\nid: x\nstatus: todo\nupdated: 2026-11-01\n---\n# T\n');
  });

  it('rechaza con 422 una cabecera que no sabe editar', () => {
    expect(() => editHeader('---\nstatus: >\n  backlog\n---\n# T\n', 'todo', '2026-11-01')).toThrow(BacklogError);
    expect(() => editHeader('# Sin cabecera\n', 'todo', '2026-11-01')).toThrow(BacklogError);
  });
});

describe('BacklogStore con repositorios Git reales', () => {
  let tmp: string;
  let n = 0;
  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const commit = (dir: string) => {
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '-m', 'x');
  };
  function repo(): string {
    const dir = join(tmp, `repo-${n++}`);
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'inicio');
    return dir;
  }
  const escribir = (dir: string, estado: string, id: string, contenido = itemSource(id, estado)) => {
    mkdirSync(join(dir, 'docs', 'backlog', estado), { recursive: true });
    const ruta = join(dir, 'docs', 'backlog', estado, `${id}.md`);
    writeFileSync(ruta, contenido);
    return ruta;
  };

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-backlog-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('lee por estados según la carpeta, sin enlaces ni nombres ajenos', async () => {
    const dir = repo();
    escribir(dir, 'backlog', 'BL-20261024-1145-a');
    escribir(dir, 'todo', 'BL-20261024-1145-b', itemSource('BL-20261024-1145-b', 'backlog'));
    escribir(dir, 'done', 'BL-20261024-1145-c', LEGACY);
    escribir(dir, 'otra', 'BL-20261024-1145-d');
    writeFileSync(join(dir, 'docs', 'backlog', 'todo', 'README.md'), '# x');
    writeFileSync(join(tmp, 'fuera.md'), itemSource('BL-20261024-1145-e', 'todo'));
    symlinkSync(join(tmp, 'fuera.md'), join(dir, 'docs', 'backlog', 'todo', 'BL-20261024-1145-e.md'));
    const store = new BacklogStore();
    const { hasBacklog, items } = await store.list(dir);
    expect(hasBacklog).toBe(true);
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ['BL-20261024-1145-a', 'backlog'],
      ['BL-20261024-1145-b', 'todo'],
      ['BL-20261024-1145-c', 'done'],
    ]);
    expect(items[1]!.warnings).toEqual(['status-mismatch']);
    expect(items[2]!.warnings).toEqual(['legacy']);
    expect(await store.get(dir, 'BL-20261024-1145-e')).toBeNull();
    expect((await store.list(repo())).hasBacklog).toBe(false);
  });

  it('etag de mtime y tamaño, con caché por archivo', async () => {
    const dir = repo();
    const ruta = escribir(dir, 'backlog', 'BL-20261024-1145-a');
    escribir(dir, 'backlog', 'BL-20261024-1145-b');
    const store = new BacklogStore();
    const [a] = (await store.list(dir)).items;
    expect(a!.etag).toMatch(/^backlog:[0-9.]+-[0-9]+$/);
    expect(store.reads).toBe(2);
    await store.list(dir);
    await store.get(dir, 'BL-20261024-1145-a');
    expect(store.reads).toBe(2);
    writeFileSync(ruta, itemSource('BL-20261024-1145-a', 'backlog') + '\nmás\n');
    utimesSync(ruta, new Date(), new Date(Date.now() + 5000));
    const a2 = await store.get(dir, 'BL-20261024-1145-a');
    expect(store.reads).toBe(3);
    expect(a2!.etag).not.toBe(a!.etag);
  });

  it('permite y prohíbe cada transición según las reglas', async () => {
    const dir = repo();
    const store = new BacklogStore();
    const permitidas: string[] = [];
    let i = 0;
    for (const de of STATES) {
      for (const a of STATES) {
        const id = `BL-20261024-1145-t${i++}`;
        escribir(dir, de, id);
        const item = (await store.get(dir, id))!;
        try {
          const movido = await store.move(dir, id, a, item.etag, '2026-11-01');
          expect(movido.status).toBe(a);
          expect(movido.path).toBe(`docs/backlog/${a}/${id}.md`);
          expect(existsSync(join(dir, item.path))).toBe(false);
          permitidas.push(`${de}>${a}`);
        } catch (e) {
          expect(e).toBeInstanceOf(BacklogError);
          expect((e as BacklogError).status).toBe(400);
          expect(existsSync(join(dir, item.path))).toBe(true);
        }
      }
    }
    expect(permitidas.sort()).toEqual(
      STATES.flatMap((de) => allowedTransitions(de).map((a) => `${de}>${a}`)).sort(),
    );
    expect(permitidas).toHaveLength(18);
    expect(permitidas).not.toContain('done>discarded');
    expect(permitidas).toContain('done>backlog');
  });

  it('edita solo status y updated y conserva el resto del archivo', async () => {
    const dir = repo();
    const antes = itemSource('BL-20261024-1145-a', 'backlog').replace('updated: 2026-10-25\n', '');
    escribir(dir, 'backlog', 'BL-20261024-1145-a', antes);
    const store = new BacklogStore();
    const item = (await store.get(dir, 'BL-20261024-1145-a'))!;
    const movido = await store.move(dir, item.id, 'todo', item.etag, '2026-11-01');
    expect(readFileSync(join(dir, movido.path), 'utf8')).toBe(
      antes.replace("status: 'backlog' # estado\n", "status: 'todo' # estado\nupdated: 2026-11-01\n"),
    );
    expect(movido).toMatchObject({ status: 'todo', updated: '2026-11-01', warnings: [] });
    // La carpeta destino se crea si no existía.
    expect(existsSync(join(dir, 'docs', 'backlog', 'todo'))).toBe(true);
  });

  it('usa git mv si está en seguimiento y rename si no', async () => {
    const dir = repo();
    escribir(dir, 'backlog', 'BL-20261024-1145-a');
    commit(dir);
    escribir(dir, 'backlog', 'BL-20261024-1145-b');
    const store = new BacklogStore();
    const a = (await store.get(dir, 'BL-20261024-1145-a'))!;
    const b = (await store.get(dir, 'BL-20261024-1145-b'))!;
    await store.move(dir, a.id, 'in-progress', a.etag, '2026-11-01');
    await store.move(dir, b.id, 'todo', b.etag, '2026-11-01');
    const estado = git(dir, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).sort();
    expect(estado).toEqual([
      '?? docs/backlog/todo/BL-20261024-1145-b.md',
      // `git add` del destino: el índice tiene el renombrado con el contenido editado.
      'R  docs/backlog/backlog/BL-20261024-1145-a.md -> docs/backlog/in-progress/BL-20261024-1145-a.md',
    ]);
    expect(git(dir, 'show', ':docs/backlog/in-progress/BL-20261024-1145-a.md')).toContain("status: 'in-progress'");
    expect(await pendingChanges(dir)).toBe(2);
    expect(git(dir, 'log', '--oneline').split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('409 con la versión actual si otro proceso movió el archivo con git mv', async () => {
    const dir = repo();
    escribir(dir, 'backlog', 'BL-20261024-1145-a');
    commit(dir);
    const store = new BacklogStore();
    const abierto = (await store.get(dir, 'BL-20261024-1145-a'))!;
    // git mv conserva mtime y tamaño: solo la carpeta distingue la versión.
    mkdirSync(join(dir, 'docs', 'backlog', 'in-progress'), { recursive: true });
    git(dir, 'mv', 'docs/backlog/backlog/BL-20261024-1145-a.md', 'docs/backlog/in-progress/BL-20261024-1145-a.md');
    const actual = (await store.get(dir, 'BL-20261024-1145-a'))!;
    expect(actual.status).toBe('in-progress');
    expect(actual.etag).not.toBe(abierto.etag);
    for (const to of ['todo', 'in-progress', 'done'] as const) {
      const e = await store.move(dir, abierto.id, to, abierto.etag, '2026-11-01').catch((x: unknown) => x as BacklogError);
      expect(e).toBeInstanceOf(BacklogError);
      expect((e as BacklogError).status).toBe(409);
      expect((e as BacklogError).item).toMatchObject({ status: 'in-progress', etag: actual.etag });
    }
    expect(existsSync(join(dir, 'docs', 'backlog', 'in-progress', 'BL-20261024-1145-a.md'))).toBe(true);
  });

  it('409 si el etag no coincide o el destino existe, 422 en formato antiguo', async () => {
    const dir = repo();
    escribir(dir, 'backlog', 'BL-20261024-1145-a');
    escribir(dir, 'backlog', 'BL-20261024-1145-b');
    escribir(dir, 'todo', 'BL-20261024-1145-b');
    escribir(dir, 'backlog', 'BL-20261024-1145-c', LEGACY);
    escribir(dir, 'backlog', 'BL-20261024-1145-d', '---\nid: [x\n---\n\n# Roto\n');
    const store = new BacklogStore();
    const fallo = async (id: string, etag?: string) => {
      const item = (await store.get(dir, id))!;
      try {
        await store.move(dir, id, 'todo', etag ?? item.etag, '2026-11-01');
      } catch (e) {
        return e as BacklogError;
      }
      throw new Error('debía fallar');
    };
    const e1 = await fallo('BL-20261024-1145-a', '1-1');
    expect(e1.status).toBe(409);
    expect(e1.item?.id).toBe('BL-20261024-1145-a');
    expect((await fallo('BL-20261024-1145-b')).status).toBe(409);
    const e3 = await fallo('BL-20261024-1145-c');
    expect(e3.status).toBe(422);
    expect(e3.message).toContain('formato antiguo');
    expect((await fallo('BL-20261024-1145-d')).status).toBe(422);
    await expect(store.move(dir, 'BL-20261024-1145-zz', 'todo', 'x')).rejects.toMatchObject({ status: 404 });
    await expect(store.move(dir, 'BL-20261024-1145-a', 'otro', 'x')).rejects.toMatchObject({ status: 400 });
  });

  it('la fecha local tiene el formato YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('el vigilante avisa de elementos nuevos, de carpetas nuevas y no repite sin cambios', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'docs', 'backlog', 'backlog'), { recursive: true });
    const avisos: string[] = [];
    const w = new BacklogWatcher({ projects: async () => [{ id: 'p', path: dir }], onChange: (id) => avisos.push(id), fallbackMs: 60000, debounceMs: 20 });
    await w.start();
    const esperar = async (n: number) => {
      for (let i = 0; i < 100 && avisos.length < n; i++) await new Promise((r) => setTimeout(r, 30));
      expect(avisos.length).toBe(n);
    };
    try {
      escribir(dir, 'backlog', 'BL-20261024-1145-a');
      await esperar(1);
      escribir(dir, 'todo', 'BL-20261024-1145-b');
      await esperar(2);
      w.notify('p');
      await new Promise((r) => setTimeout(r, 100));
      expect(avisos).toEqual(['p', 'p']);
    } finally {
      w.stop();
    }
  });
});

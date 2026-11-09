import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Project } from './projects.ts';
import {
  MAX_FILES,
  MAX_PATCH_BYTES,
  PlaceError,
  changesOverview,
  changesSummary,
  parseNameStatus,
  parseNumstat,
  placeChangeCount,
  placeChanges,
  placeFileDiff,
} from './worktree-diff.ts';
import type { Place } from './worktree-diff.ts';

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const commit = (dir: string, msg: string) => {
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '--allow-empty', '-m', msg);
};
const write = (dir: string, ruta: string, contenido: string | Buffer) => {
  const abs = join(dir, ruta);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, contenido);
};
const crear = (e: unknown) => e as Error;
const wt = (name: string): Place => ({ kind: 'wt', name });
const main: Place = { kind: 'main' };

describe('parseo de la salida de git', () => {
  it('name-status -z, con renombrados y conflictos', () => {
    expect(parseNameStatus('M\0a b.ts\0A\0n.ts\0D\0d.ts\0R100\0viejo.ts\0nuevo.ts\0T\0t\0U\0c\0')).toEqual([
      { status: 'M', path: 'a b.ts', oldPath: null },
      { status: 'A', path: 'n.ts', oldPath: null },
      { status: 'D', path: 'd.ts', oldPath: null },
      { status: 'R', path: 'nuevo.ts', oldPath: 'viejo.ts' },
      { status: 'T', path: 't', oldPath: null },
      { status: 'M', path: 'c', oldPath: null },
    ]);
  });

  it('numstat -z, con binarios y renombrados (por la ruta nueva)', () => {
    const m = parseNumstat('3\t1\ta.ts\0-\t-\timg.png\0' + '0\t0\t\0viejo.ts\0nuevo.ts\0');
    expect(m.get('a.ts')).toEqual({ added: 3, deleted: 1, binary: false });
    expect(m.get('img.png')).toEqual({ added: null, deleted: null, binary: true });
    expect(m.get('nuevo.ts')).toEqual({ added: 0, deleted: 0, binary: false });
    expect(m.has('viejo.ts')).toBe(false);
  });
});

describe('cambios de un worktree', () => {
  let tmp: string;
  let proy: string;
  let uno: string;
  let vacio: string;
  let project: Project;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-wt-diff-'));
    proy = join(tmp, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    git(proy, 'init', '-q', '-b', 'main');
    write(proy, 'src/app.ts', 'uno\ndos\ntres\n');
    write(proy, 'src/viejo.ts', 'a\nb\nc\nd\ne\nf\ng\nh\n');
    write(proy, 'src/borrar.ts', 'x\ny\n');
    write(proy, 'logo.png', Buffer.from([0x89, 0x50, 0, 1, 2, 3]));
    write(proy, 'grande.txt', 'a\n');
    write(proy, 'sin-cambios.txt', 'igual\n');
    commit(proy, 'inicio');

    const wts = join(tmp, 'projects', 'foo.worktrees');
    mkdirSync(wts);
    uno = join(wts, 'uno');
    vacio = join(wts, 'vacio');
    git(proy, 'worktree', 'add', '-q', '-b', 'feat/uno', uno);
    git(proy, 'worktree', 'add', '-q', '-b', 'feat/vacio', vacio);

    // Commit de la rama: modifica app.ts y añade un archivo con espacios.
    write(uno, 'src/app.ts', 'uno\nDOS\ntres\ncuatro\n');
    write(uno, 'src/con espacio.ts', 'hola\n');
    commit(uno, 'cambios');
    // Sin commit: borrado, renombrado, binario modificado, grande.
    // Renombrado preparado (git mv): sin preparar, git lo ve como un borrado y un archivo sin seguimiento.
    git(uno, 'mv', 'src/viejo.ts', 'src/lib-nuevo.ts');
    rmSync(join(uno, 'src/borrar.ts'));
    write(uno, 'logo.png', Buffer.from([0x89, 0x50, 0, 9, 9, 9, 9]));
    write(uno, 'grande.txt', 'linea de relleno bastante larga para llenar el parche\n'.repeat(Math.ceil(MAX_PATCH_BYTES / 40)));
    // Sin seguimiento: texto, binario, vacío y un enlace.
    write(uno, 'docs/nuevo.md', '# Nuevo\n\nTexto sin final de línea');
    write(uno, 'docs/blob.bin', Buffer.from([1, 0, 2, 0]));
    write(uno, 'docs/vacio.txt', '');
    symlinkSync('../src/app.ts', join(uno, 'docs/enlace'));

    // La rama principal avanza después de crear el worktree: no debe verse como cambio suyo.
    write(proy, 'solo-principal.txt', 'x\n');
    write(proy, 'sin-cambios.txt', 'cambiado en main\n');
    commit(proy, 'principal avanza');

    const worktrees = [
      { name: 'uno', path: uno, branch: 'feat/uno' },
      { name: 'vacio', path: vacio, branch: 'feat/vacio' },
    ];
    project = { id: 'foo', name: 'foo', path: proy, harness: false, branch: 'main', worktrees } as unknown as Project;
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('lista commits, cambios sin commit y archivos sin seguimiento, y no lo que ganó la rama principal', async () => {
    const r = await placeChanges(project, wt('uno'));
    expect(r.base).toBe('main');
    expect(r.truncated).toBe(false);
    expect(r.mergeBase).toBe(git(proy, 'rev-parse', 'HEAD~1').trim());
    const porPath = Object.fromEntries(r.files.map((f) => [f.path, f]));
    expect(Object.keys(porPath).sort()).toEqual(
      [
        'docs/blob.bin',
        'docs/enlace',
        'docs/nuevo.md',
        'docs/vacio.txt',
        'grande.txt',
        'logo.png',
        'src/app.ts',
        'src/borrar.ts',
        'src/con espacio.ts',
        'src/lib-nuevo.ts',
      ].sort(),
    );
    expect(r.files.map((f) => f.path)).toEqual([...r.files.map((f) => f.path)].sort());
    expect(porPath['src/app.ts']).toMatchObject({ status: 'M', added: 2, deleted: 1, binary: false });
    // Con espacios en la ruta (salidas -z), añadido en un commit.
    expect(porPath['src/con espacio.ts']).toMatchObject({ status: 'A', added: 1, deleted: 0 });
    expect(porPath['src/borrar.ts']).toMatchObject({ status: 'D', added: 0, deleted: 2 });
    // Renombrado sin cambios de contenido.
    expect(porPath['src/lib-nuevo.ts']).toMatchObject({ status: 'R', oldPath: 'src/viejo.ts', added: 0, deleted: 0 });
    expect(porPath['logo.png']).toMatchObject({ status: 'M', binary: true, added: null, deleted: null });
    expect(porPath['docs/nuevo.md']).toMatchObject({ status: 'U', added: 3, deleted: 0, binary: false });
    expect(porPath['docs/blob.bin']).toMatchObject({ status: 'U', binary: true, added: null });
    expect(porPath['docs/vacio.txt']).toMatchObject({ status: 'U', added: 0, binary: false });
    expect(porPath['docs/enlace']).toMatchObject({ status: 'U', added: 1 });
    // Demasiado grande para contarlo: sin número, pero no binario.
    expect(porPath['grande.txt']).toMatchObject({ status: 'M', binary: false });
    expect(porPath['solo-principal.txt']).toBeUndefined();
    expect(porPath['sin-cambios.txt']).toBeUndefined();
  });

  it('un worktree sin cambios devuelve la lista vacía', async () => {
    const r = await placeChanges(project, wt('vacio'));
    expect(r.files).toEqual([]);
    expect(r.total).toBe(0);
    expect(await placeChangeCount(project, wt('vacio'))).toBe(0);
  });

  it('el recuento de la lista coincide con el de la vista', async () => {
    expect(await placeChangeCount(project, wt('uno'))).toBe((await placeChanges(project, wt('uno'))).total);
  });

  it('el recuento es null si el worktree no existe o git falla', async () => {
    expect(await placeChangeCount(project, wt('no-existe'))).toBeNull();
  });

  it('un worktree del harness o que no existe es un 404', async () => {
    const harness = { ...project, harness: true } as Project;
    await expect(placeChanges(harness, wt('uno'))).rejects.toMatchObject({ status: 404 });
    await expect(placeChanges(project, wt('no-existe'))).rejects.toMatchObject({ status: 404 });
    // Nunca rutas de disco del cliente.
    await expect(placeChanges(project, wt(uno))).rejects.toMatchObject({ status: 404 });
    await expect(placeChanges(project, wt('../foo.worktrees/uno'))).rejects.toBeInstanceOf(PlaceError);
  });

  it('409 si la rama del worktree no comparte historia con la principal', async () => {
    const huerfano = join(tmp, 'projects', 'foo.worktrees', 'huerfano');
    git(proy, 'worktree', 'add', '-q', '--orphan', '-b', 'feat/huerfano', huerfano);
    write(huerfano, 'a.txt', 'a\n');
    commit(huerfano, 'raíz independiente');
    const p = { ...project, worktrees: [...project.worktrees, { name: 'huerfano', path: huerfano, branch: 'feat/huerfano' }] } as Project;
    const e = crear(await placeChanges(p, wt('huerfano')).catch((x: unknown) => x));
    expect(e).toBeInstanceOf(PlaceError);
    expect(e).toMatchObject({ status: 409 });
    expect(e.message).toContain('no comparte historia');
  });

  it('diff de un archivo con seguimiento', async () => {
    const d = await placeFileDiff(project, wt('uno'), 'src/app.ts');
    expect(d).toMatchObject({ path: 'src/app.ts', oldPath: null, status: 'M', binary: false, tooLarge: false });
    expect(d.patch).toContain('@@ -1,3 +1,4 @@');
    expect(d.patch).toContain('-dos\n+DOS');
    expect(d.patch).toContain('+cuatro');
  });

  it('diff de un archivo borrado y de uno con espacios en la ruta', async () => {
    const b = await placeFileDiff(project, wt('uno'), 'src/borrar.ts');
    expect(b.status).toBe('D');
    expect(b.patch).toContain('@@ -1,2 +0,0 @@');
    const e = await placeFileDiff(project, wt('uno'), 'src/con espacio.ts');
    expect(e.patch).toContain('+hola');
  });

  it('diff de un renombrado sin cambios de contenido: sin bloques', async () => {
    const d = await placeFileDiff(project, wt('uno'), 'src/lib-nuevo.ts');
    expect(d).toMatchObject({ status: 'R', oldPath: 'src/viejo.ts', binary: false, tooLarge: false });
    expect(d.patch).toContain('rename from src/viejo.ts');
    expect(d.patch).not.toContain('@@');
  });

  it('diff de un archivo sin seguimiento (contra un archivo vacío)', async () => {
    const d = await placeFileDiff(project, wt('uno'), 'docs/nuevo.md');
    expect(d).toMatchObject({ status: 'U', binary: false, tooLarge: false });
    expect(d.patch).toContain('@@ -0,0 +1,3 @@');
    expect(d.patch).toContain('+Texto sin final de línea');
    expect(d.patch).toContain('\\ No newline at end of file');
  });

  it('un archivo sin seguimiento vacío no tiene bloques ni falla', async () => {
    const d = await placeFileDiff(project, wt('uno'), 'docs/vacio.txt');
    expect(d).toMatchObject({ status: 'U', binary: false, tooLarge: false });
    expect(d.patch ?? '').not.toContain('@@');
  });

  it('binarios, con y sin seguimiento: sin parche', async () => {
    expect(await placeFileDiff(project, wt('uno'), 'logo.png')).toMatchObject({ binary: true, tooLarge: false, patch: null });
    expect(await placeFileDiff(project, wt('uno'), 'docs/blob.bin')).toMatchObject({ binary: true, tooLarge: false, patch: null });
  });

  it('un parche de más de 512 KB es «demasiado grande» y no lleva parche', async () => {
    expect(await placeFileDiff(project, wt('uno'), 'grande.txt')).toMatchObject({ binary: false, tooLarge: true, patch: null });
  });

  it('una ruta que no está en la lista, incluida `../`, es un 404', async () => {
    for (const ruta of ['no-esta.ts', '../../.ssh/id_rsa', '../foo/src/app.ts', '/etc/passwd', 'sin-cambios.txt', 'src', '']) {
      await expect(placeFileDiff(project, wt('uno'), ruta), ruta).rejects.toMatchObject({ status: 404 });
    }
  });

  it('no escribe nada en el worktree (ni el índice)', async () => {
    const antes = git(uno, 'status', '--porcelain=v1', '-uall');
    await placeChanges(project, wt('uno'));
    await placeFileDiff(project, wt('uno'), 'src/app.ts');
    expect(git(uno, 'status', '--porcelain=v1', '-uall')).toBe(antes);
  });
});

describe('tope de archivos', () => {
  it('corta la lista en MAX_FILES, ordenada por ruta, y lo indica', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'jdev-wt-diff-max-'));
    try {
      const proy = join(tmp, 'projects', 'foo');
      mkdirSync(proy, { recursive: true });
      git(proy, 'init', '-q', '-b', 'main');
      commit(proy, 'inicio');
      const carpeta = join(tmp, 'projects', 'foo.worktrees', 'muchos');
      mkdirSync(join(tmp, 'projects', 'foo.worktrees'));
      git(proy, 'worktree', 'add', '-q', '-b', 'feat/muchos', carpeta);
      mkdirSync(join(carpeta, 'm'));
      for (let i = 0; i < MAX_FILES + 5; i++) writeFileSync(join(carpeta, 'm', `f${String(i).padStart(5, '0')}.txt`), 'x\n');
      const project = { id: 'foo', name: 'foo', path: proy, harness: false, branch: 'main', worktrees: [{ name: 'muchos', path: carpeta, branch: 'feat/muchos' }] } as unknown as Project;
      const r = await placeChanges(project, wt('muchos'));
      expect(r.files).toHaveLength(MAX_FILES);
      expect(r).toMatchObject({ truncated: true, total: MAX_FILES + 5 });
      expect(r.files[0]!.path).toBe('m/f00000.txt');
      expect(await placeChangeCount(project, wt('muchos'))).toBe(MAX_FILES + 5);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('checkout principal', () => {
  let tmp: string;
  let remoto: string;
  let proy: string;
  let otro: string;
  let project: Project;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-main-diff-'));
    remoto = join(tmp, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
    proy = join(tmp, 'projects', 'foo');
    mkdirSync(join(tmp, 'projects'));
    execFileSync('git', ['clone', '-q', remoto, proy], { stdio: 'pipe' });
    write(proy, 'README.md', 'uno\n');
    write(proy, 'src/viejo.ts', 'x\n');
    commit(proy, 'inicio');
    git(proy, 'push', '-q', '-u', 'origin', 'main');
    // Un commit ya subido: no debe aparecer como cambio.
    write(proy, 'subido.txt', 's\n');
    commit(proy, 'subido');
    git(proy, 'push', '-q');
    // Un commit sin subir, un cambio sin commit y un archivo nuevo sin seguimiento.
    write(proy, 'README.md', 'uno\ndos\n');
    commit(proy, 'sin subir');
    write(proy, 'src/viejo.ts', 'x\ny\n');
    write(proy, 'nuevo.txt', 'n\n');
    project = { id: 'foo', name: 'foo', path: proy, harness: false, branch: 'main', worktrees: [] } as unknown as Project;
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('con rama remota compara con el punto en que se separa de ella: commits sin subir, sin commit y sin seguimiento', async () => {
    const r = await placeChanges(project, main);
    expect(r.upstream).toBe('origin/main');
    expect(r.base).toBe('origin/main');
    expect(r.mergeBase).toBe(git(proy, 'rev-parse', 'origin/main').trim());
    expect(r.files.map((f) => [f.path, f.status])).toEqual([
      ['README.md', 'M'],
      ['nuevo.txt', 'U'],
      ['src/viejo.ts', 'M'],
    ]);
    expect((await placeFileDiff(project, main, 'README.md')).patch).toContain('+dos');
    expect((await placeFileDiff(project, main, 'nuevo.txt')).patch).toContain('+n');
    await expect(placeFileDiff(project, main, 'subido.txt')).rejects.toMatchObject({ status: 404 });
  });

  it('un commit que el remoto ganó después (tras un fetch) no aparece como cambio', async () => {
    otro = join(tmp, 'otro');
    execFileSync('git', ['clone', '-q', remoto, otro]);
    write(otro, 'del-remoto.txt', 'r\n');
    commit(otro, 'remoto avanza');
    git(otro, 'push', '-q');
    git(proy, 'fetch', '-q');
    const r = await placeChanges(project, main);
    expect(r.files.map((f) => f.path)).toEqual(['README.md', 'nuevo.txt', 'src/viejo.ts']);
    expect(r.mergeBase).toBe(git(proy, 'merge-base', 'origin/main', 'HEAD').trim());
    expect(r.mergeBase).not.toBe(git(proy, 'rev-parse', 'origin/main').trim());
  });

  it('el resumen da ahead y behind frente a la rama remota, cambios, sin commit y sesiones del checkout principal', async () => {
    const o = await changesOverview(project, [
      { name: 's1', project: 'foo', worktree: '' },
      { name: 's2', project: 'foo', worktree: 'uno' },
      { name: 's3', project: 'otro', worktree: '' },
    ]);
    expect(o.base).toBe('main');
    expect(o.main).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 1, dirty: true, changes: 3, sessions: ['s1'] });
    expect(o.worktrees).toEqual([]);
  });

  it('sin rama remota solo hay cambios sin commit y archivos nuevos, y ahead y behind son null', async () => {
    const solo = join(tmp, 'solo');
    mkdirSync(solo);
    git(solo, 'init', '-q', '-b', 'main');
    write(solo, 'a.txt', 'a\n');
    commit(solo, 'a');
    write(solo, 'b.txt', 'b\n');
    commit(solo, 'b');
    write(solo, 'a.txt', 'a\nA\n');
    write(solo, 'c.txt', 'c\n');
    const p = { ...project, id: 'solo', path: solo } as Project;
    const r = await placeChanges(p, main);
    expect(r.upstream).toBeNull();
    expect(r.base).toBe('main');
    expect(r.mergeBase).toBe(git(solo, 'rev-parse', 'HEAD').trim());
    expect(r.files.map((f) => [f.path, f.status])).toEqual([['a.txt', 'M'], ['c.txt', 'U']]);
    const o = await changesOverview(p, []);
    expect(o.main).toMatchObject({ upstream: null, ahead: null, behind: null, dirty: true, changes: 2, sessions: [] });
  });

  it('con HEAD separado la base es HEAD', async () => {
    const sep = join(tmp, 'separado');
    mkdirSync(sep);
    git(sep, 'init', '-q', '-b', 'main');
    write(sep, 'a.txt', 'a\n');
    commit(sep, 'a');
    git(sep, 'checkout', '-q', '--detach');
    write(sep, 'a.txt', 'a\nA\n');
    const r = await placeChanges({ ...project, path: sep, branch: 'HEAD' } as Project, main);
    expect(r).toMatchObject({ upstream: null, base: 'HEAD' });
    expect(r.files.map((f) => f.path)).toEqual(['a.txt']);
  });

  it('un repositorio sin commits muestra lo añadido y lo nuevo', async () => {
    const vacio = join(tmp, 'vacio');
    mkdirSync(vacio);
    git(vacio, 'init', '-q', '-b', 'main');
    write(vacio, 'indice.txt', 'i\n');
    git(vacio, 'add', 'indice.txt');
    write(vacio, 'suelto.txt', 's\n');
    const p = { ...project, path: vacio } as Project;
    const r = await placeChanges(p, main);
    expect(r.files.map((f) => [f.path, f.status])).toEqual([['indice.txt', 'A'], ['suelto.txt', 'U']]);
    expect((await placeFileDiff(p, main, 'indice.txt')).patch).toContain('+i');
  });

  it('el harness tiene su checkout principal y ningún worktree', async () => {
    const h = { ...project, harness: true } as Project;
    expect((await placeChanges(h, main)).files.length).toBe(3);
    await expect(placeChanges(h, wt('x'))).rejects.toMatchObject({ status: 404 });
    expect((await changesOverview(h, [])).worktrees).toEqual([]);
  });

  it('el resumen por proyecto suma el checkout principal y los worktrees, y es null si git falla', async () => {
    const wtDir = join(tmp, 'projects', 'foo.worktrees', 'uno');
    mkdirSync(join(tmp, 'projects', 'foo.worktrees'), { recursive: true });
    git(proy, 'worktree', 'add', '-q', '-b', 'feat/uno', wtDir);
    write(wtDir, 'solo-wt.txt', 'w\n');
    const p = { ...project, worktrees: [{ name: 'uno', path: wtDir, branch: 'feat/uno' }] } as Project;
    const roto = { ...project, id: 'roto', path: join(tmp, 'no-existe'), worktrees: [] } as Project;
    const r = await changesSummary([p, roto]);
    // main: 3 archivos; worktree: 1 (lo que la rama principal avanzó antes no cuenta).
    expect(r).toEqual({ foo: 4, roto: null });
    const o = await changesOverview(p, [{ name: 's2', project: 'foo', worktree: 'uno' }]);
    expect(o.worktrees).toEqual([{ name: 'uno', branch: 'feat/uno', ahead: 0, behind: 0, dirty: true, changes: 1, sessions: ['s2'] }]);
  });
});

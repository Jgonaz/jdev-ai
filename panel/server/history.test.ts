import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BacklogWatcher } from './backlog.ts';
import {
  ENTRY_FILE_RE,
  HistoryError,
  HistoryStore,
  editPending,
  entryDate,
  entryState,
  historyDirs,
  historySignature,
  latestKey,
  markAllPending,
  parseEntry,
} from './history.ts';

const ENTRADA = `# Panel con historial

Fecha: 2026-10-31 00:27
Estado: en curso

## Resumen

- Primer punto
  en dos líneas.

## Pendiente de ti

- Reinstalar la app en el iPhone
  y comprobar el teclado.
- [x] Probar en Safari. (hecho 2026-10-30)
- Decidir el \`nombre\`.

Nota: suelta.

## Continuación recomendada

- Seguir con la pantalla.
`;

const ctx = (file = '2026-10-31-0027-panel.md') => ({ project: 'demo', file, etag: '1-1', mtimeMs: new Date(2026, 9, 1, 8, 5).getTime() });

describe('análisis de una entrada', () => {
  it('lee título, fecha, estado, secciones y pendientes', () => {
    const d = parseEntry(ENTRADA, ctx());
    expect(d).toMatchObject({
      project: 'demo',
      file: '2026-10-31-0027-panel.md',
      path: '.agent/history/2026-10-31-0027-panel.md',
      title: 'Panel con historial',
      date: '2026-10-31 00:27',
      approxDate: false,
      state: 'en curso',
      rawState: 'en curso',
      hasPendingSection: true,
      openPending: 2,
      totalPending: 3,
      firstPending: 'Reinstalar la app en el iPhone y comprobar el teclado.',
      pendingNotes: 'Nota: suelta.',
    });
    expect(d.pending).toEqual([
      { index: 0, text: 'Reinstalar la app en el iPhone y comprobar el teclado.', done: false, doneDate: null },
      { index: 1, text: 'Probar en Safari.', done: true, doneDate: '2026-10-30' },
      { index: 2, text: 'Decidir el `nombre`.', done: false, doneDate: null },
    ]);
    expect(d.sections).toEqual([
      { title: 'Resumen', body: '- Primer punto\n  en dos líneas.' },
      { title: 'Continuación recomendada', body: '- Seguir con la pantalla.' },
    ]);
  });

  it('tolera formatos raros sin romperse', () => {
    const raro = parseEntry('Sin título ni nada\r\n\r\nEstado: pausada\r\n## Pendiente\r\n- algo\r\n', ctx('2026-09-18-commit-avisos.md'));
    expect(raro).toMatchObject({
      title: '2026-09-18-commit-avisos',
      date: '2026-09-18',
      approxDate: true,
      state: 'desconocido',
      hasPendingSection: false,
      totalPending: 0,
      firstPending: null,
    });
    expect(raro.sections).toEqual([
      { title: '', body: 'Sin título ni nada' },
      { title: 'Pendiente', body: '- algo' },
    ]);
    expect(parseEntry('', ctx('notas.md'))).toMatchObject({ title: 'notas', date: '2026-10-01 08:05', approxDate: true, state: 'desconocido' });
    expect(parseEntry('# T\n\nEstado: finalizada (sin commit)\n', ctx()).state).toBe('finalizada');
  });

  it('fecha: Fecha válida, nombre con hora, día de Fecha o del nombre, mtime', () => {
    const mtime = new Date(2026, 0, 2, 3, 4).getTime();
    expect(entryDate('2026-10-31 00:27', 'x.md', mtime)).toEqual({ date: '2026-10-31 00:27', approxDate: false });
    expect(entryDate('2026-10-31 25:00', '2026-10-30-2210-x.md', mtime)).toEqual({ date: '2026-10-30 22:10', approxDate: true });
    expect(entryDate('2026-10-12', 'x.md', mtime)).toEqual({ date: '2026-10-12', approxDate: true });
    expect(entryDate(null, '2026-10-12-sin-hora.md', mtime)).toEqual({ date: '2026-10-12', approxDate: true });
    expect(entryDate('ayer', 'x.md', mtime)).toEqual({ date: '2026-01-02 03:04', approxDate: true });
  });

  it('estado por prefijo, como bin/session-status', () => {
    expect(entryState('finalizada')).toBe('finalizada');
    expect(entryState('en curso (falta la prueba)')).toBe('en curso');
    expect(entryState('bloqueada por Supabase')).toBe('bloqueada');
    for (const sinonimo of ['terminada', 'cerrada (sin commit)', 'completada', 'completado', 'completo']) {
      expect(entryState(sinonimo), sinonimo).toBe('finalizada');
    }
    expect(entryState('pausada')).toBe('desconocido');
    expect(entryState(null)).toBe('desconocido');
  });

  it('ignora el BOM inicial al analizar', () => {
    const d = parseEntry(`\uFEFF${ENTRADA}`, ctx());
    expect(d.title).toBe('Panel con historial');
    expect(d.date).toBe('2026-10-31 00:27');
    expect(d.sections).toEqual(parseEntry(ENTRADA, ctx()).sections);
  });

  it('valida el nombre de archivo', () => {
    for (const ok of ['2026-10-31-0027-panel.md', 'notas.md', 'año-ñ.md']) expect(ENTRY_FILE_RE.test(ok), ok).toBe(true);
    for (const mal of ['../x.md', 'a/b.md', '.oculto.md', 'x.txt', 'a..b.md', 'archive', '']) expect(ENTRY_FILE_RE.test(mal), mal).toBe(false);
  });
});

describe('marcar y desmarcar pendientes', () => {
  it('marca solo la primera línea y el final de la última, y desmarca exacto', () => {
    const marcado = editPending(ENTRADA, 0, true, '2026-11-01');
    expect(marcado).toBe(
      ENTRADA.replace('- Reinstalar la app en el iPhone\n  y comprobar el teclado.\n', '- [x] Reinstalar la app en el iPhone\n  y comprobar el teclado. (hecho 2026-11-01)\n'),
    );
    expect(editPending(marcado, 0, false, '2026-11-02')).toBe(ENTRADA);
    const d = parseEntry(marcado, ctx());
    expect(d.pending[0]).toEqual({ index: 0, text: 'Reinstalar la app en el iPhone y comprobar el teclado.', done: true, doneDate: '2026-11-01' });
    expect(d.firstPending).toBe('Decidir el `nombre`.');
  });

  it('desmarca un punto hecho de una línea y no toca lo que ya está así', () => {
    expect(editPending(ENTRADA, 1, false, '2026-11-01')).toBe(ENTRADA.replace('- [x] Probar en Safari. (hecho 2026-10-30)', '- Probar en Safari.'));
    expect(editPending(ENTRADA, 1, true, '2026-11-01')).toBe(ENTRADA);
    expect(editPending(ENTRADA, 2, false, '2026-11-01')).toBe(ENTRADA);
  });

  it('conserva CRLF', () => {
    const crlf = ENTRADA.replace(/\n/g, '\r\n');
    const marcado = editPending(crlf, 2, true, '2026-11-01');
    expect(marcado).toBe(crlf.replace('- Decidir el `nombre`.\r\n', '- [x] Decidir el `nombre`. (hecho 2026-11-01)\r\n'));
    expect(editPending(marcado, 2, false, '2026-11-01')).toBe(crlf);
  });

  it('conserva el BOM al escribir', () => {
    const conBom = `\uFEFF${ENTRADA}`;
    const marcado = editPending(conBom, 2, true, '2026-11-01');
    expect(marcado.startsWith('\uFEFF# Panel con historial\n')).toBe(true);
    expect(marcado).toBe(`\uFEFF${editPending(ENTRADA, 2, true, '2026-11-01')}`);
    expect(editPending(marcado, 2, false, '2026-11-01')).toBe(conBom);
  });

  it('rechaza índices inexistentes', () => {
    expect(() => editPending(ENTRADA, 3, true, '2026-11-01')).toThrow(HistoryError);
    expect(() => editPending('# Sin pendientes\n', 0, true, '2026-11-01')).toThrow(/no tiene «Pendiente de ti»/);
  });
});

describe('última entrada y marca en bloque', () => {
  const mt = new Date(2026, 9, 1, 8, 5).getTime();
  it('clave de orden como latest_history de bin/session-status', () => {
    expect(latestKey('# T\n\nFecha: 2026-10-31 00:27\n', 'x.md', mt)).toBe('2026-10-31\t0027');
    // Sin hora en Fecha: la del nombre; sin nombre con hora: la del mtime.
    expect(latestKey('Fecha: 2026-10-31\n', '2026-10-30-1200-a.md', mt)).toBe('2026-10-31\t1200');
    expect(latestKey('Fecha: 2026-10-31\n', 'notas.md', mt)).toBe('2026-10-31\t0805');
    // Sin Fecha: día y hora del nombre; nombre sin hora: día del nombre y hora del mtime.
    expect(latestKey('# T\n', '2026-10-30-1200-a.md', mt)).toBe('2026-10-30\t1200');
    expect(latestKey('# T\n', '2026-09-18-commit.md', mt)).toBe('2026-09-18\t0805');
    expect(latestKey('# T\n', 'notas.md', mt)).toBe('2026-10-01\t0805');
    // El primer `Fecha:` de todo el archivo, sin validar dígitos, como `sed`.
    expect(latestKey('# T\n\n## Resumen\n\nFecha:   2026-99-99 12:34 extra\r\nFecha: 2020-01-01 00:00\n', 'x.md', mt)).toBe('2026-99-99\t1234');
    expect(latestKey('# T\nFecha: mañana\n', '2026-10-30-1200-a.md', mt)).toBe('2026-10-30\t1200');
  });

  it('marca todos los abiertos con la edición mínima', () => {
    const r = markAllPending(ENTRADA, '2026-11-01');
    expect(r.marked).toBe(2);
    expect(r.text).toBe(
      ENTRADA.replace('- Reinstalar la app en el iPhone\n  y comprobar el teclado.\n', '- [x] Reinstalar la app en el iPhone\n  y comprobar el teclado. (hecho 2026-11-01)\n').replace(
        '- Decidir el `nombre`.\n',
        '- [x] Decidir el `nombre`. (hecho 2026-11-01)\n',
      ),
    );
    expect(markAllPending(r.text, '2026-11-02')).toEqual({ text: r.text, marked: 0 });
    expect(markAllPending('# Sin\n', '2026-11-01')).toEqual({ text: '# Sin\n', marked: 0 });
  });
});

describe('almacén del historial', () => {
  let tmp: string;
  let a: string;
  let b: string;
  const hist = (p: string) => join(p, '.agent', 'history');
  const escribir = (p: string, file: string, texto: string) => writeFileSync(join(hist(p), file), texto);

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-history-'));
    a = join(tmp, 'a');
    b = join(tmp, 'b');
    mkdirSync(join(hist(a), 'archive'), { recursive: true });
    mkdirSync(hist(b), { recursive: true });
    escribir(a, '2026-10-31-0027-panel.md', ENTRADA);
    escribir(a, '2026-10-30-1000-hecha.md', '# Hecha\n\nFecha: 2026-10-30 10:00\nEstado: finalizada\n');
    escribir(a, 'notas.txt', 'no es markdown');
    writeFileSync(join(hist(a), 'archive', '2026-01-01-0000-viejo.md'), '# Viejo\n');
    writeFileSync(join(tmp, 'secreto.md'), '# Secreto\n');
    symlinkSync(join(tmp, 'secreto.md'), join(hist(a), '2026-10-29-0000-enlace.md'));
    writeFileSync(join(hist(a), '2026-10-28-0000-enorme.md'), `# Enorme\n${'x'.repeat(1024 * 1024)}`);
    escribir(b, '2026-10-31-0900-bloqueo.md', '# Bloqueo\n\nFecha: 2026-10-31 09:00\nEstado: bloqueada\n\n## Pendiente de ti\n\n- Dar acceso.\n');
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const proyectos = () => [
    { id: 'a', path: a },
    { id: 'b', path: b },
    { id: 'sin-historial', path: join(tmp, 'nada') },
  ];

  it('lista todo ordenado, sin subcarpetas, enlaces, otros archivos ni >1 MB', async () => {
    const s = new HistoryStore();
    const l = await s.list(proyectos());
    expect(l.map((e) => `${e.project}/${e.file}`)).toEqual(['b/2026-10-31-0900-bloqueo.md', 'a/2026-10-31-0027-panel.md', 'a/2026-10-30-1000-hecha.md']);
    expect(Object.keys(l[0]!).sort()).toEqual(
      ['approxDate', 'date', 'etag', 'file', 'firstPending', 'latest', 'openPending', 'project', 'state', 'title', 'totalPending'].sort(),
    );
    expect(l.map((e) => e.latest)).toEqual([true, true, false]);
    // La segunda lista sale de la caché.
    const lecturas = s.reads;
    await s.list(proyectos());
    expect(s.reads).toBe(lecturas);
  });

  it('filtra por proyecto, estado y pendientes abiertos', async () => {
    const s = new HistoryStore();
    expect((await s.list(proyectos(), { project: 'a' })).map((e) => e.file)).toEqual(['2026-10-31-0027-panel.md', '2026-10-30-1000-hecha.md']);
    expect((await s.list(proyectos(), { state: 'bloqueada' })).map((e) => e.project)).toEqual(['b']);
    expect((await s.list(proyectos(), { pending: true })).map((e) => e.file)).toEqual(['2026-10-31-0900-bloqueo.md', '2026-10-31-0027-panel.md']);
    expect(await s.list(proyectos(), { project: 'a', state: 'bloqueada' })).toEqual([]);
  });

  it('detalle con validación de nombre, enlaces y tamaño', async () => {
    const s = new HistoryStore();
    const p = { id: 'a', path: a };
    expect((await s.get(p, '2026-10-31-0027-panel.md')).title).toBe('Panel con historial');
    const estado = async (file: string) => {
      try {
        await s.get(p, file);
        return 200;
      } catch (e) {
        return (e as HistoryError).status;
      }
    };
    expect(await estado('../secreto.md')).toBe(400);
    expect(await estado('2026-10-29-0000-enlace.md')).toBe(404);
    expect(await estado('archive')).toBe(400);
    expect(await estado('falta.md')).toBe(404);
    expect(await estado('2026-10-28-0000-enorme.md')).toBe(413);
  });

  it('marca con etag, conserva permisos y rechaza con 409 si cambió', async () => {
    const s = new HistoryStore();
    const p = { id: 'b', path: b };
    const ruta = join(hist(b), '2026-10-31-0900-bloqueo.md');
    chmodSync(ruta, 0o640);
    const antes = await s.get(p, '2026-10-31-0900-bloqueo.md');
    const hecho = await s.setPending(p, antes.file, 0, true, antes.etag, '2026-11-01');
    expect(readFileSync(ruta, 'utf8')).toContain('\n- [x] Dar acceso. (hecho 2026-11-01)\n');
    expect(statSync(ruta).mode & 0o777).toBe(0o640);
    expect(hecho.openPending).toBe(0);
    expect(hecho.etag).not.toBe(antes.etag);
    expect((await s.list(proyectos(), { pending: true })).map((e) => e.project)).toEqual(['a']);

    await expect(s.setPending(p, antes.file, 0, false, antes.etag)).rejects.toMatchObject({ status: 409, entry: { etag: hecho.etag } });
    await expect(s.setPending(p, antes.file, 5, false, hecho.etag)).rejects.toMatchObject({ status: 400 });
    await expect(s.setPending(p, antes.file, '0', false, hecho.etag)).rejects.toMatchObject({ status: 400 });
    await expect(s.setPending(p, antes.file, 0, 'sí', hecho.etag)).rejects.toMatchObject({ status: 400 });
    await expect(s.setPending(p, antes.file, 0, false, '')).rejects.toMatchObject({ status: 400 });
    await expect(s.setPending(p, 'falta.md', 0, false, 'x')).rejects.toMatchObject({ status: 404 });

    const vuelta = await s.setPending(p, antes.file, 0, false, hecho.etag);
    expect(readFileSync(ruta, 'utf8')).toContain('\n- Dar acceso.\n');
    expect(vuelta.openPending).toBe(1);
  });

  it('serializa las marcas del mismo archivo', async () => {
    const s = new HistoryStore();
    const p = { id: 'a', path: a };
    const file = '2026-10-31-0027-panel.md';
    const d = await s.get(p, file);
    // Dos marcas con el mismo etag: la segunda ve el archivo ya cambiado.
    const r = await Promise.allSettled([s.setPending(p, file, 0, true, d.etag, '2026-11-01'), s.setPending(p, file, 2, true, d.etag, '2026-11-01')]);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected']);
    expect((r[1] as PromiseRejectedResult).reason.status).toBe(409);
    writeFileSync(join(hist(a), file), ENTRADA);
  });

  it('la firma cambia al crear, editar o borrar entradas y el vigilante avisa', async () => {
    const f1 = await historySignature(a);
    escribir(a, '2026-11-01-1200-nueva.md', '# Nueva\n');
    const f2 = await historySignature(a);
    expect(f2).not.toBe(f1);
    // Un archivo de archive/ no cuenta.
    writeFileSync(join(hist(a), 'archive', 'otro.md'), '# Otro\n');
    expect(await historySignature(a)).toBe(f2);
    rmSync(join(hist(a), '2026-11-01-1200-nueva.md'));
    expect(await historySignature(a)).toBe(f1);

    const avisos: string[] = [];
    const w = new BacklogWatcher({
      projects: async () => [{ id: 'a', path: a }],
      onChange: (id) => avisos.push(id),
      fallbackMs: 60000,
      debounceMs: 20,
      signature: historySignature,
      dirs: historyDirs,
    });
    await w.start();
    try {
      escribir(a, '2026-11-01-1300-otra.md', '# Otra\n');
      for (let i = 0; i < 100 && avisos.length < 1; i++) await new Promise((r) => setTimeout(r, 30));
      expect(avisos).toEqual(['a']);
    } finally {
      w.stop();
      rmSync(join(hist(a), '2026-11-01-1300-otra.md'));
    }
  });

  it('no marca entradas que no son UTF-8 y conserva sus bytes', async () => {
    const s = new HistoryStore();
    const p = { id: 'b', path: b };
    const file = '2026-10-20-0000-latin1.md';
    const bytes = Buffer.from('# Año viejo\n\n## Pendiente de ti\n\n- Revisar la configuración.\n', 'latin1');
    writeFileSync(join(hist(b), file), bytes);
    try {
      const d = await s.get(p, file);
      await expect(s.setPending(p, file, 0, true, d.etag, '2026-11-01')).rejects.toMatchObject({
        status: 422,
        message: 'La entrada no está en UTF-8; no se puede marcar sin alterarla.',
      });
      expect(readFileSync(join(hist(b), file)).equals(bytes)).toBe(true);
    } finally {
      rmSync(join(hist(b), file));
    }
  });

  it('marca entradas con BOM sin perderlo en disco', async () => {
    const s = new HistoryStore();
    const p = { id: 'b', path: b };
    const file = '2026-10-21-0000-bom.md';
    const ruta = join(hist(b), file);
    writeFileSync(ruta, `\uFEFF# Con BOM\n\n## Pendiente de ti\n\n- Probar.\n`);
    try {
      const d = await s.get(p, file);
      expect(d.title).toBe('Con BOM');
      await s.setPending(p, file, 0, true, d.etag, '2026-11-01');
      const crudo = readFileSync(ruta);
      expect([...crudo.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(crudo.toString('utf8')).toBe('\uFEFF# Con BOM\n\n## Pendiente de ti\n\n- [x] Probar. (hecho 2026-11-01)\n');
    } finally {
      rmSync(ruta);
    }
  });

  it('ignora el historial si .agent o .agent/history salen del proyecto', async () => {
    const fuera = join(tmp, 'fuera');
    mkdirSync(join(fuera, 'history'), { recursive: true });
    writeFileSync(join(fuera, 'history', '2026-10-31-1000-ajena.md'), '# Ajena\n\n## Pendiente de ti\n\n- Nada.\n');
    // c: `.agent` es un enlace fuera; d: `.agent/history` es un enlace fuera;
    // e: `.agent/history` es un enlace a otra carpeta del propio proyecto.
    const c = join(tmp, 'c');
    const d = join(tmp, 'd');
    const e = join(tmp, 'e');
    mkdirSync(c);
    symlinkSync(fuera, join(c, '.agent'));
    mkdirSync(join(d, '.agent'), { recursive: true });
    symlinkSync(join(fuera, 'history'), join(d, '.agent', 'history'));
    mkdirSync(join(e, 'notas'), { recursive: true });
    mkdirSync(join(e, '.agent'));
    writeFileSync(join(e, 'notas', '2026-10-31-1100-propia.md'), '# Propia\n');
    symlinkSync(join(e, 'notas'), join(e, '.agent', 'history'));

    const s = new HistoryStore();
    const ps = [
      { id: 'c', path: c },
      { id: 'd', path: d },
      { id: 'e', path: e },
    ];
    expect((await s.list(ps)).map((x) => `${x.project}/${x.title}`)).toEqual(['e/Propia']);
    expect(await historySignature(c)).toBe('');
    expect(await historySignature(d)).toBe('');
    for (const p of ps.slice(0, 2)) {
      await expect(s.get(p, '2026-10-31-1000-ajena.md')).rejects.toMatchObject({ status: 403 });
      await expect(s.setPending(p, '2026-10-31-1000-ajena.md', 0, true, 'x')).rejects.toMatchObject({ status: 403 });
    }
    expect(readFileSync(join(fuera, 'history', '2026-10-31-1000-ajena.md'), 'utf8')).toContain('- Nada.');
    expect((await s.get(ps[2]!, '2026-10-31-1100-propia.md')).title).toBe('Propia');
  });

  it('la caché se invalida al cambiar el archivo', async () => {
    const s = new HistoryStore();
    const p = { id: 'a', path: a };
    const ruta = join(hist(a), '2026-10-30-1000-hecha.md');
    expect((await s.get(p, '2026-10-30-1000-hecha.md')).title).toBe('Hecha');
    writeFileSync(ruta, '# Hecha y revisada\n');
    utimesSync(ruta, new Date(), new Date(Date.now() + 5000));
    expect((await s.get(p, '2026-10-30-1000-hecha.md')).title).toBe('Hecha y revisada');
  });

  it('latest: la última de cada proyecto por fecha y hora, no por mtime', async () => {
    const p = join(tmp, 'orden');
    mkdirSync(hist(p), { recursive: true });
    try {
      // La de nombre mayor es más antigua por Fecha y tiene el mtime más reciente.
      escribir(p, '2026-10-31-0900-z.md', '# Z\n\nFecha: 2026-10-30 08:00\n\n## Pendiente de ti\n\n- Viejo.\n');
      escribir(p, '2026-10-30-2300-a.md', '# A\n\nFecha: 2026-10-30 23:00\n\n## Pendiente de ti\n\n- Vigente.\n');
      const futuro = new Date(2026, 11, 1);
      utimesSync(join(hist(p), '2026-10-31-0900-z.md'), futuro, futuro);
      const s = new HistoryStore();
      const l = await s.list([{ id: 'orden', path: p }]);
      expect(l.map((e) => [e.title, e.latest])).toEqual([
        ['A', true],
        ['Z', false],
      ]);
      // El filtro no cambia cuál es la última, y el detalle también lo dice.
      expect((await s.list([{ id: 'orden', path: p }], { state: 'bloqueada' })).length).toBe(0);
      expect((await s.get({ id: 'orden', path: p }, '2026-10-31-0900-z.md')).latest).toBe(false);
      expect((await s.get({ id: 'orden', path: p }, '2026-10-30-2300-a.md')).latest).toBe(true);
      // A igual clave, gana el nombre mayor.
      escribir(p, '2026-10-30-2300-b.md', '# B\n\nFecha: 2026-10-30 23:00\n');
      expect((await s.list([{ id: 'orden', path: p }])).filter((e) => e.latest).map((e) => e.title)).toEqual(['B']);
    } finally {
      rmSync(p, { recursive: true, force: true });
    }
  });

  it('markOld marca solo las anteriores, conserva el resto byte a byte y omite lo no UTF-8', async () => {
    const p = join(tmp, 'limpieza');
    const q = join(tmp, 'otro');
    mkdirSync(hist(p), { recursive: true });
    mkdirSync(hist(q), { recursive: true });
    try {
      const ultima = '# Última\n\nFecha: 2026-11-01 10:00\n\n## Pendiente de ti\n\n- Vigente.\n';
      const crlf = '# Vieja CRLF\r\n\r\nFecha: 2026-10-20 10:00\r\n\r\n## Pendiente de ti\r\n\r\n- Uno\r\n  sigue.\r\n- [x] Hecho. (hecho 2026-10-21)\r\n\r\n## Otra\r\n\r\n- No es pendiente.\r\n';
      const latin1 = Buffer.from('# Año\n\nFecha: 2026-10-10 10:00\n\n## Pendiente de ti\n\n- Configuración.\n', 'latin1');
      escribir(p, '2026-11-01-1000-ultima.md', ultima);
      escribir(p, '2026-10-31-1000-vieja.md', ENTRADA.replace('2026-10-31 00:27', '2026-10-31 10:00'));
      escribir(p, '2026-10-20-1000-crlf.md', crlf);
      writeFileSync(join(hist(p), '2026-10-10-1000-latin1.md'), latin1);
      escribir(p, '2026-10-05-1000-hecha.md', '# Hecha\n\nFecha: 2026-10-05 10:00\n\n## Pendiente de ti\n\n- [x] Nada. (hecho 2026-10-06)\n');
      chmodSync(join(hist(p), '2026-10-20-1000-crlf.md'), 0o640);
      const vOtro = '# Vieja de otro\n\nFecha: 2026-10-01 10:00\n\n## Pendiente de ti\n\n- Ajeno.\n';
      escribir(q, '2026-10-01-1000-vieja.md', vOtro);
      escribir(q, '2026-10-02-1000-ultima.md', '# Última de otro\n\nFecha: 2026-10-02 10:00\n');

      const s = new HistoryStore();
      const proyectosL = [{ id: 'limpieza', path: p }];
      // Calienta la caché para comprobar que se invalida tras escribir.
      await s.list(proyectosL);
      const r = await s.markOld(proyectosL, '2026-11-01');
      expect(r).toEqual({
        marked: 3,
        entries: 2,
        skipped: [{ project: 'limpieza', file: '2026-10-10-1000-latin1.md', reason: 'La entrada no está en UTF-8; no se puede marcar sin alterarla.' }],
        projects: ['limpieza'],
      });
      expect(readFileSync(join(hist(p), '2026-11-01-1000-ultima.md'), 'utf8')).toBe(ultima);
      expect(readFileSync(join(hist(p), '2026-10-20-1000-crlf.md'), 'utf8')).toBe(
        crlf.replace('- Uno\r\n  sigue.\r\n', '- [x] Uno\r\n  sigue. (hecho 2026-11-01)\r\n'),
      );
      expect(statSync(join(hist(p), '2026-10-20-1000-crlf.md')).mode & 0o777).toBe(0o640);
      expect(readFileSync(join(hist(p), '2026-10-31-1000-vieja.md'), 'utf8')).toBe(
        markAllPending(ENTRADA.replace('2026-10-31 00:27', '2026-10-31 10:00'), '2026-11-01').text,
      );
      expect(readFileSync(join(hist(p), '2026-10-10-1000-latin1.md')).equals(latin1)).toBe(true);
      // Otro proyecto sin pedir no se toca.
      expect(readFileSync(join(hist(q), '2026-10-01-1000-vieja.md'), 'utf8')).toBe(vOtro);
      const tras = await s.list(proyectosL);
      expect(tras.filter((e) => e.openPending > 0).map((e) => e.file)).toEqual(['2026-11-01-1000-ultima.md', '2026-10-10-1000-latin1.md']);
      // Repetir no marca nada más y vuelve a omitir la no UTF-8.
      expect(await s.markOld(proyectosL, '2026-11-02')).toMatchObject({ marked: 0, entries: 0, projects: [] });
      // Sin proyecto concreto, todos los indicados.
      expect(await s.markOld([...proyectosL, { id: 'otro', path: q }], '2026-11-01')).toMatchObject({ marked: 1, entries: 1, projects: ['otro'] });
    } finally {
      rmSync(p, { recursive: true, force: true });
      rmSync(q, { recursive: true, force: true });
    }
  });
});

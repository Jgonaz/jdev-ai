import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirStore } from './dirstore.ts';

describe('DirStore', () => {
  let dir: string;
  let avisos: number;
  let store: DirStore<{ id: string; n: number }>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jdev-dirstore-'));
    avisos = 0;
    store = new DirStore({
      dir,
      ext: '.json',
      maxBytes: 100,
      parse: (c, _m, id) => {
        try {
          const o = JSON.parse(c) as { n?: unknown };
          return typeof o.n === 'number' ? { id, n: o.n } : null;
        } catch {
          return null;
        }
      },
      onChange: () => avisos++,
      pollMs: 100,
    });
  });
  afterEach(() => {
    store.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lee los archivos válidos por session_id e ignora ocultos, temporales, inválidos, enormes y enlaces', async () => {
    const fuera = join(dir, 'fuera.txt');
    writeFileSync(fuera, '{"n":9}');
    writeFileSync(join(dir, 'a-1.json'), '{"n":1}');
    writeFileSync(join(dir, 'b-2.json'), 'no es json');
    writeFileSync(join(dir, 'c-3.json'), `{"n":3,"x":"${'y'.repeat(200)}"}`);
    writeFileSync(join(dir, '.tmp.abc.json'), '{"n":4}');
    writeFileSync(join(dir, 'd-5.jsonl'), '{"n":5}');
    symlinkSync(fuera, join(dir, 'e-6.json'));
    await store.start();
    expect([...store.snapshot()]).toEqual([['a-1', { id: 'a-1', n: 1 }]]);
  });

  it('avisa al cambiar, no al relanzar sin cambios, y olvida lo que se borra', async () => {
    writeFileSync(join(dir, 'a-1.json'), '{"n":1}');
    await store.start();
    const inicial = avisos;
    await store.refresh();
    expect(avisos).toBe(inicial);

    writeFileSync(join(dir, 'a-1.json'), '{"n":2}');
    // Un cambio de contenido con el mismo tamaño se nota por la fecha.
    utimesSync(join(dir, 'a-1.json'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    await vi.waitFor(() => expect(store.snapshot().get('a-1')?.n).toBe(2));
    expect(avisos).toBeGreaterThan(inicial);

    rmSync(join(dir, 'a-1.json'));
    await vi.waitFor(() => expect(store.snapshot().size).toBe(0));
  });

  it('empieza sin el directorio y lo recoge cuando aparece', async () => {
    rmSync(dir, { recursive: true });
    await store.start();
    expect(store.snapshot().size).toBe(0);
    mkdirSync(dir);
    writeFileSync(join(dir, 'a-1.json'), '{"n":1}');
    await vi.waitFor(() => expect(store.snapshot().get('a-1')?.n).toBe(1));
  });

  it('remove borra el archivo de la sesión y solo ese', async () => {
    writeFileSync(join(dir, 'a-1.json'), '{"n":1}');
    writeFileSync(join(dir, 'b-2.json'), '{"n":2}');
    await store.start();
    await store.remove('a-1');
    expect(existsSync(join(dir, 'a-1.json'))).toBe(false);
    expect(existsSync(join(dir, 'b-2.json'))).toBe(true);
    expect([...store.snapshot().keys()]).toEqual(['b-2']);
    // Un id no válido no toca nada fuera del directorio.
    writeFileSync(join(dir, '..', 'jdev-dirstore-ajeno.json'), '{}');
    await store.remove('../jdev-dirstore-ajeno');
    expect(existsSync(join(dir, '..', 'jdev-dirstore-ajeno.json'))).toBe(true);
    rmSync(join(dir, '..', 'jdev-dirstore-ajeno.json'));
  });
});

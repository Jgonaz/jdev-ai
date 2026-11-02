import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isStateFileName, readStateFile } from './usage.ts';

export type DirStoreOptions<T> = {
  /** Directorio con un archivo `<session_id><ext>` por sesión. */
  dir: string;
  ext: '.json' | '.jsonl';
  maxBytes: number;
  /** Convierte el contenido de la sesión `id`; null si no es válido. `mtimeMs` es la última escritura del archivo. */
  parse: (contenido: string, mtimeMs: number, id: string) => T | null;
  onChange: () => void;
  pollMs?: number;
};

const POLL_MS = 5000;
const DEBOUNCE_MS = 50;

/**
 * Lee y vigila un directorio de estado con un archivo por sesión (statusline/ y
 * activity/). Igual que StateStore: fs.watch con debounce y una relectura
 * periódica de respaldo. Solo relee los archivos que cambian y los lee con
 * readStateFile (nombre validado, sin enlaces simbólicos, tamaño máximo); los
 * que no se pueden leer o no son válidos se ignoran. Los datos se indexan por el
 * session_id del nombre del archivo.
 */
export class DirStore<T> {
  private readonly o: DirStoreOptions<T>;
  private readonly cache = new Map<string, { mtimeMs: number; size: number; value: T | null }>();
  private items = new Map<string, T>();
  private signature = '';
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = true;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(opts: DirStoreOptions<T>) {
    this.o = opts;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.tryWatch();
    await this.refresh();
    this.poll = setInterval(() => {
      this.tryWatch();
      void this.refresh();
    }, this.o.pollMs ?? POLL_MS);
    this.poll.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.poll) clearInterval(this.poll);
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.poll = this.debounce = this.watcher = null;
  }

  /** Último contenido leído (no relee), por session_id. */
  snapshot(): ReadonlyMap<string, T> {
    return this.items;
  }

  /** Borra el archivo de una sesión (si existe) y lo olvida. */
  async remove(sessionId: string): Promise<void> {
    const nombre = `${sessionId}${this.o.ext}`;
    if (!isStateFileName(nombre, this.o.ext)) return;
    await unlink(join(this.o.dir, nombre)).catch(() => {});
    this.cache.delete(nombre);
    if (this.items.delete(sessionId)) this.signature = this.firma();
  }

  private tryWatch(): void {
    if (this.watcher || this.stopped) return;
    try {
      this.watcher = watch(this.o.dir, { persistent: false }, () => this.schedule());
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // El directorio aún no existe: lo reintenta la relectura periódica.
    }
  }

  private schedule(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.refresh();
    }, DEBOUNCE_MS);
    this.debounce.unref();
  }

  /** Relee el directorio; avisa solo si algo cambió. Las llamadas se serializan. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.load();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private firma(): string {
    return [...this.cache].map(([n, c]) => `${n}:${c.mtimeMs}:${c.size}:${c.value === null ? 0 : 1}`).sort().join('|');
  }

  private async load(): Promise<void> {
    let nombres: string[];
    try {
      nombres = (await readdir(this.o.dir)).filter((n) => isStateFileName(n, this.o.ext));
    } catch {
      nombres = [];
    }
    const vistos = new Set<string>();
    const items = new Map<string, T>();
    for (const nombre of nombres) {
      vistos.add(nombre);
      try {
        const st = await stat(join(this.o.dir, nombre));
        let c = this.cache.get(nombre);
        if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
          const leido = await readStateFile(this.o.dir, nombre, this.o.ext, this.o.maxBytes);
          c = {
            mtimeMs: leido?.mtimeMs ?? st.mtimeMs,
            size: leido?.size ?? st.size,
            value: leido ? this.o.parse(leido.texto, leido.mtimeMs, nombre.slice(0, -this.o.ext.length)) : null,
          };
          this.cache.set(nombre, c);
        }
        if (c.value !== null) items.set(nombre.slice(0, -this.o.ext.length), c.value);
      } catch {
        // Desapareció entre readdir y stat o está a medio renombrar: se ignora.
      }
    }
    for (const k of this.cache.keys()) if (!vistos.has(k)) this.cache.delete(k);

    const firma = this.firma();
    this.items = items;
    if (firma !== this.signature) {
      this.signature = firma;
      if (!this.stopped) this.o.onChange();
    }
  }
}

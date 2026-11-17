import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';

export type ProjectsWatcherOptions = {
  /** `<harness>/projects`. */
  dir: string;
  onChange: () => void;
  /** Relectura periódica de respaldo: fs.watch no avisa en todos los sistemas (p. ej., en /mnt de WSL). */
  fallbackMs?: number;
  debounceMs?: number;
};

const FALLBACK_MS = 15000;
const DEBOUNCE_MS = 300;

/**
 * Firma de lo que hay en `projects/`: cada subcarpeta, si es un repositorio
 * (tiene `.git`) y, para las carpetas `*.worktrees`, sus worktrees. Cambia al
 * crear, clonar, renombrar o borrar un proyecto o un worktree.
 */
export function projectsSignature(dir: string): string {
  let nombres: string[];
  try {
    nombres = readdirSync(dir).sort();
  } catch {
    return '';
  }
  const partes: string[] = [];
  for (const n of nombres) {
    const ruta = join(dir, n);
    try {
      if (!statSync(ruta).isDirectory()) continue;
    } catch {
      continue;
    }
    if (n.endsWith('.worktrees')) {
      const hijos = (() => {
        try {
          return readdirSync(ruta).filter((h) => existsSync(join(ruta, h, '.git'))).sort();
        } catch {
          return [];
        }
      })();
      partes.push(`${n}[${hijos.join(',')}]`);
    } else {
      partes.push(`${n}${existsSync(join(ruta, '.git')) ? '+git' : ''}`);
    }
  }
  return partes.join('|');
}

/**
 * Vigila `projects/` para que un proyecto nuevo aparezca en el panel sin
 * recargar. fs.watch (no recursivo) con debounce y una relectura periódica de
 * respaldo; solo avisa cuando la firma cambia de verdad.
 */
export class ProjectsWatcher {
  private readonly o: ProjectsWatcherOptions;
  private firma = '';
  private watcher: FSWatcher | null = null;
  private poll: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(o: ProjectsWatcherOptions) {
    this.o = o;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.firma = projectsSignature(this.o.dir);
    this.vigilar();
    this.poll = setInterval(() => this.comprobar(), this.o.fallbackMs ?? FALLBACK_MS);
    this.poll.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.poll) clearInterval(this.poll);
    if (this.debounce) clearTimeout(this.debounce);
    this.watcher?.close();
    this.poll = this.debounce = this.watcher = null;
  }

  private vigilar(): void {
    if (this.watcher || this.stopped) return;
    try {
      this.watcher = watch(this.o.dir, { persistent: false }, () => this.programar());
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = null;
      });
    } catch {
      // Sin `projects/` o sin fs.watch: queda la relectura periódica.
      this.watcher = null;
    }
  }

  private programar(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.comprobar();
    }, this.o.debounceMs ?? DEBOUNCE_MS);
    this.debounce.unref();
  }

  private comprobar(): void {
    if (this.stopped) return;
    // Si `projects/` no existía al arrancar, se empieza a vigilar en cuanto aparece.
    this.vigilar();
    const firma = projectsSignature(this.o.dir);
    if (firma === this.firma) return;
    this.firma = firma;
    this.o.onChange();
  }
}

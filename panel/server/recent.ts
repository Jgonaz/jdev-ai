import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { openRegularFile } from './safefile.ts';
import type { Project } from './projects.ts';
import { TitleReader, bestTitle, parseTitle } from './titles.ts';

// Sesiones recientes de Claude Code que se pueden retomar en el panel. Claude
// guarda cada conversación en <configDir>/projects/<slug>/<sessionId>.jsonl,
// donde <slug> es la ruta absoluta del directorio de trabajo con cada carácter
// que no sea [A-Za-z0-9] sustituido por «-». El checkout principal de un
// proyecto y cada uno de sus worktrees tienen su propia carpeta.

const HORA = 60 * 60 * 1000;

/** Solo se listan las sesiones con actividad en los últimos 30 días. */
export const RECENT_MAX_AGE_MS = 30 * 24 * HORA;
/** Máximo de sesiones recientes por proyecto (checkout principal y worktrees juntos). */
export const RECENT_MAX_PER_PROJECT = 15;
/** Máximo de conversaciones archivadas por proyecto: su cuota es aparte, no gasta la de las demás. */
export const RECENT_MAX_ARCHIVED_PER_PROJECT = 15;
/** Una sesión modificada hace menos de esto puede seguir abierta en otra ventana. */
export const POSSIBLY_OPEN_MS = 3 * 60 * 1000;
/**
 * Una sesión sin mensajes (solo metadatos de arranque o un título) no sirve para
 * retomar. Criterio barato: se busca una línea `"type":"user"` o
 * `"type":"assistant"` en los primeros MESSAGE_PROBE_BYTES del transcript; si el
 * archivo es mayor y no aparece, se da por no vacío (no merece más lectura).
 */
export const MESSAGE_PROBE_BYTES = 256 * 1024;

const MESSAGE_LINE = /"type":\s*"(?:user|assistant)"/;
// Los transcripts de sesión se llaman <uuid>.jsonl; otros (p. ej. agent-*.jsonl) se ignoran.
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type RecentSession = {
  id: string;
  project: string;
  /** Nombre del worktree ('' en el checkout principal). */
  worktree: string;
  title: string;
  closed: boolean;
  /** mtime del transcript, en milisegundos desde la época. */
  lastActivity: number;
  /** Actividad en los últimos POSSIBLY_OPEN_MS: podría seguir abierta en otra ventana. */
  possiblyOpen: boolean;
  sizeBytes: number;
};

/** Slug de la carpeta de transcripts de Claude para un directorio de trabajo. */
export function projectSlug(ruta: string): string {
  return ruta.replace(/[^A-Za-z0-9]/g, '-');
}

type Location = { project: string; worktree: string; dir: string };

type Candidate = { id: string; path: string; location: Location; mtimeMs: number; size: number };

type MessageProbe = { mtimeMs: number; size: number; has: boolean };

export type RecentIndexOptions = {
  /** <configDir>/projects de Claude. */
  projectsDir: string;
  titles?: TitleReader;
  now?: () => number;
};

export class RecentIndex {
  private readonly projectsDir: string;
  private readonly titles: TitleReader;
  private readonly now: () => number;
  private readonly probes = new Map<string, MessageProbe>();

  constructor(opts: RecentIndexOptions) {
    this.projectsDir = opts.projectsDir;
    this.titles = opts.titles ?? new TitleReader();
    this.now = opts.now ?? Date.now;
  }

  // Una carpeta de transcripts por checkout principal y por worktree existente;
  // los worktrees de proyectos que ya no existen quedan fuera al partir de la lista actual.
  private locations(projects: readonly Project[]): Location[] {
    return projects.flatMap((p) => [
      { project: p.id, worktree: '', dir: join(this.projectsDir, projectSlug(p.path)) },
      ...p.worktrees.map((w) => ({ project: p.id, worktree: w.name, dir: join(this.projectsDir, projectSlug(w.path)) })),
    ]);
  }

  private async candidates(location: Location): Promise<Candidate[]> {
    let nombres: string[];
    try {
      nombres = await readdir(location.dir);
    } catch {
      return [];
    }
    const resultado = await Promise.all(
      nombres
        .filter((n) => n.endsWith('.jsonl') && SESSION_ID.test(n.slice(0, -'.jsonl'.length)))
        .map(async (n): Promise<Candidate | null> => {
          const path = join(location.dir, n);
          try {
            const st = await stat(path);
            // Las subcarpetas (subagentes) no cuentan: solo los archivos directos.
            if (!st.isFile()) return null;
            return { id: n.slice(0, -'.jsonl'.length), path, location, mtimeMs: st.mtimeMs, size: st.size };
          } catch {
            return null;
          }
        }),
    );
    return resultado.filter((c) => c !== null);
  }

  private async hasMessages(c: Candidate): Promise<boolean> {
    if (c.size === 0) return false;
    const previo = this.probes.get(c.path);
    if (previo && previo.mtimeMs === c.mtimeMs && previo.size === c.size) return previo.has;
    let has = false;
    try {
      const abierto = await openRegularFile(c.path);
      if (!abierto) return false;
      const fh = abierto.fh;
      try {
        const largo = Math.min(c.size, MESSAGE_PROBE_BYTES);
        const buf = Buffer.alloc(largo);
        const { bytesRead } = await fh.read(buf, 0, largo, 0);
        has = MESSAGE_LINE.test(buf.subarray(0, bytesRead).toString('utf8')) || c.size > MESSAGE_PROBE_BYTES;
      } finally {
        await fh.close();
      }
    } catch {
      return false;
    }
    this.probes.set(c.path, { mtimeMs: c.mtimeMs, size: c.size, has });
    return has;
  }

  /**
   * Sesiones recientes de los proyectos dados, de la más reciente a la más
   * antigua, sin las de `exclude` (ids que ya están en el panel), sin las
   * vacías y con los límites de RECENT_MAX_AGE_MS y RECENT_MAX_PER_PROJECT.
   * Los ids de `archived` no cuentan en ese máximo (archivar deja ver las
   * siguientes): se listan aparte, con su propio máximo, y solo dentro de los
   * últimos RECENT_MAX_AGE_MS; las más antiguas no se muestran aunque sigan archivadas.
   */
  async list(
    projects: readonly Project[],
    exclude: ReadonlySet<string> = new Set(),
    archived: Iterable<string> = [],
  ): Promise<RecentSession[]> {
    const archivadas = new Set(archived);
    const ahora = this.now();
    const porProyecto = new Map<string, Candidate[]>();
    for (const lista of await Promise.all(this.locations(projects).map((l) => this.candidates(l)))) {
      for (const c of lista) {
        if (ahora - c.mtimeMs > RECENT_MAX_AGE_MS || exclude.has(c.id)) continue;
        const propios = porProyecto.get(c.location.project) ?? [];
        propios.push(c);
        porProyecto.set(c.location.project, propios);
      }
    }

    const salida: RecentSession[] = [];
    for (const lista of porProyecto.values()) {
      lista.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
      let n = 0;
      let nArchivadas = 0;
      for (const c of lista) {
        const archivada = archivadas.has(c.id);
        if (archivada ? nArchivadas >= RECENT_MAX_ARCHIVED_PER_PROJECT : n >= RECENT_MAX_PER_PROJECT) continue;
        if (!(await this.hasMessages(c))) continue;
        const bruto = bestTitle(await this.titles.readTitles(c.path));
        const parsed = bruto === null ? null : parseTitle(bruto);
        salida.push({
          id: c.id,
          project: c.location.project,
          worktree: c.location.worktree,
          title: parsed && parsed.title !== '' ? parsed.title : `Sin título · ${c.id.slice(0, 8)}`,
          closed: parsed?.closed ?? false,
          lastActivity: Math.round(c.mtimeMs),
          possiblyOpen: ahora - c.mtimeMs < POSSIBLY_OPEN_MS,
          sizeBytes: c.size,
        });
        if (archivada) nArchivadas++;
        else n++;
      }
    }
    salida.sort((a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
    return salida;
  }

  /**
   * Proyecto y worktree al que pertenece el transcript de una sesión, o null si
   * no existe en ningún proyecto actual. No aplica los límites de `list`.
   */
  async locate(projects: readonly Project[], id: string): Promise<{ project: string; worktree: string } | null> {
    if (!SESSION_ID.test(id)) return null;
    for (const l of this.locations(projects)) {
      try {
        if ((await stat(join(l.dir, `${id}.jsonl`))).isFile()) return { project: l.project, worktree: l.worktree };
      } catch {
        // No está en esta carpeta.
      }
    }
    return null;
  }
}

import { execFile } from 'node:child_process';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Project } from './projects.ts';

const execFileAsync = promisify(execFile);

// Cambios de un «lugar» (pantalla Cambios): el checkout principal de un proyecto
// (también el del harness) o uno de sus worktrees. Para cada lugar se compara su
// carpeta de trabajo con una base:
//  - checkout principal: el punto en que se separa de su rama remota (lo que aún no
//    está subido); sin rama remota (o con HEAD separado), HEAD (solo lo que no tiene commit);
//  - worktree: el merge-base con la rama del checkout principal (lo que llevaría su PR).
// En ambos entran los archivos nuevos sin seguimiento. Solo lee: nada se escribe
// en el proyecto ni en los worktrees.

/** Tope de archivos de la lista. */
export const MAX_FILES = 2000;
/** Tamaño máximo del parche que se devuelve (bytes). */
export const MAX_PATCH_BYTES = 512 * 1024;

const GIT_TIMEOUT_MS = 15_000;
const LIST_BUFFER = 16 * 1024 * 1024;
// Un poco por encima del tope del parche: si git produce más, se corta y se avisa de «demasiado grande».
const PATCH_BUFFER = MAX_PATCH_BYTES * 2;
const BINARY_SNIFF_BYTES = 8000;
const STAT_CONCURRENCY = 16;
// Lugares de proyectos distintos que se cuentan a la vez en el resumen (cada uno lanza varios git).
const SUMMARY_CONCURRENCY = 6;

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'T' | 'U';

export type ChangedFile = {
  path: string;
  /** Ruta anterior (solo en renombrados). */
  oldPath: string | null;
  status: ChangeStatus;
  /** Líneas añadidas y quitadas; null en binarios (y en sin seguimiento demasiado grandes para contarlas). */
  added: number | null;
  deleted: number | null;
  binary: boolean;
};

/** Dónde se miran los cambios: el checkout principal del proyecto o uno de sus worktrees (por nombre). */
export type Place = { kind: 'main' } | { kind: 'wt'; name: string };

export type PlaceChanges = {
  /** Con qué se compara: la rama remota del checkout principal (`origin/main`) o, si no tiene, o en un worktree, la rama del checkout principal. */
  base: string | null;
  /** Commit de partida de la comparación (merge-base, o HEAD sin rama remota). */
  mergeBase: string;
  /** Rama remota usada como base en el checkout principal; null sin ella y en los worktrees. */
  upstream: string | null;
  files: ChangedFile[];
  /** Hay más de MAX_FILES archivos: `files` es solo el principio de la lista ordenada por ruta. */
  truncated: boolean;
  /** Archivos cambiados en total, también los que `files` no incluye. */
  total: number;
};

export type FileDiff = {
  path: string;
  oldPath: string | null;
  status: ChangeStatus;
  binary: boolean;
  tooLarge: boolean;
  /** Parche unificado; ausente en binarios y diffs demasiado grandes. */
  patch: string | null;
};

export class PlaceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PlaceError';
    this.status = status;
  }
}

type GitResult = { stdout: string; code: number };

/**
 * Ejecuta git sin shell. Sin bloqueos opcionales del índice para no tocar el
 * worktree al leerlo. Devuelve el código de salida en lugar de lanzar cuando es
 * uno de los `ok` (p. ej. 1 en `diff --no-index`); si el buffer se desborda,
 * lanza con `code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'`.
 */
async function git(dir: string, args: string[], maxBuffer: number, ok: readonly number[] = [0]): Promise<GitResult> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { code?: unknown; stdout?: unknown };
    if (typeof err.code === 'number' && ok.includes(err.code)) return { stdout: typeof err.stdout === 'string' ? err.stdout : '', code: err.code };
    throw e;
  }
}

const sinSalida = (e: unknown): boolean => (e as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

const porRuta = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Carpeta del lugar. Un worktree se resuelve por nombre entre los del proyecto: nunca se usan rutas del cliente. */
function resolvePlace(project: Project, place: Place): { dir: string } {
  if (place.kind === 'main') return { dir: project.path };
  if (project.harness) throw new PlaceError(404, 'El propio harness no usa worktrees.');
  const w = project.worktrees.find((x) => x.name === place.name);
  if (!w) throw new PlaceError(404, 'El worktree no existe.');
  return { dir: w.path };
}

// Árbol vacío de git: base de un repositorio sin ningún commit.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const lineaDe = (r: GitResult): string | null => r.stdout.trim() || null;

/** Rama remota de la rama actual de `dir` (`origin/main`), o null sin ella o con HEAD separado. */
async function upstreamOf(dir: string): Promise<string | null> {
  try {
    return lineaDe(await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 1024));
  } catch {
    return null;
  }
}

async function headOf(dir: string): Promise<string | null> {
  try {
    return lineaDe(await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], 1024, [1]));
  } catch {
    return null;
  }
}

/** Punto de separación entre dos referencias de `dir`; null si no comparten historia. */
async function mergeBase(dir: string, a: string, b: string): Promise<string | null> {
  const r = await git(dir, ['merge-base', a, b], 1024, [1]);
  return r.code === 0 ? lineaDe(r) : null;
}

/**
 * Base de la comparación de un lugar. En el checkout principal, el punto en que se
 * separa de su rama remota; sin ella (o con HEAD separado o sin historia común), HEAD,
 * o el árbol vacío si aún no hay commits. En un worktree, el merge-base con el HEAD
 * del checkout principal, así no aparece lo que la rama principal ganó después.
 */
async function baseOf(project: Project, place: Place, dir: string): Promise<{ sha: string; upstream: string | null }> {
  try {
    if (place.kind === 'main') {
      const up = await upstreamOf(dir);
      if (up) {
        const sha = await mergeBase(dir, '@{u}', 'HEAD');
        if (sha) return { sha, upstream: up };
      }
      return { sha: (await headOf(dir)) ?? EMPTY_TREE, upstream: null };
    }
    const principal = await headOf(project.path);
    if (!principal) throw new PlaceError(409, 'El checkout principal no tiene ningún commit con el que comparar.');
    const sha = await mergeBase(dir, principal, 'HEAD');
    if (!sha) {
      throw new PlaceError(
        409,
        `La rama del worktree no comparte historia con ${project.branch ?? 'la rama principal'}, así que no hay punto de partida con el que comparar.`,
      );
    }
    return { sha, upstream: null };
  } catch (e) {
    if (e instanceof PlaceError) throw e;
    throw new PlaceError(500, 'No se pudo calcular el punto de partida con git.');
  }
}

type Entrada = { status: ChangeStatus; path: string; oldPath: string | null };

/** Salida de `git diff -z --name-status`: `M\0ruta\0`, y `R100\0antigua\0nueva\0` en renombrados. */
export function parseNameStatus(salida: string): Entrada[] {
  const t = salida.split('\0');
  const out: Entrada[] = [];
  for (let i = 0; i < t.length; ) {
    const s = t[i++]!;
    if (s === '') continue;
    const letra = s[0]!;
    if (letra === 'R' || letra === 'C') {
      const antigua = t[i++];
      const nueva = t[i++];
      if (antigua === undefined || nueva === undefined) break;
      // Una copia no se produce con -M, pero si llegara se muestra como archivo nuevo.
      out.push(letra === 'R' ? { status: 'R', path: nueva, oldPath: antigua } : { status: 'A', path: nueva, oldPath: null });
      continue;
    }
    const ruta = t[i++];
    if (ruta === undefined) break;
    // «U» de git es un conflicto sin resolver; en esta vista «U» es «sin seguimiento», así que se muestra como modificado.
    const status: ChangeStatus = letra === 'A' || letra === 'D' || letra === 'T' ? letra : 'M';
    out.push({ status, path: ruta, oldPath: null });
  }
  return out;
}

/** Salida de `git diff -z --numstat`: `+\t-\truta\0`, y `+\t-\t\0antigua\0nueva\0` en renombrados. Por ruta nueva. */
export function parseNumstat(salida: string): Map<string, { added: number | null; deleted: number | null; binary: boolean }> {
  const t = salida.split('\0');
  const out = new Map<string, { added: number | null; deleted: number | null; binary: boolean }>();
  for (let i = 0; i < t.length; ) {
    const r = t[i++]!;
    if (r === '') continue;
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(r);
    if (!m) continue;
    let ruta = m[3]!;
    if (ruta === '') {
      i++; // ruta antigua
      ruta = t[i++] ?? '';
    }
    const binary = m[1] === '-';
    out.set(ruta, { added: binary ? null : Number(m[1]), deleted: binary ? null : Number(m[2]), binary });
  }
  return out;
}

/** Líneas de un archivo nuevo sin seguimiento y si es binario (un NUL en los primeros 8000 bytes, como git). */
async function untrackedStat(raiz: string, ruta: string): Promise<Pick<ChangedFile, 'added' | 'deleted' | 'binary'>> {
  try {
    const abs = join(raiz, ruta);
    const s = await lstat(abs);
    // Un enlace simbólico es, para git, un archivo de una línea con su destino; no se sigue.
    if (s.isSymbolicLink()) return { added: 1, deleted: 0, binary: false };
    if (!s.isFile()) return { added: null, deleted: null, binary: false };
    const fh = await open(abs, 'r');
    try {
      const muestra = Buffer.alloc(Math.min(s.size, BINARY_SNIFF_BYTES));
      await fh.read(muestra, 0, muestra.length, 0);
      if (muestra.includes(0)) return { added: null, deleted: null, binary: true };
      // Demasiado grande para mostrarlo: no se lee entero solo para contar sus líneas.
      if (s.size > MAX_PATCH_BYTES) return { added: null, deleted: null, binary: false };
      const cuerpo = await fh.readFile();
      let lineas = 0;
      for (const b of cuerpo) if (b === 10) lineas++;
      if (cuerpo.length > 0 && cuerpo[cuerpo.length - 1] !== 10) lineas++;
      return { added: lineas, deleted: 0, binary: false };
    } finally {
      await fh.close();
    }
  } catch {
    return { added: null, deleted: null, binary: false };
  }
}

async function enParalelo<T, R>(items: readonly T[], f: (x: T) => Promise<R>, limite = STAT_CONCURRENCY): Promise<R[]> {
  const out = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    for (let i = siguiente++; i < items.length; i = siguiente++) out[i] = await f(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return out;
}

type Opciones = {
  /** Líneas añadidas y quitadas de los archivos con seguimiento (`--numstat`). */
  numstat: boolean;
  /** Líneas de los archivos sin seguimiento, leyéndolos. */
  untracked: boolean;
};

async function collect(project: Project, place: Place, op: Opciones): Promise<PlaceChanges> {
  const wt = { path: resolvePlace(project, place).dir };
  const { sha: mb, upstream } = await baseOf(project, place, wt.path);
  const comunes = ['diff', '-z', '-M', '--no-ext-diff', '--no-textconv', '--no-color'];
  let nombres: string;
  let numstat = '';
  let sinSeguimiento: string;
  try {
    [nombres, numstat, sinSeguimiento] = await Promise.all([
      git(wt.path, [...comunes, '--name-status', mb], LIST_BUFFER).then((r) => r.stdout),
      op.numstat ? git(wt.path, [...comunes, '--numstat', mb], LIST_BUFFER).then((r) => r.stdout) : Promise.resolve(''),
      git(wt.path, ['ls-files', '-z', '--others', '--exclude-standard'], LIST_BUFFER).then((r) => r.stdout),
    ]);
  } catch (e) {
    if (sinSalida(e)) throw new PlaceError(500, 'La lista de cambios es demasiado grande.');
    throw new PlaceError(500, 'No se pudieron calcular los cambios con git.');
  }

  const stats = parseNumstat(numstat);
  const porPath = new Map<string, ChangedFile>();
  for (const e of parseNameStatus(nombres)) {
    const s = stats.get(e.path);
    porPath.set(e.path, { ...e, added: s?.added ?? null, deleted: s?.deleted ?? null, binary: s?.binary ?? false });
  }
  // Un enlace de ls-files que acaba en «/» es un repositorio anidado, no un archivo.
  for (const p of sinSeguimiento.split('\0')) {
    if (p === '' || p.endsWith('/') || porPath.has(p)) continue;
    porPath.set(p, { path: p, oldPath: null, status: 'U', added: null, deleted: null, binary: false });
  }

  const ordenados = [...porPath.values()].sort((a, b) => porRuta(a.path, b.path));
  const files = ordenados.slice(0, MAX_FILES);
  if (op.untracked) {
    const nuevos = files.filter((f) => f.status === 'U');
    const medidas = await enParalelo(nuevos, (f) => untrackedStat(wt.path, f.path));
    nuevos.forEach((f, i) => Object.assign(f, medidas[i]));
  }
  return { base: upstream ?? project.branch, mergeBase: mb, upstream, files, truncated: ordenados.length > MAX_FILES, total: ordenados.length };
}

/** Archivos que cambia un lugar (checkout principal o worktree por nombre) frente a su base. */
export function placeChanges(project: Project, place: Place): Promise<PlaceChanges> {
  return collect(project, place, { numstat: true, untracked: true });
}

/** Cuántos archivos cambia el lugar (para pestañas y barra lateral); null si git falla. */
export async function placeChangeCount(project: Project, place: Place): Promise<number | null> {
  try {
    return (await collect(project, place, { numstat: false, untracked: false })).total;
  } catch {
    return null;
  }
}

/**
 * Diff de un archivo de un lugar. Solo se acepta una ruta presente en la lista
 * de cambios recién calculada; cualquier otra (incluidas `../…`) es un 404 sin
 * leer nada.
 */
export async function placeFileDiff(project: Project, place: Place, path: string): Promise<FileDiff> {
  const lista = await collect(project, place, { numstat: true, untracked: false });
  const f = lista.files.find((x) => x.path === path);
  if (!f) throw new PlaceError(404, 'Ese archivo no está entre los cambios de ese lugar.');
  const base = { path: f.path, oldPath: f.oldPath, status: f.status };
  if (f.binary) return { ...base, binary: true, tooLarge: false, patch: null };

  const wt = { path: resolvePlace(project, place).dir };
  const comunes = ['--no-ext-diff', '--no-textconv', '--no-color'];
  let salida: string;
  try {
    // Sin seguimiento: contra un archivo vacío (código 1 = hay diferencias, no error).
    salida =
      f.status === 'U'
        ? (await git(wt.path, ['diff', '--no-index', ...comunes, '--', '/dev/null', f.path], PATCH_BUFFER, [1])).stdout
        : (await git(wt.path, ['diff', '-M', ...comunes, lista.mergeBase, '--', f.path, ...(f.oldPath ? [f.oldPath] : [])], PATCH_BUFFER)).stdout;
  } catch (e) {
    if (sinSalida(e)) return { ...base, binary: false, tooLarge: true, patch: null };
    throw new PlaceError(500, 'No se pudo calcular el diff del archivo con git.');
  }
  if (/^Binary files .* differ$/m.test(salida) || salida.includes('\nGIT binary patch\n')) return { ...base, binary: true, tooLarge: false, patch: null };
  if (Buffer.byteLength(salida) > MAX_PATCH_BYTES) return { ...base, binary: false, tooLarge: true, patch: null };
  return { ...base, binary: false, tooLarge: false, patch: salida };
}

// ---------------------------------------------------------------- Resumen

/** Datos de un lugar para las pestañas y la barra del lugar. */
export type PlaceInfo = {
  branch: string | null;
  /** Rama remota (solo en el checkout principal, y solo si la rama la tiene). */
  upstream: string | null;
  /** Commits por delante y por detrás: en `main`, de su rama remota (null sin ella); en un worktree, de la rama principal. */
  ahead: number | null;
  behind: number | null;
  /** Hay cambios sin commit (incluidos archivos sin seguimiento); null si git falla. */
  dirty: boolean | null;
  /** Archivos cambiados (lo que muestran las pestañas); null si git falla. */
  changes: number | null;
  /** Nombres de tmux de las sesiones del panel que trabajan en este lugar. */
  sessions: string[];
};
export type WorktreeInfo = Omit<PlaceInfo, 'upstream'> & { name: string };
export type ChangesOverview = { base: string | null; main: PlaceInfo; worktrees: WorktreeInfo[] };

async function gitOut(dir: string, args: string[]): Promise<string | null> {
  try {
    return (await git(dir, args, 4 * 1024 * 1024)).stdout;
  } catch {
    return null;
  }
}

/** «<izquierda> <derecha>» de `rev-list --left-right --count A...B`, o null. */
async function leftRight(dir: string, a: string, b: string): Promise<{ left: number; right: number } | null> {
  const cuenta = await gitOut(dir, ['rev-list', '--left-right', '--count', `${a}...${b}`]);
  const m = cuenta ? /^(\d+)\s+(\d+)/.exec(cuenta.trim()) : null;
  return m ? { left: Number(m[1]), right: Number(m[2]) } : null;
}

/**
 * Lugares del proyecto con sus datos: el checkout principal (también el del
 * harness) y cada worktree. La rama principal es la rama actual del checkout
 * principal (la base de bin/worktree) y se compara con el HEAD de cada worktree,
 * así no hace falta que tenga rama.
 */
export async function changesOverview(
  project: Project,
  sessions: readonly { name: string; project: string; worktree: string }[],
): Promise<ChangesOverview> {
  const de = (wt: string) => sessions.filter((s) => s.project === project.id && s.worktree === wt).map((s) => s.name);
  const baseSha = await headOf(project.path);

  const main = async (): Promise<PlaceInfo> => {
    const upstream = await upstreamOf(project.path);
    const lr = upstream ? await leftRight(project.path, '@{u}', 'HEAD') : null;
    const [estado, changes] = await Promise.all([gitOut(project.path, ['status', '--porcelain']), placeChangeCount(project, { kind: 'main' })]);
    return {
      branch: project.branch,
      upstream,
      behind: lr?.left ?? null,
      ahead: lr?.right ?? null,
      dirty: estado === null ? null : estado.trim() !== '',
      changes,
      sessions: de(''),
    };
  };
  const worktree = async (w: Project['worktrees'][number]): Promise<WorktreeInfo> => {
    const lr = baseSha ? await leftRight(w.path, baseSha, 'HEAD') : null;
    const [estado, changes] = await Promise.all([gitOut(w.path, ['status', '--porcelain']), placeChangeCount(project, { kind: 'wt', name: w.name })]);
    return {
      name: w.name,
      branch: w.branch,
      behind: lr?.left ?? null,
      ahead: lr?.right ?? null,
      dirty: estado === null ? null : estado.trim() !== '',
      changes,
      sessions: de(w.name),
    };
  };
  const [principal, worktrees] = await Promise.all([main(), Promise.all(project.worktrees.map(worktree))]);
  return { base: project.branch, main: principal, worktrees };
}

/**
 * Archivos cambiados por proyecto (checkout principal más worktrees), para la barra
 * lateral. Cada lugar se cuenta sin numstat y con un máximo de lugares a la vez;
 * null si ninguno se pudo calcular.
 */
export async function changesSummary(projects: readonly Project[]): Promise<Record<string, number | null>> {
  const tareas = projects.flatMap((p) => [
    { id: p.id, project: p, place: { kind: 'main' } as Place },
    ...p.worktrees.map((w) => ({ id: p.id, project: p, place: { kind: 'wt', name: w.name } as Place })),
  ]);
  const cuentas = await enParalelo(tareas, (t) => placeChangeCount(t.project, t.place), SUMMARY_CONCURRENCY);
  const out: Record<string, number | null> = Object.fromEntries(projects.map((p) => [p.id, null]));
  tareas.forEach((t, i) => {
    const n = cuentas[i]!;
    if (n !== null) out[t.id] = (out[t.id] ?? 0) + n;
  });
  return out;
}

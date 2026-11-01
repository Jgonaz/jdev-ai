import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogError, ITEM_ID_RE, isBacklogState } from './backlog.ts';
import type { BacklogState } from './backlog.ts';

// «Confirmar cambios» del backlog: vista previa y commit solo de docs/backlog/
// con push opcional. Los hooks del proyecto se respetan siempre (nunca
// --no-verify) y su salida se devuelve tal cual para mostrarla.

const BACKLOG_PATH = 'docs/backlog';
export const MAX_MESSAGE = 10_000;
/** Los pre-commit y pre-push de algunos proyectos lanzan pruebas largas. */
export const LONG_TIMEOUT_MS = 10 * 60 * 1000;
const SHORT_TIMEOUT_MS = 30_000;
/** Salida máxima que se conserva (el final, que es donde suele estar el error). */
const MAX_OUTPUT = 256 * 1024;
const SUBJECT_MAX = 72;
const PREFIX = 'docs(backlog): ';

export type CommitFileStatus = 'moved' | 'modified' | 'added' | 'deleted';
export type CommitFile = { status: CommitFileStatus; path: string; from?: string };

export type CommitPreview = {
  /** Rama actual; null con HEAD detached. */
  branch: string | null;
  detached: boolean;
  /** Rama de seguimiento (p. ej. `origin/main`) o null. */
  upstream: string | null;
  /** Remoto al que se subiría: el de la rama de seguimiento o el remoto por defecto. */
  remote: string | null;
  files: CommitFile[];
  message: string;
  /** Huella de la lista de archivos: el commit se rechaza si ha cambiado desde la vista previa. */
  fingerprint: string;
};

export type CommitPhase = 'commit' | 'push' | 'done' | 'error';

export type CommitResult =
  | { status: 200; commit: string; pushed: boolean; output: string }
  | { status: 207; commit: string; pushed: false; error: string; output: string }
  | { status: 422; error: string; output: string };

// ------------------------------------------------------------------ Procesos

type RunResult = { code: number | null; output: string; timedOut: boolean };

// Entorno de los procesos de git: nunca piden nada por terminal ni abren un
// editor, y no heredan variables que apunten a otro repositorio.
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR']) delete env[k];
  return env;
}

/**
 * Ejecuta git sin shell, con stdout y stderr intercalados en una sola salida.
 * Va en una sesión propia (`detached`): sin terminal de control, ssh no puede
 * pedir una frase de paso y falla en lugar de colgarse, y el tiempo máximo
 * mata también a los hijos de los hooks.
 */
function run(cwd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((ok) => {
    let salida = '';
    let timedOut = false;
    const anadir = (t: Buffer) => {
      salida += t.toString('utf8');
      if (salida.length > MAX_OUTPUT * 2) salida = salida.slice(-MAX_OUTPUT);
    };
    const hijo = spawn('git', ['-C', cwd, ...args], { env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: false });
    hijo.stdout.on('data', anadir);
    hijo.stderr.on('data', anadir);
    const matar = () => {
      try {
        if (hijo.pid !== undefined) process.kill(-hijo.pid, 'SIGKILL');
      } catch {
        // Ya terminó.
      }
    };
    const t = setTimeout(() => {
      timedOut = true;
      matar();
    }, timeoutMs);
    hijo.on('error', (e) => {
      clearTimeout(t);
      ok({ code: null, output: `${salida}${e.message}\n`, timedOut });
    });
    hijo.on('close', (code) => {
      clearTimeout(t);
      const recortada = salida.length > MAX_OUTPUT ? `…\n${salida.slice(-MAX_OUTPUT)}` : salida;
      ok({ code, output: timedOut ? `${recortada}\nTiempo máximo agotado (${Math.round(timeoutMs / 60000)} min).\n` : recortada, timedOut });
    });
  });
}

async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  const r = await run(cwd, args, SHORT_TIMEOUT_MS);
  return r.code === 0 ? r.output : null;
}

// ---------------------------------------------------------------- Vista previa

/**
 * Analiza `git status --porcelain=v1 -z`. Un borrado y un añadido con el mismo
 * nombre de archivo en carpetas de estado distintas son un movimiento (el
 * nombre es la identidad del elemento), aunque no se hiciera con `git mv`.
 */
export function parsePorcelain(salida: string): CommitFile[] {
  const partes = salida.split('\0');
  const files: CommitFile[] = [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i]!;
    if (p.length < 4) continue;
    const x = p[0]!;
    const y = p[1]!;
    const path = p.slice(3);
    if (x === 'R' || x === 'C') {
      const from = partes[++i] ?? '';
      files.push(x === 'R' ? { status: 'moved', path, from } : { status: 'added', path });
    } else if (x === 'A' && y === 'D') {
      // Añadido al índice y borrado después: no queda nada que confirmar.
      continue;
    } else if (x === '?' || x === 'A') {
      files.push({ status: 'added', path });
    } else if (x === 'D' || (y === 'D' && x === ' ')) {
      files.push({ status: 'deleted', path });
    } else {
      files.push({ status: 'modified', path });
    }
  }
  // Empareja borrados y añadidos del mismo archivo.
  const nombre = (ruta: string) => ruta.slice(ruta.lastIndexOf('/') + 1);
  const resultado: CommitFile[] = [];
  const usados = new Set<CommitFile>();
  for (const f of files) {
    if (f.status !== 'added' || usados.has(f)) continue;
    const borrado = files.find((d) => d.status === 'deleted' && !usados.has(d) && nombre(d.path) === nombre(f.path));
    if (borrado) {
      usados.add(borrado);
      usados.add(f);
      resultado.push({ status: 'moved', path: f.path, from: borrado.path });
    }
  }
  for (const f of files) if (!usados.has(f)) resultado.push(f);
  return resultado.sort((a, b) => a.path.localeCompare(b.path));
}

/** Estado según la carpeta (`docs/backlog/<estado>/…`), o null fuera de ellas. */
function stateOf(ruta: string): BacklogState | null {
  const m = /^docs\/backlog\/([^/]+)\/[^/]+$/.exec(ruta);
  return m && isBacklogState(m[1]) ? m[1] : null;
}

const fileName = (ruta: string) => ruta.slice(ruta.lastIndexOf('/') + 1);
const itemId = (ruta: string): string | null => {
  const n = fileName(ruta);
  return n.endsWith('.md') && ITEM_ID_RE.test(n.slice(0, -3)) ? n.slice(0, -3) : null;
};

// Verbo del resumen según el estado destino, con el elemento o el recuento.
const VERBS: Record<BacklogState, (x: string, varios: boolean) => string> = {
  backlog: (x) => `devuelve ${x} al backlog`,
  todo: (x) => `pasa ${x} a por hacer`,
  'in-progress': (x) => `pasa ${x} a en curso`,
  done: (x, varios) => `marca ${x} como ${varios ? 'hechos' : 'hecho'}`,
  discarded: (x) => `descarta ${x}`,
};
const ORDER = ['todo', 'in-progress', 'done', 'discarded', 'backlog', 'added', 'modified', 'deleted', 'renamed'] as const;
type Group = (typeof ORDER)[number];

function groupOf(f: CommitFile): Group {
  if (f.status !== 'moved') return f.status;
  const destino = stateOf(f.path);
  return destino && destino !== stateOf(f.from ?? '') ? destino : 'renamed';
}

function phrase(g: Group, x: string, varios: boolean): string {
  if (isBacklogState(g)) return VERBS[g](x, varios);
  return { added: `añade ${x}`, modified: `actualiza ${x}`, deleted: `elimina ${x}`, renamed: `renombra ${x}` }[g];
}

function joinList(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Primera línea: `docs(backlog): <resumen>`, agrupado por estado destino y de 72 caracteres como mucho. */
export function proposeSubject(files: CommitFile[]): string {
  const grupos = new Map<Group, CommitFile[]>();
  for (const f of files) {
    const g = groupOf(f);
    grupos.set(g, [...(grupos.get(g) ?? []), f]);
  }
  const orden = ORDER.filter((g) => grupos.has(g));
  const nombre = (lista: CommitFile[], conIds: boolean) => {
    if (conIds && lista.length === 1) return itemId(lista[0]!.path) ?? fileName(lista[0]!.path);
    const n = lista.length;
    const cosa = lista.every((f) => itemId(f.path)) ? (n === 1 ? 'elemento' : 'elementos') : n === 1 ? 'archivo' : 'archivos';
    return `${n} ${cosa}`;
  };
  // Prueba primero con identificadores; si no cabe, con recuentos y, si tampoco, un resumen genérico.
  for (const conIds of [true, false]) {
    const linea = PREFIX + joinList(orden.map((g) => phrase(g, nombre(grupos.get(g)!, conIds), grupos.get(g)!.length > 1)));
    if (linea.length <= SUBJECT_MAX) return linea;
  }
  return PREFIX + phrase('modified', nombre(files, false), files.length > 1);
}

/** Un punto por archivo con qué cambió, como piden las normas de commit del harness. */
export function bulletFor(f: CommitFile): string {
  if (f.status === 'moved') {
    const de = stateOf(f.from ?? '');
    const a = stateOf(f.path);
    const que = de && a && de !== a ? `movido desde ${de} a ${a}` : `renombrado desde ${f.from}`;
    return `- ${f.path}: ${que}`;
  }
  return `- ${f.path}: ${{ modified: 'modificado', added: 'añadido', deleted: 'eliminado' }[f.status]}`;
}

/** Mensaje propuesto completo, sin líneas de coautoría: el commit lo confirma la persona. */
export function proposeMessage(files: CommitFile[]): string {
  if (files.length === 0) return '';
  return `${proposeSubject(files)}\n\n${files.map(bulletFor).join('\n')}\n`;
}

export function fingerprint(files: CommitFile[]): string {
  return createHash('sha256')
    .update(files.map((f) => `${f.status}\0${f.from ?? ''}\0${f.path}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
}

async function backlogFiles(projectPath: string): Promise<CommitFile[]> {
  const salida = await gitOut(projectPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', BACKLOG_PATH]);
  if (salida === null) throw new BacklogError(422, 'No se pudo leer el estado de Git del proyecto.');
  return parsePorcelain(salida);
}

const linea = (s: string | null) => (s === null ? null : s.trim() === '' ? null : s.trim());

/** Remoto por defecto sin rama de seguimiento: `remote.pushDefault`, `origin` o el único que haya. */
async function defaultRemote(projectPath: string): Promise<string | null> {
  const pushDefault = linea(await gitOut(projectPath, ['config', '--get', 'remote.pushDefault']));
  if (pushDefault) return pushDefault;
  const remotos = (await gitOut(projectPath, ['remote']))?.split('\n').map((r) => r.trim()).filter(Boolean) ?? [];
  if (remotos.includes('origin')) return 'origin';
  return remotos.length === 1 ? remotos[0]! : null;
}

export async function commitPreview(projectPath: string): Promise<CommitPreview> {
  const files = await backlogFiles(projectPath);
  const branch = linea(await gitOut(projectPath, ['symbolic-ref', '--short', '-q', 'HEAD']));
  let upstream: string | null = null;
  let remote: string | null = null;
  if (branch) {
    upstream = linea(await gitOut(projectPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']));
    remote = upstream
      ? (linea(await gitOut(projectPath, ['config', '--get', `branch.${branch}.pushRemote`])) ??
        linea(await gitOut(projectPath, ['config', '--get', `branch.${branch}.remote`])))
      : await defaultRemote(projectPath);
  }
  return { branch, detached: branch === null, upstream, remote, files, message: proposeMessage(files), fingerprint: fingerprint(files) };
}

// ---------------------------------------------------------------------- Commit

export type CommitRequest = { message: unknown; push: unknown; fingerprint?: unknown };

/** Valida el cuerpo del POST; lanza BacklogError(400). */
export function validateCommitRequest(c: CommitRequest): { message: string; push: boolean; fingerprint: string | null } {
  if (typeof c.message !== 'string' || c.message.trim() === '') throw new BacklogError(400, 'El mensaje del commit no puede estar vacío.');
  if (c.message.length > MAX_MESSAGE) throw new BacklogError(400, `El mensaje del commit no puede pasar de ${MAX_MESSAGE} caracteres.`);
  if (c.push !== undefined && typeof c.push !== 'boolean') throw new BacklogError(400, '«push» debe ser true o false.');
  if (c.fingerprint !== undefined && typeof c.fingerprint !== 'string') throw new BacklogError(400, 'Huella no válida.');
  return { message: c.message, push: c.push === true, fingerprint: typeof c.fingerprint === 'string' ? c.fingerprint : null };
}

/**
 * Hace commit solo de docs/backlog/ y, si se pide, push. Debe ejecutarse en la
 * cola en serie del proyecto. `git commit -- docs/backlog` limita el commit a
 * esa ruta: lo que haya en el índice fuera de ella no entra y sigue en el índice.
 */
export async function commitBacklog(
  projectPath: string,
  peticion: { message: string; push: boolean; fingerprint: string | null },
  onPhase: (fase: CommitPhase) => void = () => {},
  timeoutMs = LONG_TIMEOUT_MS,
): Promise<CommitResult> {
  const previa = await commitPreview(projectPath);
  if (previa.detached) throw new BacklogError(409, 'HEAD está separado (detached): cambia a una rama antes de confirmar los cambios.');
  if (previa.files.length === 0) throw new BacklogError(409, 'No hay cambios del backlog sin commit.');
  if (peticion.fingerprint !== null && peticion.fingerprint !== previa.fingerprint) {
    throw new BacklogError(409, 'Los cambios del backlog han cambiado desde que se abrió el diálogo: revisa la lista y el mensaje.');
  }
  if (peticion.push && !previa.remote) throw new BacklogError(409, 'El proyecto no tiene ningún remoto al que subir la rama.');

  onPhase('commit');
  const dir = await mkdtemp(join(tmpdir(), 'jdev-commit-'));
  let salida = '';
  let sha: string;
  try {
    const archivo = join(dir, 'MENSAJE');
    await writeFile(archivo, peticion.message, { encoding: 'utf8', mode: 0o600 });
    const add = await run(projectPath, ['add', '-A', '--', BACKLOG_PATH], SHORT_TIMEOUT_MS);
    salida += add.output;
    if (add.code !== 0) {
      onPhase('error');
      return { status: 422, error: 'No se pudieron añadir los cambios del backlog al índice.', output: salida };
    }
    const commit = await run(projectPath, ['commit', '-F', archivo, '--', BACKLOG_PATH], timeoutMs);
    salida += commit.output;
    if (commit.code !== 0) {
      onPhase('error');
      return {
        status: 422,
        error: commit.timedOut ? 'El commit ha superado el tiempo máximo.' : 'El commit ha fallado; no se ha creado.',
        output: salida,
      };
    }
    sha = linea(await gitOut(projectPath, ['rev-parse', '--short', 'HEAD'])) ?? '';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (!peticion.push) {
    onPhase('done');
    return { status: 200, commit: sha, pushed: false, output: salida };
  }
  onPhase('push');
  const args = previa.upstream ? ['push'] : ['push', '-u', previa.remote!, previa.branch!];
  const push = await run(projectPath, args, timeoutMs);
  salida += push.output;
  if (push.code !== 0) {
    onPhase('error');
    return {
      status: 207,
      commit: sha,
      pushed: false,
      error: push.timedOut ? 'El push ha superado el tiempo máximo; el commit sí está hecho en local.' : 'El push ha fallado; el commit sí está hecho en local.',
      output: salida,
    };
  }
  onPhase('done');
  return { status: 200, commit: sha, pushed: true, output: salida };
}

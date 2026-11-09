import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { PROJECT_PALETTE } from '../shared/settings-schema.ts';
import { resolveRun } from './devrun.ts';
import type { RunSource } from './devrun.ts';
import type { ProjectOverride, Settings } from './settings.ts';

const execFileAsync = promisify(execFile);

export const PALETTE = PROJECT_PALETTE;

export type Worktree = { name: string; path: string; branch: string | null };

export type Project = {
  id: string;
  name: string;
  path: string;
  harness: boolean;
  branch: string | null;
  worktrees: Worktree[];
  mono: string;
  color: string;
  visible: boolean;
  defaultMono: string;
  defaultColor: string;
  /** Comando de arranque efectivo (el propio de Ajustes o el de package.json); null si no hay. */
  runCommand: string | null;
  runSource: RunSource | null;
  /** Lo detectado en package.json, aunque haya un comando propio. */
  runDetected: string | null;
};

// Dos letras significativas en mayúsculas: las iniciales de las dos primeras
// palabras (separadas por -, _, ., espacios o cambios minúscula-mayúscula) y,
// si solo hay una palabra, sus dos primeras letras.
export function defaultMonogram(name: string): string {
  const palabras = name
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p !== '');
  if (palabras.length === 0) return '?';
  const letras =
    palabras.length >= 2
      ? Array.from(palabras[0]!)[0]! + Array.from(palabras[1]!)[0]!
      : Array.from(palabras[0]!).slice(0, 2).join('');
  return letras.toUpperCase();
}

// Color por orden alfabético (sin distinguir mayúsculas) de todos los
// identificadores, de modo que no cambie al ocultar o personalizar proyectos.
export function defaultColors(ids: readonly string[]): Map<string, string> {
  const ordenados = [...ids].sort((a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  return new Map(ordenados.map((id, i) => [id, PALETTE[i % PALETTE.length]!]));
}

async function currentBranch(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeout: 5000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function subdirectorios(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => {
        try {
          return statSync(join(dir, n)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

// Repositorios Git directos de <harness>/projects/ (con .git, sin las carpetas
// *.worktrees) más el propio harness. El harness va primero y no admite worktrees.
export async function listProjects(
  harnessRoot: string,
  overrides: Settings['projects'] = {},
): Promise<Project[]> {
  const projectsRoot = join(harnessRoot, 'projects');
  const harnessId = basename(harnessRoot);
  const entradas = [
    { id: harnessId, path: harnessRoot, harness: true },
    ...subdirectorios(projectsRoot)
      .filter((n) => !n.endsWith('.worktrees') && existsSync(join(projectsRoot, n, '.git')))
      .map((n) => ({ id: n, path: join(projectsRoot, n), harness: false })),
  ];
  const colores = defaultColors(entradas.map((e) => e.id));

  return Promise.all(
    entradas.map(async (e): Promise<Project> => {
      const worktreesDir = join(projectsRoot, `${e.id}.worktrees`);
      const worktrees = e.harness
        ? []
        : await Promise.all(
            subdirectorios(worktreesDir)
              .filter((n) => existsSync(join(worktreesDir, n, '.git')))
              .map(async (n) => ({
                name: n,
                path: join(worktreesDir, n),
                branch: await currentBranch(join(worktreesDir, n)),
              })),
          );
      const defaultMono = defaultMonogram(e.id);
      const defaultColor = colores.get(e.id)!;
      const ov: ProjectOverride = Object.hasOwn(overrides, e.id) ? overrides[e.id]! : {};
      const run = await resolveRun(e.path, ov.run);
      return {
        id: e.id,
        name: e.id,
        path: e.path,
        harness: e.harness,
        branch: await currentBranch(e.path),
        worktrees,
        mono: ov.mono ?? defaultMono,
        color: ov.color ?? defaultColor,
        visible: ov.visible ?? true,
        defaultMono,
        defaultColor,
        runCommand: run.command,
        runSource: run.source,
        runDetected: run.detected,
      };
    }),
  );
}

export type WorktreeDetail = Worktree & {
  /** Commits de la rama que no están en la rama principal, y al revés; null si no se pueden calcular. */
  ahead: number | null;
  behind: number | null;
  /** Hay cambios sin commit (incluidos archivos sin seguimiento); null si git falla. */
  dirty: boolean | null;
  /** Nombres de tmux de las sesiones del panel que trabajan en este worktree. */
  sessions: string[];
};

async function gitOut(dir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, ...args], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Datos ampliados de los worktrees de un proyecto. La rama principal es la
 * rama actual del checkout principal (la base de bin/worktree), y se compara
 * con el HEAD de cada worktree para no depender de que tenga rama.
 */
export async function worktreeDetails(
  project: Project,
  sessions: readonly { name: string; project: string; worktree: string }[],
): Promise<{ base: string | null; worktrees: WorktreeDetail[] }> {
  const baseSha = (await gitOut(project.path, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim() || null;
  const worktrees = await Promise.all(
    project.worktrees.map(async (w): Promise<WorktreeDetail> => {
      let ahead: number | null = null;
      let behind: number | null = null;
      if (baseSha) {
        const cuenta = await gitOut(w.path, ['rev-list', '--left-right', '--count', `${baseSha}...HEAD`]);
        const m = cuenta ? /^(\d+)\s+(\d+)/.exec(cuenta.trim()) : null;
        if (m) {
          behind = Number(m[1]);
          ahead = Number(m[2]);
        }
      }
      const estado = await gitOut(w.path, ['status', '--porcelain']);
      return {
        ...w,
        ahead,
        behind,
        dirty: estado === null ? null : estado.trim() !== '',
        sessions: sessions.filter((s) => s.project === project.id && s.worktree === w.name).map((s) => s.name),
      };
    }),
  );
  return { base: project.branch, worktrees };
}

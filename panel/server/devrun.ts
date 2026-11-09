import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { openRegularFile } from './safefile.ts';

// Comando de arranque de un proyecto (el botón ▶ de la barra lateral): el
// comando propio de Ajustes y, si no hay, el script `dev` de su package.json.

export type RunSource = 'custom' | 'detected';
export type RunInfo = {
  /** Comando efectivo; null si el proyecto no tiene ninguno. */
  command: string | null;
  source: RunSource | null;
  /** Lo detectado en package.json, haya o no comando propio. */
  detected: string | null;
};

/** Máximo de package.json que se lee. */
export const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;

const MANAGERS = ['pnpm', 'bun', 'yarn', 'npm'] as const;
type Manager = (typeof MANAGERS)[number];

const COMMANDS: Record<Manager, string> = {
  pnpm: 'pnpm dev',
  bun: 'bun dev',
  yarn: 'yarn dev',
  npm: 'npm run dev',
};

// Orden fijo cuando hay varios lockfiles.
const LOCKFILES: readonly (readonly [string, Manager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
];

/** Gestor que declara `packageManager` («pnpm@9.1.0»); null si falta o no es uno conocido. */
export function declaredManager(valor: unknown): Manager | null {
  if (typeof valor !== 'string') return null;
  const nombre = valor.split('@')[0] ?? '';
  return (MANAGERS as readonly string[]).includes(nombre) ? (nombre as Manager) : null;
}

/** Comando de `scripts.dev` según el gestor: el de `packageManager` manda sobre el lockfile. Pura, sin disco. */
export function devCommand(pkg: unknown, lockfiles: readonly string[]): string | null {
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) return null;
  const { scripts, packageManager } = pkg as { scripts?: unknown; packageManager?: unknown };
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return null;
  const dev = (scripts as Record<string, unknown>).dev;
  if (typeof dev !== 'string' || dev.trim() === '') return null;
  const gestor = declaredManager(packageManager) ?? LOCKFILES.find(([f]) => lockfiles.includes(f))?.[1] ?? 'npm';
  return COMMANDS[gestor];
}

/**
 * Detecta el comando de arranque en la carpeta principal del proyecto: lee
 * package.json (archivo regular, hasta 1 MiB, JSON válido) y mira qué lockfile
 * hay. null si no hay package.json legible o no tiene `scripts.dev`.
 */
export async function detectRunCommand(dir: string): Promise<string | null> {
  const abierto = await openRegularFile(join(dir, 'package.json'));
  if (!abierto) return null;
  let pkg: unknown;
  try {
    if (abierto.stat.size > PACKAGE_JSON_MAX_BYTES) return null;
    pkg = JSON.parse(await abierto.fh.readFile('utf8'));
  } catch {
    return null;
  } finally {
    await abierto.fh.close().catch(() => {});
  }
  const presentes: string[] = [];
  for (const [archivo] of LOCKFILES) {
    try {
      if ((await stat(join(dir, archivo))).isFile()) presentes.push(archivo);
    } catch {
      // No existe.
    }
  }
  return devCommand(pkg, presentes);
}

/** El comando propio manda sobre el detectado. */
export function pickRun(custom: string | undefined, detected: string | null): RunInfo {
  if (custom !== undefined && custom.trim() !== '') return { command: custom.trim(), source: 'custom', detected };
  return { command: detected, source: detected === null ? null : 'detected', detected };
}

export async function resolveRun(dir: string, custom: string | undefined): Promise<RunInfo> {
  return pickRun(custom, await detectRunCommand(dir));
}

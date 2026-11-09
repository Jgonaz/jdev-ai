import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PACKAGE_JSON_MAX_BYTES, declaredManager, detectRunCommand, devCommand, pickRun, resolveRun } from './devrun.ts';

const pkg = (extra: Record<string, unknown> = {}) => ({ scripts: { dev: 'vite' }, ...extra });

describe('devCommand', () => {
  it('toma el gestor del lockfile con un orden fijo y npm por defecto', () => {
    expect(devCommand(pkg(), ['pnpm-lock.yaml'])).toBe('pnpm dev');
    expect(devCommand(pkg(), ['bun.lockb'])).toBe('bun dev');
    expect(devCommand(pkg(), ['bun.lock'])).toBe('bun dev');
    expect(devCommand(pkg(), ['yarn.lock'])).toBe('yarn dev');
    expect(devCommand(pkg(), [])).toBe('npm run dev');
    // Con varios lockfiles manda el primero del orden pnpm, bun, yarn.
    expect(devCommand(pkg(), ['yarn.lock', 'bun.lock', 'pnpm-lock.yaml'])).toBe('pnpm dev');
    expect(devCommand(pkg(), ['yarn.lock', 'bun.lock'])).toBe('bun dev');
    expect(devCommand(pkg(), ['package-lock.json'])).toBe('npm run dev');
  });

  it('packageManager manda sobre el lockfile y se ignora si no es un gestor conocido', () => {
    expect(devCommand(pkg({ packageManager: 'yarn@4.1.0' }), ['pnpm-lock.yaml'])).toBe('yarn dev');
    expect(devCommand(pkg({ packageManager: 'npm@10.0.0' }), ['pnpm-lock.yaml'])).toBe('npm run dev');
    expect(devCommand(pkg({ packageManager: 'bun@1.1.0' }), [])).toBe('bun dev');
    expect(devCommand(pkg({ packageManager: 'deno@2' }), ['yarn.lock'])).toBe('yarn dev');
    expect(devCommand(pkg({ packageManager: 7 }), ['yarn.lock'])).toBe('yarn dev');
    expect(declaredManager('pnpm@9.1.0+sha512.abc')).toBe('pnpm');
    expect(declaredManager(undefined)).toBeNull();
  });

  it('exige un script dev de texto no vacío', () => {
    expect(devCommand({ scripts: {} }, [])).toBeNull();
    expect(devCommand({ scripts: { dev: '' } }, [])).toBeNull();
    expect(devCommand({ scripts: { dev: '  ' } }, [])).toBeNull();
    expect(devCommand({ scripts: { dev: 3 } }, [])).toBeNull();
    expect(devCommand({ scripts: [] }, [])).toBeNull();
    expect(devCommand({}, [])).toBeNull();
    expect(devCommand(null, [])).toBeNull();
    expect(devCommand([], [])).toBeNull();
    expect(devCommand('dev', [])).toBeNull();
  });
});

describe('detectRunCommand', () => {
  let raiz: string;
  const carpeta = (nombre: string, archivos: Record<string, string>) => {
    const dir = join(raiz, nombre);
    mkdirSync(dir);
    for (const [n, c] of Object.entries(archivos)) writeFileSync(join(dir, n), c);
    return dir;
  };
  const conDev = JSON.stringify(pkg());

  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), 'jdev-devrun-'));
  });
  afterAll(() => rmSync(raiz, { recursive: true, force: true }));

  it('lee package.json y el lockfile de la carpeta', async () => {
    expect(await detectRunCommand(carpeta('pnpm', { 'package.json': conDev, 'pnpm-lock.yaml': '' }))).toBe('pnpm dev');
    expect(await detectRunCommand(carpeta('yarn', { 'package.json': conDev, 'yarn.lock': '' }))).toBe('yarn dev');
    expect(await detectRunCommand(carpeta('npm', { 'package.json': conDev, 'package-lock.json': '' }))).toBe('npm run dev');
    expect(await detectRunCommand(carpeta('pm', { 'package.json': JSON.stringify(pkg({ packageManager: 'bun@1.2.0' })), 'pnpm-lock.yaml': '' }))).toBe('bun dev');
  });

  it('devuelve null sin package.json, sin script dev, con JSON roto o demasiado grande', async () => {
    expect(await detectRunCommand(join(raiz, 'no-existe'))).toBeNull();
    expect(await detectRunCommand(carpeta('vacia', {}))).toBeNull();
    expect(await detectRunCommand(carpeta('sin-dev', { 'package.json': JSON.stringify({ scripts: { build: 'x' } }) }))).toBeNull();
    expect(await detectRunCommand(carpeta('roto', { 'package.json': '{ no es json' }))).toBeNull();
    const grande = JSON.stringify({ scripts: { dev: 'vite' }, relleno: 'x'.repeat(PACKAGE_JSON_MAX_BYTES) });
    expect(await detectRunCommand(carpeta('grande', { 'package.json': grande }))).toBeNull();
  });

  it('no lee un package.json que no sea un archivo regular', async () => {
    const real = carpeta('real', { 'package.json': conDev });
    const enlace = join(raiz, 'enlace');
    mkdirSync(enlace);
    symlinkSync(join(real, 'package.json'), join(enlace, 'package.json'));
    expect(await detectRunCommand(enlace)).toBeNull();
    const dirComoArchivo = join(raiz, 'dir');
    mkdirSync(join(dirComoArchivo, 'package.json'), { recursive: true });
    expect(await detectRunCommand(dirComoArchivo)).toBeNull();
  });

  it('un lockfile que es una carpeta no cuenta', async () => {
    const dir = carpeta('lock-dir', { 'package.json': conDev });
    mkdirSync(join(dir, 'pnpm-lock.yaml'));
    expect(await detectRunCommand(dir)).toBe('npm run dev');
  });

  it('el comando propio manda sobre el detectado', async () => {
    const dir = carpeta('mixto', { 'package.json': conDev, 'pnpm-lock.yaml': '' });
    expect(await resolveRun(dir, undefined)).toEqual({ command: 'pnpm dev', source: 'detected', detected: 'pnpm dev' });
    expect(await resolveRun(dir, 'pnpm exec nuxt dev --port 3037')).toEqual({
      command: 'pnpm exec nuxt dev --port 3037',
      source: 'custom',
      detected: 'pnpm dev',
    });
    expect(pickRun('  ', null)).toEqual({ command: null, source: null, detected: null });
    expect(pickRun('make run', null)).toEqual({ command: 'make run', source: 'custom', detected: null });
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PALETTE, defaultColors, defaultMonogram, listProjects } from './projects.ts';

describe('monograma y color por defecto', () => {
  it('toma iniciales de palabras separadas por -, . o mayúsculas', () => {
    expect(defaultMonogram('jgonaz-portfolio')).toBe('JP');
    expect(defaultMonogram('balanz.io')).toBe('BI');
    expect(defaultMonogram('SmashAdvisor')).toBe('SA');
    expect(defaultMonogram('jdev-ai')).toBe('JA');
  });

  it('con una sola palabra usa sus dos primeras letras', () => {
    expect(defaultMonogram('fitnessia')).toBe('FI');
    expect(defaultMonogram('x')).toBe('X');
    expect(defaultMonogram('---')).toBe('?');
  });

  it('asigna colores de la paleta por orden alfabético, recorriéndola cíclicamente', () => {
    const ids = ['SmashAdvisor', 'balanz.io', 'fitnessia', 'jdev-ai', 'jgonaz-portfolio', 'zeta', 'omega'];
    const c = defaultColors(ids);
    // Orden sin distinguir mayúsculas: balanz, fitnessia, jdev-ai, jgonaz, omega, SmashAdvisor, zeta.
    expect(c.get('balanz.io')).toBe(PALETTE[0]);
    expect(c.get('fitnessia')).toBe(PALETTE[1]);
    expect(c.get('jgonaz-portfolio')).toBe(PALETTE[3]);
    expect(c.get('SmashAdvisor')).toBe(PALETTE[5]);
    expect(c.get('zeta')).toBe(PALETTE[0]);
  });
});

describe('listProjects', () => {
  let tmp: string;
  let harness: string;

  const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });

  function repo(dir: string, rama: string) {
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', rama);
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
  }

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-projects-'));
    harness = join(tmp, 'jdev-ai');
    repo(harness, 'main');
    repo(join(harness, 'projects', 'balanz.io'), 'develop');
    repo(join(harness, 'projects', 'fitnessia'), 'main');
    // Carpeta sin .git y carpeta *.worktrees con un worktree real y una carpeta suelta.
    mkdirSync(join(harness, 'projects', 'sin-git'));
    const wt = join(harness, 'projects', 'balanz.io.worktrees', 'ts7');
    mkdirSync(join(harness, 'projects', 'balanz.io.worktrees'));
    git(join(harness, 'projects', 'balanz.io'), 'worktree', 'add', '-q', '-b', 'feat/ts7', wt);
    mkdirSync(join(harness, 'projects', 'balanz.io.worktrees', 'suelta'));
    writeFileSync(join(harness, 'projects', 'fichero'), 'no es carpeta');
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('lista el harness primero y los repositorios directos, sin .worktrees ni carpetas sin .git', async () => {
    const p = await listProjects(harness);
    expect(p.map((x) => x.id)).toEqual(['jdev-ai', 'balanz.io', 'fitnessia']);
    expect(p[0]).toMatchObject({ harness: true, branch: 'main', worktrees: [], path: harness });
    expect(p[1]).toMatchObject({ harness: false, branch: 'develop', mono: 'BI', name: 'balanz.io' });
  });

  it('incluye los worktrees reales con su rama', async () => {
    const [, balanz, fitnessia] = await listProjects(harness);
    expect(balanz!.worktrees).toEqual([
      { name: 'ts7', path: join(harness, 'projects', 'balanz.io.worktrees', 'ts7'), branch: 'feat/ts7' },
    ]);
    expect(fitnessia!.worktrees).toEqual([]);
  });

  it('asigna colores por orden alfabético y aplica los overrides', async () => {
    const p = await listProjects(harness, {
      fitnessia: { mono: 'FX', color: '#010203', visible: false },
    });
    const por = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(por['balanz.io']!.color).toBe(PALETTE[0]);
    expect(por['jdev-ai']!.color).toBe(PALETTE[2]);
    expect(por.fitnessia).toMatchObject({
      mono: 'FX',
      color: '#010203',
      visible: false,
      defaultMono: 'FI',
      defaultColor: PALETTE[1],
    });
  });
});

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectsWatcher, projectsSignature } from './projects-watch.ts';

const temporales: string[] = [];
const carpeta = () => {
  const dir = mkdtempSync(join(tmpdir(), 'projects-watch-'));
  temporales.push(dir);
  return dir;
};

afterEach(() => {
  for (const d of temporales.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('projectsSignature', () => {
  it('distingue repositorios, carpetas sueltas y worktrees, y cambia al crear un proyecto', () => {
    const dir = carpeta();
    mkdirSync(join(dir, 'a', '.git'), { recursive: true });
    mkdirSync(join(dir, 'suelta'));
    mkdirSync(join(dir, 'a.worktrees', 'wt1', '.git'), { recursive: true });
    const antes = projectsSignature(dir);
    expect(antes).toBe('a+git|a.worktrees[wt1]|suelta');

    // `git init` en una carpeta que ya existía también cuenta como proyecto nuevo.
    mkdirSync(join(dir, 'suelta', '.git'));
    expect(projectsSignature(dir)).not.toBe(antes);
  });

  it('sin carpeta, firma vacía', () => {
    expect(projectsSignature(join(carpeta(), 'no-existe'))).toBe('');
  });
});

describe('ProjectsWatcher', () => {
  it('avisa cuando aparece un proyecto y no cuando nada cambia', async () => {
    const dir = carpeta();
    let avisos = 0;
    const w = new ProjectsWatcher({ dir, onChange: () => avisos++, fallbackMs: 40, debounceMs: 10 });
    w.start();
    try {
      await new Promise((r) => setTimeout(r, 120));
      expect(avisos).toBe(0);
      mkdirSync(join(dir, 'nuevo', '.git'), { recursive: true });
      await expect.poll(() => avisos, { timeout: 2000 }).toBeGreaterThan(0);
      const tras = avisos;
      await new Promise((r) => setTimeout(r, 120));
      expect(avisos).toBe(tras);
    } finally {
      w.stop();
    }
  });
});

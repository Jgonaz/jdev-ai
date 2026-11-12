import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Los seis temas definen las mismas variables, y Carbón (el tema por defecto) cumple los contrastes de texto.
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const luminancia = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contraste = (a: string, b: string): number => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const temas = new Map([...tokens.matchAll(/:root(?:,\s*:root)?\[data-theme='(\w+)'\]\s*\{([^}]*)\}/g)].map(([, nombre, cuerpo]) => [nombre!, cuerpo!] as const));
const variables = (cuerpo: string): string[] => [...cuerpo.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!);
const color = (nombre: string, variable: string): string => {
  const c = new RegExp(`${variable}:\\s*(#[0-9a-fA-F]{6})`).exec(temas.get(nombre)!)?.[1];
  if (!c) throw new Error(`${nombre}: falta ${variable}`);
  return c;
};

describe('temas', () => {
  it('hay seis temas y Carbón es también el valor por defecto sin data-theme', () => {
    expect([...temas.keys()].sort()).toEqual(['carbon', 'contraste', 'fosforo', 'grafito', 'papel', 'pizarra']);
    expect(tokens).toMatch(/:root,\s*:root\[data-theme='carbon'\]\s*\{/);
  });

  it('todos definen las mismas variables que Grafito (también las de las tarjetas y los agentes)', () => {
    const base = variables(temas.get('grafito')!);
    expect(base).toEqual(expect.arrayContaining(['--bg-card', '--bg-seg', '--bg-seg-on', '--line-card', '--line-card-active', '--agent-claude']));
    for (const [nombre, cuerpo] of temas) {
      const propias = new Set(variables(cuerpo));
      // --mono-edge y --danger-text solo los define Papel: el resto de temas los heredan de :root.
      const faltan = base.filter((v) => !propias.has(v));
      expect(faltan, nombre).toEqual([]);
    }
  });

  const PARES: readonly (readonly [string, string])[] = [
    ['--fg', '--bg'],
    ['--fg', '--bg-card'],
    ['--fg', '--bg-raised'],
    ['--fg', '--bg-seg-on'],
    ['--fg-soft', '--bg-card'],
    ['--fg-muted', '--bg'],
    ['--fg-muted', '--bg-card'],
    ['--fg-muted', '--bg-raised'],
    ['--fg-muted', '--bg-surface'],
    ['--fg-muted', '--bg-seg'],
    ['--fg-faint', '--bg'],
    ['--fg-faint', '--bg-card'],
    ['--fg-faint', '--bg-surface'],
    ['--fg-faint', '--bg-seg'],
    ['--waiting-text', '--waiting-bg'],
    ['--working-text', '--working-bg'],
    ['--working-text', '--bg-card'],
    ['--link', '--bg-card'],
    ['--term-text', '--term-bg'],
  ];
  for (const nombre of ['carbon', 'grafito', 'pizarra', 'fosforo', 'papel', 'contraste']) {
    it(`${nombre}: el texto llega a 4,5:1 sobre sus fondos`, () => {
      for (const [a, b] of PARES) expect(contraste(color(nombre, a), color(nombre, b)), `${a} sobre ${b}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('la tarjeta activa se distingue de las demás en todos los temas', () => {
    // El borde de Carbón (#45454c, del diseño) queda en 2:1: no es el único aviso (la pestaña activa va rellena), pero sí claramente más claro.
    for (const nombre of temas.keys()) {
      const activo = contraste(color(nombre, '--line-card-active'), color(nombre, '--bg-card'));
      const normal = contraste(color(nombre, '--line-card'), color(nombre, '--bg-card'));
      expect(activo, nombre).toBeGreaterThanOrEqual(2);
      expect(activo, nombre).toBeGreaterThan(normal * 1.5);
    }
  });
});

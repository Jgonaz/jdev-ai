import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Contraste de los colores de la vista de cambios de un worktree en todos los temas.
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const luminancia = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contraste = (a: string, b: string): number => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

const temas = [...tokens.matchAll(/:root(?:,\s*:root)?\[data-theme='(\w+)'\]\s*\{([^}]*)\}/g)].map(([, nombre, cuerpo]) => ({ nombre: nombre!, cuerpo: cuerpo! }));
const color = (cuerpo: string, nombre: string): string => {
  const c = new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(cuerpo)?.[1];
  if (!c) throw new Error(`falta --${nombre}`);
  return c;
};

// [texto, fondo, descripción]: lo que la vista pinta sobre cada fondo.
const PARES: readonly (readonly [string, string, string])[] = [
  ['fg-soft', 'diff-gap-a', 'código de contexto'],
  ['fg', 'diff-add-bg', 'código añadido'],
  ['fg', 'diff-del-bg', 'código quitado'],
  ['diff-add', 'diff-add-bg', 'signo +'],
  ['diff-del', 'diff-del-bg', 'signo −'],
  ['diff-num', 'diff-gap-a', 'número de línea'],
  ['diff-num-add', 'diff-add-num-bg', 'número de línea añadida'],
  ['diff-num-del', 'diff-del-num-bg', 'número de línea quitada'],
  ['diff-hunk-fg', 'diff-hunk-bg', 'cabecera de bloque'],
  ['diff-add', 'bg-panel', '+ en el árbol'],
  ['diff-del', 'bg-panel', '− en el árbol'],
  ['diff-add', 'bg-surface', '+ en la cabecera'],
  ['diff-del', 'bg-surface', '− en la cabecera'],
  ['fg', 'diff-sel-bg', 'archivo seleccionado'],
  ['diff-add', 'diff-sel-bg', '+ en la fila seleccionada'],
  ['diff-del', 'diff-sel-bg', '− en la fila seleccionada'],
  ['fg-muted', 'diff-sel-bg', 'icono y «bin» en la fila seleccionada'],
  ['fg-muted', 'bg-panel', 'cabecera y pie del árbol'],
  ...(['a', 'm', 'd', 'r', 'u'] as const).flatMap((s) => [
    [`diff-st-${s}`, 'bg-panel', `estado ${s.toUpperCase()} en el árbol`] as const,
    [`diff-st-${s}`, 'diff-sel-bg', `estado ${s.toUpperCase()} en la fila seleccionada`] as const,
    [`diff-st-${s}`, 'bg-surface', `estado ${s.toUpperCase()} en la cabecera del diff`] as const,
  ]),
];

describe('vista de cambios: contraste', () => {
  it('todos los temas definen los tokens del diff', () => {
    expect(temas.map((t) => t.nombre).sort()).toEqual(['contraste', 'fosforo', 'grafito', 'papel']);
    for (const t of temas) for (const [a, b] of PARES) expect(() => [color(t.cuerpo, a), color(t.cuerpo, b)], `${t.nombre}: ${a} / ${b}`).not.toThrow();
  });

  for (const t of temas) {
    it(`tema ${t.nombre}: el texto llega a 4,5:1 sobre su fondo`, () => {
      for (const [a, b, que] of PARES) {
        expect(contraste(color(t.cuerpo, a), color(t.cuerpo, b)), `${t.nombre}: ${que} (${a} sobre ${b})`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

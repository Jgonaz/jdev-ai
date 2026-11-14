import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Reglas de la vista chat que no se pueden comprobar con DOM sin maquetación: se leen del CSS.
const css = readFileSync(new URL('./chat.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const luminancia = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contraste = (a: string, b: string): number => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** El cuerpo de la regla `selector { … }` (la primera con ese selector exacto). */
const regla = (fuente: string, selector: string): string => {
  const i = fuente.indexOf(`${selector} {`);
  if (i < 0) return '';
  return fuente.slice(i, fuente.indexOf('}', i));
};

describe('«Chat» desactivado: contraste', () => {
  const temas = [...tokens.matchAll(/:root(?:,\s*:root)?\[data-theme='(\w+)'\]\s*\{([^}]*)\}/g)];
  const color = (cuerpo: string, nombre: string) => new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(cuerpo)?.[1];

  it('usa --fg-faint, no --fg-dim (que no llega a 4,5:1)', () => {
    const r = regla(css, ".viewsw__btn[aria-disabled='true']");
    expect(r).toContain('var(--fg-faint)');
    expect(r).not.toContain('--fg-dim');
  });

  it('--fg-faint sobre el fondo del conmutador llega a 4,5:1 en todos los temas', () => {
    expect(temas.length).toBeGreaterThanOrEqual(4);
    for (const [, nombre, cuerpo] of temas) {
      const fg = color(cuerpo!, 'fg-faint')!;
      const bg = color(cuerpo!, 'bg-seg')!;
      expect(contraste(fg, bg), `tema ${nombre}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el tooltip descartado con Esc se oculta', () => {
    expect(css).toMatch(/\.viewsw__tip\[data-dismissed='true'\]\s*\{\s*display:\s*none/);
  });
});

describe('Pane estrecho', () => {
  const estrecho = css.slice(css.indexOf('@container (max-width: 520px)'));

  it('la caja de entrada empieza en 1 fila (sin el mínimo de 2) y la nota «Enter envía…» deja de verse', () => {
    expect(regla(css, '.chat__input')).toContain('min-height: calc(3em + 4px)');
    expect(regla(estrecho, '  .chat__input')).toContain('min-height: 0');
    expect(regla(estrecho, '  .chat__hint')).toMatch(/clip-path:\s*inset\(50%\)/);
  });

  it('el punto de estado mide 8 px', () => {
    const r = regla(css, '.pane__statedot');
    expect(r).toContain('width: 8px');
    expect(r).toContain('height: 8px');
  });
});

describe('Aviso de espera', () => {
  it('se limita a la columna de 820 px de la caja de entrada', () => {
    expect(regla(css, '.chat__composer')).toContain('max-width: 820px');
    const r = regla(css, '.chat__wait');
    expect(r).toContain('min(820px');
    expect(r).toMatch(/margin:\s*0 auto/);
  });
});

describe('Indicador de trabajo', () => {
  it('comparte la columna de 820 px con la caja y el aviso de espera', () => {
    const r = regla(css, '.chat__work');
    expect(r).toContain('min(820px');
    expect(r).toMatch(/margin:\s*0 auto/);
  });

  it('queda por encima del degradado de la caja de entrada, igual que el aviso de espera y «Sin actualizar»', () => {
    const r = regla(css, '.chat__stale,\n.chat__work,\n.chat__wait');
    expect(r).toContain('position: relative');
    expect(r).toContain('z-index: 1');
  });

  it('el spinner gira con la animación global, que prefers-reduced-motion apaga, y solo usa tokens de tema', () => {
    const r = regla(css, '.chat__spinner');
    expect(r).toContain('animation: spin');
    expect(r).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('respuesta de /btw', () => {
  it('se pinta preformateada: conserva saltos de línea y sangría, con la fuente de la interfaz', () => {
    const r = regla(css, '.chat__btwans');
    expect(r).toContain('white-space: pre-wrap');
    expect(r).toContain('var(--font-ui)');
  });
});

describe('Preguntas y permisos', () => {
  const temas = [...tokens.matchAll(/:root(?:,\s*:root)?\[data-theme='(\w+)'\]\s*\{([^}]*)\}/g)];
  const color = (cuerpo: string, nombre: string): string => new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`).exec(cuerpo)?.[1] ?? '';
  const mezcla = (a: string, pct: number, b: string): string => {
    const f = (i: number) => Math.round(parseInt(a.slice(i, i + 2), 16) * (pct / 100) + parseInt(b.slice(i, i + 2), 16) * (1 - pct / 100));
    return `#${[1, 3, 5].map((i) => f(i).toString(16).padStart(2, '0')).join('')}`;
  };
  const seccion = css.slice(css.indexOf('/* ---------- Pregunta de Claude'), css.indexOf('/* ---------- Pane estrecho ---------- */'));

  it('solo usa variables de tema: ningún color suelto', () => {
    expect(seccion.length).toBeGreaterThan(1000);
    expect(seccion).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(seccion).not.toMatch(/\brgba?\(/);
  });

  it('el texto de las tarjetas llega a 4,5:1 sobre sus fondos en todos los temas', () => {
    const PARES: readonly (readonly [string, string])[] = [
      ['fg', 'bg-surface'],
      ['fg-soft', 'bg-surface'],
      ['fg-muted', 'bg-surface'],
      ['fg', 'waiting-bg'],
      ['fg-soft', 'waiting-bg'],
      ['fg-soft', 'bg-raised'],
      ['fg-muted', 'bg-raised'],
      ['waiting-text', 'waiting-head'],
      ['fg-muted', 'waiting-head'],
      ['fg-muted', 'bg-panel'],
      ['fg-soft', 'bg-panel'],
      ['link', 'bg-panel'],
      ['waiting-ink', 'waiting'],
      ['working-text', 'bg-surface'],
      ['working-text', 'working-bg'],
      ['fg', 'bg-input'],
      ['fg-muted', 'bg-input'],
    ];
    expect(temas).toHaveLength(6);
    for (const [, nombre, c] of temas) {
      for (const [a, b] of PARES) expect(contraste(color(c!, a), color(c!, b)), `${nombre}: ${a} sobre ${b}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el aviso de «no se pudo» (fondo de peligro suave) se lee en todos los temas', () => {
    for (const [, nombre, c] of temas) {
      const fondo = mezcla(color(c!, 'danger'), 12, color(c!, 'bg-surface'));
      const texto = color(c!, 'danger-text') || color(c!, 'danger');
      expect(contraste(texto, fondo), `${nombre}: texto de peligro`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(color(c!, 'fg-soft'), fondo), `${nombre}: texto del motivo`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el pie se apila en el pane estrecho, con el botón a lo ancho y las opciones a 44 px', () => {
    const estrecho = css.slice(css.indexOf('@container (max-width: 520px)'));
    expect(regla(estrecho, '  .chat__qfoot')).toContain('flex-direction: column');
    expect(regla(estrecho, '  .chat__qsend')).toContain('min-height: 44px');
    expect(regla(css, '.chat__permopt')).toContain('min-height: 44px');
  });
});

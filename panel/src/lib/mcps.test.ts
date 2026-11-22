import { describe, expect, it } from 'vitest';
import type { McpCopy, McpSummary } from '../types.ts';
import { commandLine, mcpCountLabel, mcpSections, mcpSummaryLine, transportLabel } from './mcps.ts';

const copia = (c: Partial<McpCopy>): McpCopy => ({
  agent: 'claude',
  label: 'Claude',
  path: '.mcp.json',
  transport: 'stdio',
  command: null,
  args: [],
  url: null,
  envNames: [],
  headerNames: [],
  extra: {},
  incomplete: false,
  openable: true,
  ...c,
});
const mcp = (name: string, ...copies: Partial<McpCopy>[]): McpSummary => ({ name, diverges: false, copies: copies.map(copia) });

describe('mcpCountLabel', () => {
  it('singular y plural', () => {
    expect([0, 1, 2].map(mcpCountLabel)).toEqual(['0 MCPs', '1 MCP', '2 MCPs']);
  });
});

describe('mcpSections', () => {
  it('Locales (stdio) y Remotos (http, sse y conectores), en ese orden y conservando el de la lista', () => {
    const lista = [
      mcp('a', { transport: 'http', url: 'https://a' }),
      mcp('b', { transport: 'stdio', command: 'b' }),
      mcp('c', { transport: 'connector', path: null, openable: false }),
      mcp('d', { transport: 'sse', url: 'https://d' }),
      mcp('e', { transport: 'stdio', command: 'e' }),
    ];
    expect(mcpSections(lista).map((s) => [s.title, s.mcps.map((m) => m.name)])).toEqual([
      ['Locales', ['b', 'e']],
      ['Remotos', ['a', 'c', 'd']],
    ]);
  });

  it('la sección la decide la copia por defecto', () => {
    expect(mcpSections([mcp('x', { transport: 'http', url: 'https://x' }, { transport: 'stdio', command: 'x' })]).map((s) => s.key)).toEqual(['remote']);
  });

  it('no muestra las secciones vacías', () => {
    expect(mcpSections([mcp('a', { command: 'a' })]).map((s) => s.key)).toEqual(['local']);
    expect(mcpSections([])).toEqual([]);
  });
});

describe('commandLine y mcpSummaryLine', () => {
  it('une el comando con sus argumentos y entrecomilla los que tienen espacios', () => {
    expect(commandLine({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--name', 'dos palabras', ''] })).toBe('npx -y @playwright/mcp@0.0.83 --name "dos palabras" ""');
    expect(commandLine({ command: null, args: [] })).toBeNull();
  });

  it('el resumen de la lista es el comando o la URL de la copia por defecto, y nada en un conector', () => {
    expect(mcpSummaryLine(mcp('a', { command: 'npx', args: ['x'] }))).toBe('npx x');
    expect(mcpSummaryLine(mcp('b', { transport: 'http', url: 'https://b.dev/mcp?k=•••' }))).toBe('https://b.dev/mcp?k=•••');
    expect(mcpSummaryLine(mcp('c', { transport: 'connector', path: null }))).toBeNull();
  });
});

describe('transportLabel', () => {
  it('nombra cada transporte', () => {
    expect((['stdio', 'http', 'sse', 'connector'] as const).map(transportLabel)).toEqual(['stdio', 'HTTP', 'SSE', 'Conector de claude.ai']);
  });
});

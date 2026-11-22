import type { McpCopy, McpSummary, McpTransport } from '../types.ts';

/** Texto accesible del recuento de la barra lateral: «1 MCP», «3 MCPs». */
export const mcpCountLabel = (n: number): string => `${n} ${n === 1 ? 'MCP' : 'MCPs'}`;

export type McpSection = { key: 'local' | 'remote'; title: string; mcps: McpSummary[] };

/** ¿Se ejecuta en la máquina (stdio) o se conecta a algo remoto (URL o conector de claude.ai)? */
export const isLocalTransport = (t: McpTransport): boolean => t === 'stdio';

/**
 * Secciones de la lista: «Locales» y «Remotos», en ese orden y sin las vacías; dentro,
 * el orden recibido. La sección la decide la copia por defecto (la primera).
 */
export function mcpSections(mcps: readonly McpSummary[]): McpSection[] {
  const local = (m: McpSummary) => m.copies[0] !== undefined && isLocalTransport(m.copies[0].transport);
  const secciones: McpSection[] = [
    { key: 'local', title: 'Locales', mcps: mcps.filter(local) },
    { key: 'remote', title: 'Remotos', mcps: mcps.filter((m) => !local(m)) },
  ];
  return secciones.filter((s) => s.mcps.length > 0);
}

const TRANSPORTE: Record<McpTransport, string> = { stdio: 'stdio', http: 'HTTP', sse: 'SSE', connector: 'Conector de claude.ai' };
export const transportLabel = (t: McpTransport): string => TRANSPORTE[t];

// Un argumento con espacios, comillas o vacío se muestra entre comillas, como lo escribiría quien lo lanza a mano.
const argumento = (a: string): string => (a === '' || /[\s"'\\]/.test(a) ? JSON.stringify(a) : a);

/** El comando con sus argumentos en una línea, o null si no hay comando. */
export function commandLine(copy: Pick<McpCopy, 'command' | 'args'>): string | null {
  if (copy.command === null) return null;
  return [copy.command, ...copy.args].map(argumento).join(' ');
}

/** Lo que resume el MCP en la lista: el comando con sus argumentos o la URL de la copia por defecto; null para un conector. */
export function mcpSummaryLine(mcp: Pick<McpSummary, 'copies'>): string | null {
  const c = mcp.copies[0];
  if (!c) return null;
  return commandLine(c) ?? c.url;
}

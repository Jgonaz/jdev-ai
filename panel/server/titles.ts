import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';

// Claude guarda el título de la sesión en el transcript (JSONL) como líneas
// {"type":"custom-title","customTitle":"..."}; vale la última. bin/session-title
// añade líneas nuevas al final, así que casi siempre está en la cola del archivo.
// Si no hay ninguno, Claude genera uno propio: {"type":"ai-title","aiTitle":"..."}
// (también vale la última); es solo una alternativa al título por defecto.

export const CLOSED_MARK = '[Closed] ';
const TAIL_BYTES = 256 * 1024;
const CUSTOM_MARKER = '"type":"custom-title"';
const AI_MARKER = '"type":"ai-title"';

/** Últimos títulos de un transcript. `ai` solo es fiable si `custom` es null (el título propio manda). */
export type Titles = { custom: string | null; ai: string | null };

/** Título a mostrar según la prioridad: el propio y, si no hay, el generado por Claude. */
export function bestTitle(t: Titles): string | null {
  return t.custom ?? t.ai;
}

export type ParsedTitle = { title: string; closed: boolean };

// Separa la marca «[Closed] » del título.
export function parseTitle(raw: string): ParsedTitle {
  if (raw.startsWith(CLOSED_MARK)) return { title: raw.slice(CLOSED_MARK.length).trim(), closed: true };
  return { title: raw.trim(), closed: false };
}

type LineTitle = { kind: 'custom' | 'ai'; value: string };

function titleOfLine(linea: string): LineTitle | null {
  const custom = linea.includes(CUSTOM_MARKER);
  if (!custom && !linea.includes(AI_MARKER)) return null;
  try {
    const obj: unknown = JSON.parse(linea);
    if (typeof obj === 'object' && obj !== null) {
      const o = obj as { type?: unknown; customTitle?: unknown; aiTitle?: unknown };
      if (o.type === 'custom-title' && typeof o.customTitle === 'string') return { kind: 'custom', value: o.customTitle };
      if (o.type === 'ai-title' && typeof o.aiTitle === 'string') return { kind: 'ai', value: o.aiTitle };
    }
  } catch {
    // Línea cortada o ajena: se ignora.
  }
  return null;
}

// Últimos títulos entre las líneas completas de un bloque de texto. Termina en
// cuanto encuentra el propio, que es el que manda.
function lastTitlesIn(texto: string): Titles {
  const res: Titles = { custom: null, ai: null };
  const lineas = texto.split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    const t = titleOfLine(lineas[i]!);
    if (t === null) continue;
    if (t.kind === 'custom') {
      res.custom = t.value;
      break;
    }
    res.ai ??= t.value;
  }
  return res;
}

async function readRange(ruta: string, start: number, length: number): Promise<Buffer> {
  const fh = await open(ruta, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

type Entry = {
  mtimeMs: number;
  size: number;
  titles: Titles;
  /** Recorrido completo: hasta dónde se ha leído (línea completa) y los últimos títulos vistos. */
  scanned: number;
  scannedTitles: Titles;
};

export class TitleReader {
  private readonly cache = new Map<string, Entry>();

  /** Último customTitle del transcript o null (ver `readTitles`). */
  async read(ruta: string): Promise<string | null> {
    return (await this.readTitles(ruta)).custom;
  }

  /**
   * Últimos custom-title y ai-title del transcript. Lee solo la cola (256 KB); si
   * no hay customTitle en ella y el archivo es mayor, lo recorre en streaming, y
   * las veces siguientes solo lo que se haya añadido desde el último recorrido.
   * Si hay customTitle en la cola, el aiTitle solo se devuelve si también está ahí
   * (no se recorre el archivo para buscarlo: el propio manda). Caché por mtime y
   * tamaño.
   */
  async readTitles(ruta: string): Promise<Titles> {
    let st;
    try {
      st = await stat(ruta);
    } catch {
      this.cache.delete(ruta);
      return { custom: null, ai: null };
    }
    if (!st.isFile()) return { custom: null, ai: null };
    const previo = this.cache.get(ruta);
    if (previo && previo.mtimeMs === st.mtimeMs && previo.size === st.size) return previo.titles;

    const entry: Entry = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      titles: { custom: null, ai: null },
      scanned: previo && previo.size <= st.size ? previo.scanned : 0,
      scannedTitles: previo && previo.size <= st.size ? previo.scannedTitles : { custom: null, ai: null },
    };
    try {
      const inicio = Math.max(0, st.size - TAIL_BYTES);
      const cola = (await readRange(ruta, inicio, st.size - inicio)).toString('utf8');
      // Si la cola no empieza en el archivo, su primera línea puede estar cortada.
      const texto = inicio === 0 ? cola : cola.slice(cola.indexOf('\n') + 1);
      entry.titles = lastTitlesIn(texto);
      if (entry.titles.custom === null && inicio > 0) {
        await this.scan(ruta, entry);
        entry.titles = entry.scannedTitles;
      }
    } catch {
      // Archivo en escritura o desaparecido: se conserva lo último conocido.
      return previo?.titles ?? { custom: null, ai: null };
    }
    this.cache.set(ruta, entry);
    return entry.titles;
  }

  // Recorre el archivo en streaming desde entry.scanned, línea a línea, y deja
  // en entry.scannedTitles los últimos títulos vistos.
  private async scan(ruta: string, entry: Entry): Promise<void> {
    let resto: Buffer = Buffer.alloc(0);
    let posicion = entry.scanned;
    const previos = entry.scannedTitles;
    const vistos: Titles = { custom: previos.custom, ai: previos.ai };
    const anota = (t: LineTitle | null) => {
      if (t) vistos[t.kind] = t.value;
    };
    const stream = createReadStream(ruta, { start: entry.scanned, end: entry.size - 1 });
    for await (const trozo of stream) {
      let datos: Buffer = resto.length > 0 ? Buffer.concat([resto, trozo as Buffer]) : (trozo as Buffer);
      let nl: number;
      while ((nl = datos.indexOf(0x0a)) !== -1) {
        anota(titleOfLine(datos.subarray(0, nl).toString('utf8')));
        posicion += nl + 1;
        datos = datos.subarray(nl + 1);
      }
      resto = Buffer.from(datos);
    }
    // La última línea sin salto final puede estar a medio escribir: solo se
    // considera si es un JSON completo, pero no se da por recorrida.
    anota(titleOfLine(resto.toString('utf8')));
    entry.scannedTitles = vistos;
    entry.scanned = posicion;
  }
}

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  opencode: 'OpenCode',
};

// Título legible cuando la sesión no tiene ninguno: proyecto, agente y hora.
export function defaultTitle(project: string, agent: string, created: number): string {
  const hora = new Date(created).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${project || 'sesión'} · ${AGENT_NAMES[agent] ?? (agent || 'agente')} · ${hora}`;
}

import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

// Guías de uso del proyecto: docs/user-guides/**/*.md (rules/user-guides.md).

const GUIDES_DIR = join('docs', 'user-guides');
const MAX_GUIDE_BYTES = 1024 * 1024;
const MAX_GUIDES = 500;
const MAX_DEPTH = 6;

export type Guide = { path: string; title: string; updated: number };

export class GuideError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GuideError';
    this.status = status;
  }
}

const dentro = (ruta: string, raiz: string) => ruta === raiz || ruta.startsWith(raiz + sep);

// Texto del primer `# ` fuera de bloques de código; si no hay, el nombre del archivo.
export function guideTitle(source: string, fallback: string): string {
  let enCodigo = false;
  for (const l of source.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(l)) enCodigo = !enCodigo;
    else if (!enCodigo && /^#[ \t]+\S/.test(l)) return l.replace(/^#[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '').trim();
  }
  return fallback;
}

/** Lista las guías (sin seguir enlaces simbólicos), ordenadas por ruta. */
export async function listGuides(projectPath: string): Promise<Guide[]> {
  const raiz = join(projectPath, GUIDES_DIR);
  const guias: Guide[] = [];
  const recorrer = async (dir: string, nivel: number): Promise<void> => {
    let nombres: string[];
    try {
      nombres = (await readdir(dir)).sort();
    } catch {
      return;
    }
    for (const n of nombres) {
      if (guias.length >= MAX_GUIDES || n.startsWith('.')) continue;
      const abs = join(dir, n);
      let s;
      try {
        s = await lstat(abs);
      } catch {
        continue;
      }
      if (s.isDirectory() && nivel < MAX_DEPTH) await recorrer(abs, nivel + 1);
      else if (s.isFile() && n.endsWith('.md') && s.size <= MAX_GUIDE_BYTES) {
        const rel = relative(raiz, abs).split(sep).join('/');
        let source = '';
        try {
          source = await readFile(abs, 'utf8');
        } catch {
          continue;
        }
        guias.push({ path: rel, title: guideTitle(source, n.slice(0, -3)), updated: s.mtimeMs });
      }
    }
  };
  try {
    if (!(await lstat(raiz)).isDirectory()) return [];
  } catch {
    return [];
  }
  await recorrer(raiz, 0);
  return guias.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Lee una guía por su ruta relativa a docs/user-guides, comprobando sobre la
 * ruta real (con enlaces resueltos) que no sale de esa carpeta: 400 ruta mal
 * formada, 403 fuera, 404 no existe, 413 demasiado grande.
 */
export async function readGuide(projectPath: string, ruta: unknown): Promise<{ path: string; title: string; source: string }> {
  if (typeof ruta !== 'string' || ruta === '' || ruta.length > 1024 || ruta.includes('\0') || ruta.includes('\\')) {
    throw new GuideError(400, 'Indica la ruta de la guía.');
  }
  if (!ruta.endsWith('.md')) throw new GuideError(400, 'Solo se pueden leer guías Markdown (.md).');
  const raizLexica = resolve(projectPath, GUIDES_DIR);
  const pedida = resolve(raizLexica, ruta);
  let raizReal: string;
  try {
    raizReal = await realpath(raizLexica);
  } catch {
    throw new GuideError(404, 'El proyecto no tiene guías.');
  }
  let real: string;
  try {
    real = await realpath(pedida);
  } catch {
    // No se revela si existen archivos fuera de la carpeta de guías.
    throw dentro(pedida, raizLexica) ? new GuideError(404, 'La guía no existe.') : new GuideError(403, 'La ruta está fuera de docs/user-guides.');
  }
  if (!dentro(pedida, raizLexica) || !dentro(real, raizReal)) throw new GuideError(403, 'La ruta está fuera de docs/user-guides.');
  const s = await stat(real);
  if (!s.isFile()) throw new GuideError(404, 'La guía no existe.');
  if (s.size > MAX_GUIDE_BYTES) throw new GuideError(413, 'La guía es demasiado grande para mostrarla.');
  const source = await readFile(real, 'utf8');
  const rel = relative(raizLexica, pedida).split(sep).join('/');
  return { path: rel, title: guideTitle(source, rel.replace(/^.*\//, '').slice(0, -3)), source };
}

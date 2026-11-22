import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { openRegularFile, readRegularText } from './safefile.ts';

// Skills de agentes (pantalla Skills): las de un proyecto (carpetas de agente de
// la raíz de su checkout principal) y las de usuario (en el home y en plugins de
// Claude Code). Solo lectura. El cliente nunca envía rutas: pide por nombre y
// número de copia, y el servidor vuelve a descubrir y resuelve la carpeta.

export type SkillAgent = 'claude' | 'codex' | 'copilot' | 'opencode';

/**
 * Carpetas de skills de cada agente, en el orden de preferencia de la copia por
 * defecto (la de Claude y, si no, la primera). Es el único sitio donde viven estas
 * convenciones, que cambian con cada agente. `userDepth` es hasta cuántos niveles
 * se busca bajo la carpeta del home (null: no hay skills de usuario ahí): las
 * sincronizadas de claude.ai están en `synced/<bucket>/<nombre>/`.
 */
export const SKILL_SOURCES: readonly { dir: string; agent: SkillAgent; userDepth: number | null }[] = [
  { dir: '.claude/skills', agent: 'claude', userDepth: 3 },
  { dir: '.agents/skills', agent: 'codex', userDepth: 2 },
  { dir: '.codex/skills', agent: 'codex', userDepth: 2 },
  { dir: '.github/skills', agent: 'copilot', userDepth: null },
  { dir: '.opencode/skills', agent: 'opencode', userDepth: null },
];

const AGENT_LABEL: Record<SkillAgent, string> = { claude: 'Claude', codex: 'Codex', copilot: 'Copilot', opencode: 'OpenCode' };

const SKILL_FILE = 'SKILL.md';
const MAX_SKILL_BYTES = 1024 * 1024;
const MAX_COPIES = 1000;
const MAX_FILES = 200;
const MAX_NAME = 200;
const PLUGINS_FILE = join('.claude', 'plugins', 'installed_plugins.json');
const MAX_PLUGINS_BYTES = 1024 * 1024;
// Manifiesto de cada bucket de skills sincronizadas desde claude.ai (`synced/<bucket>/manifest.json`).
const SYNCED_MANIFEST = 'manifest.json';

export type SkillCopy = {
  agent: SkillAgent;
  /** Agente u origen mostrado: «Claude», «Codex», «plugin vercel»… */
  label: string;
  /** Carpeta de la copia para mostrar (relativa al proyecto, o con `~`); no se usa para resolver nada. */
  path: string;
  /** SHA-256 de su SKILL.md. */
  hash: string;
};

export type SkillSummary = {
  name: string;
  description: string | null;
  /** Creada por nosotros (ver `isOwnCopy`); si no, de terceros. */
  own: boolean;
  /** El contenido de las copias no es el mismo. */
  diverges: boolean;
  /** La primera es la copia por defecto. */
  copies: SkillCopy[];
};

export type SkillContent = {
  name: string;
  /** Índice de la copia leída, dentro de `SkillSummary.copies`. */
  copy: number;
  agent: SkillAgent;
  label: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Archivos de la carpeta (sin SKILL.md), con una carpeta más de profundidad; solo nombres. */
  files: string[];
};

export class SkillError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SkillError';
    this.status = status;
  }
}

// Lo que se guarda de cada copia descubierta; `dir` es absoluto y nunca sale del servidor.
type Found = SkillCopy & { name: string; description: string | null; dir: string; own: boolean };
export type SkillGroup = { name: string; description: string | null; own: boolean; diverges: boolean; copies: Found[] };

/** `id` es el identificador del proyecto (nombre de su carpeta); por defecto, el de `path`. */
export type SkillScope = { kind: 'project'; path: string; id?: string } | { kind: 'user'; home: string };

/** Separa el frontmatter YAML de `---` del cuerpo. Sin frontmatter válido, todo es cuerpo. */
export function splitFrontmatter(texto: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(texto);
  if (!m) return { frontmatter: {}, body: texto };
  const body = texto.slice(m[0].length);
  try {
    const datos: unknown = parse(m[1] ?? '');
    if (typeof datos === 'object' && datos !== null && !Array.isArray(datos)) return { frontmatter: datos as Record<string, unknown>, body };
  } catch {
    // YAML no estricto (p. ej. una descripción sin comillas que contiene «: »), que los agentes sí aceptan.
    return { frontmatter: looseFrontmatter(m[1] ?? ''), body };
  }
  return { frontmatter: {}, body };
}

const quitarComillas = (v: string): string => {
  const t = v.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1) : t;
};

/**
 * Lectura tolerante de un frontmatter que no es YAML válido: `clave: valor` de
 * primer nivel (el valor, tal cual hasta el final de la línea) y un nivel de
 * `  clave: valor` bajo una clave sin valor. Lo demás se ignora.
 */
export function looseFrontmatter(texto: string): Record<string, unknown> {
  const datos: Record<string, unknown> = {};
  let padre: Record<string, string> | null = null;
  for (const linea of texto.split(/\r?\n/)) {
    const arriba = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(linea);
    if (arriba) {
      const [, clave, valor] = arriba;
      if (valor === undefined || valor.trim() === '') {
        padre = {};
        datos[clave!] = padre;
      } else {
        padre = null;
        datos[clave!] = quitarComillas(valor);
      }
      continue;
    }
    const anidada = /^[ \t]+([A-Za-z0-9_-]+):[ \t]+(.+)$/.exec(linea);
    if (anidada && padre) padre[anidada[1]!] = quitarComillas(anidada[2]!);
  }
  return datos;
}

type Raw = { text: string; hash: string };

// SKILL.md solo si es un archivo regular (sin enlaces) y no pasa del límite.
async function readSkillFile(dir: string): Promise<Raw | null> {
  const abierto = await openRegularFile(join(dir, SKILL_FILE));
  if (!abierto) return null;
  try {
    if (abierto.stat.size > MAX_SKILL_BYTES) return null;
    const buf = await abierto.fh.readFile();
    return { text: buf.toString('utf8'), hash: createHash('sha256').update(buf).digest('hex') };
  } catch {
    return null;
  } finally {
    await abierto.fh.close().catch(() => {});
  }
}

const esDirectorio = async (ruta: string): Promise<boolean> => {
  try {
    return (await lstat(ruta)).isDirectory();
  } catch {
    return false;
  }
};

// Cada tramo de `ruta` bajo `base` es una carpeta real (no un enlace simbólico).
export async function sinEnlaces(base: string, ruta: string): Promise<boolean> {
  let actual = base;
  for (const tramo of ruta.split('/')) {
    actual = join(actual, tramo);
    if (!(await esDirectorio(actual))) return false;
  }
  return true;
}

/**
 * Carpetas con SKILL.md bajo `raiz`, hasta `profundidad` niveles y sin seguir
 * enlaces simbólicos. Una carpeta con SKILL.md es una skill y no se recorre más.
 */
async function scanRoot(raiz: string, profundidad: number, limite: () => boolean): Promise<string[]> {
  const skills: string[] = [];
  if (!(await esDirectorio(raiz))) return skills;
  const recorrer = async (dir: string, nivel: number): Promise<void> => {
    let nombres: string[];
    try {
      nombres = (await readdir(dir)).sort();
    } catch {
      return;
    }
    for (const n of nombres) {
      if (limite()) return;
      const abs = join(dir, n);
      if (!(await esDirectorio(abs))) continue;
      if (await readSkillFile(abs)) skills.push(abs);
      else if (nivel < profundidad) await recorrer(abs, nivel + 1);
    }
  };
  await recorrer(raiz, 1);
  return skills;
}

// Nombre de la skill: el `name` del frontmatter o, si falta, el de su carpeta.
function skillName(frontmatter: Record<string, unknown>, carpeta: string): string {
  const n = frontmatter.name;
  if (typeof n === 'string' && n.trim() !== '' && n.length <= MAX_NAME) return n.trim();
  return carpeta;
}

function skillDescription(frontmatter: Record<string, unknown>): string | null {
  const d = frontmatter.description;
  if (typeof d !== 'string') return null;
  const limpia = d.replace(/\s+/g, ' ').trim();
  return limpia === '' ? null : limpia;
}

// Compara autores sin distinguir mayúsculas ni separadores: «SmashAdvisor» = «smashadvisor», «jgonaz-portfolio» = «jgonaz_portfolio».
const normalizar = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Copia propia de un proyecto: su frontmatter declara `metadata.author` igual al
 * proyecto y no la generó una herramienta (`metadata.generatedBy`). Sin esa señal
 * cuenta como de terceros (OpenSpec declara `author: openspec`; impeccable, ninguno).
 */
export function isOwnCopy(frontmatter: Record<string, unknown>, proyecto: string): boolean {
  const meta = frontmatter.metadata;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return false;
  const { author, generatedBy } = meta as { author?: unknown; generatedBy?: unknown };
  if (generatedBy !== undefined && generatedBy !== null) return false;
  return typeof author === 'string' && normalizar(author) !== '' && normalizar(author) === normalizar(proyecto);
}

export const aHome = (ruta: string, home: string): string => {
  const rel = relative(home, ruta);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? `~/${rel.split(sep).join('/')}` : ruta;
};

async function toFound(dir: string, agent: SkillAgent, label: string, path: string, propia: (fm: Record<string, unknown>, carpeta: string) => Promise<boolean>): Promise<Found | null> {
  const raw = await readSkillFile(dir);
  if (!raw) return null;
  const { frontmatter } = splitFrontmatter(raw.text);
  const carpeta = dir.split(sep).pop() ?? dir;
  return { agent, label, path, hash: raw.hash, dir, name: skillName(frontmatter, carpeta), description: skillDescription(frontmatter), own: await propia(frontmatter, carpeta) };
}

/**
 * Orígenes del manifiesto de un bucket sincronizado desde claude.ai, por nombre de
 * skill: `anthropic` y `anthropic-example` son de Anthropic; `plugin`, las subidas
 * por la cuenta. Formato interno de claude.ai: si algo no cuadra, se ignora.
 */
async function syncedSources(bucket: string): Promise<Map<string, string>> {
  const fuentes = new Map<string, string>();
  const abierto = await openRegularFile(join(bucket, SYNCED_MANIFEST));
  if (!abierto) return fuentes;
  let datos: unknown;
  try {
    if (abierto.stat.size > MAX_PLUGINS_BYTES) return fuentes;
    datos = JSON.parse((await abierto.fh.readFile()).toString('utf8'));
  } catch {
    return fuentes;
  } finally {
    await abierto.fh.close().catch(() => {});
  }
  const skills = typeof datos === 'object' && datos !== null ? (datos as { skills?: unknown }).skills : undefined;
  if (!Array.isArray(skills)) return fuentes;
  for (const sk of skills) {
    if (typeof sk !== 'object' || sk === null) continue;
    const { name, source } = sk as { name?: unknown; source?: unknown };
    if (typeof name === 'string' && typeof source === 'string') fuentes.set(name, source);
  }
  return fuentes;
}

/**
 * Plugins de Claude Code instalados, con su carpeta de instalación (sin repetir). El
 * formato del JSON es interno de Claude Code: si algo no cuadra, se ignora sin romper
 * la pantalla. Lo comparten las pantallas Skills y MCPs.
 */
export async function installedPlugins(home: string): Promise<{ plugin: string; installPath: string }[]> {
  const texto = await readRegularText(join(home, PLUGINS_FILE), MAX_PLUGINS_BYTES);
  if (texto === null) return [];
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return [];
  }
  const plugins = typeof datos === 'object' && datos !== null ? (datos as { plugins?: unknown }).plugins : undefined;
  if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) return [];
  const instalados: { plugin: string; installPath: string }[] = [];
  const vistas = new Set<string>();
  for (const [clave, instalaciones] of Object.entries(plugins)) {
    if (!Array.isArray(instalaciones)) continue;
    const plugin = clave.split('@')[0] || clave;
    for (const inst of instalaciones) {
      const ruta = typeof inst === 'object' && inst !== null ? (inst as { installPath?: unknown }).installPath : undefined;
      if (typeof ruta !== 'string' || !isAbsolute(ruta) || ruta.includes('\0') || vistas.has(ruta)) continue;
      vistas.add(ruta);
      instalados.push({ plugin, installPath: ruta });
    }
  }
  return instalados;
}

// Carpetas `<installPath>/skills` de los plugins instalados.
const pluginSkillRoots = async (home: string): Promise<{ plugin: string; dir: string }[]> =>
  (await installedPlugins(home)).map(({ plugin, installPath }) => ({ plugin, dir: join(installPath, 'skills') }));

async function discover(scope: SkillScope): Promise<Found[]> {
  const encontradas: Found[] = [];
  const lleno = () => encontradas.length >= MAX_COPIES;
  const base = scope.kind === 'project' ? scope.path : scope.home;
  const fuentes = scope.kind === 'project' ? SKILL_SOURCES.map((s) => ({ ...s, depth: 1 })) : SKILL_SOURCES.flatMap((s) => (s.userDepth === null ? [] : [{ ...s, depth: s.userDepth }]));
  const proyecto = scope.kind === 'project' ? (scope.id ?? basename(scope.path)) : null;
  // Manifiestos de los buckets sincronizados, leídos una vez por bucket.
  const manifiestos = new Map<string, Promise<Map<string, string>>>();
  const propia = (dir: string) => async (fm: Record<string, unknown>, carpeta: string): Promise<boolean> => {
    if (proyecto !== null) return isOwnCopy(fm, proyecto);
    // De usuario solo se reconocen como propias las subidas a claude.ai por la cuenta; el resto (plugins, Codex…) es de terceros.
    const bucket = dirname(dir);
    if (basename(dirname(bucket)) !== 'synced') return false;
    if (!manifiestos.has(bucket)) manifiestos.set(bucket, syncedSources(bucket));
    const fuente = (await manifiestos.get(bucket)!).get(carpeta);
    return fuente !== undefined && !fuente.startsWith('anthropic');
  };
  const anadir = async (dirs: string[], agent: SkillAgent, etiqueta: (dir: string) => string, sinPropias = false) => {
    for (const dir of dirs) {
      if (lleno()) return;
      const f = await toFound(dir, agent, etiqueta(dir), scope.kind === 'project' ? relative(base, dir).split(sep).join('/') : aHome(dir, base), sinPropias ? async () => false : propia(dir));
      if (f) encontradas.push(f);
    }
  };
  for (const f of fuentes) {
    const raiz = join(base, f.dir);
    // En un proyecto, ni `.claude` ni `.claude/skills` pueden ser enlaces: un repositorio no debe poder apuntar el listado fuera de sí.
    if (scope.kind === 'project' && !(await sinEnlaces(base, f.dir))) continue;
    // Las sincronizadas de claude.ai viven bajo `synced/`.
    await anadir(await scanRoot(raiz, f.depth, lleno), f.agent, (dir) => (relative(raiz, dir).split(sep)[0] === 'synced' ? 'Claude (claude.ai)' : AGENT_LABEL[f.agent]));
  }
  if (scope.kind === 'user') {
    for (const { plugin, dir } of await pluginSkillRoots(scope.home)) {
      await anadir(await scanRoot(dir, 1, lleno), 'claude', () => `plugin ${plugin}`, true);
    }
  }
  return encontradas;
}

/** Descubre las skills del ámbito agrupadas por nombre. Cada grupo conserva el orden de descubrimiento (tabla, luego plugins). */
export async function discoverSkills(scope: SkillScope): Promise<SkillGroup[]> {
  const grupos = new Map<string, Found[]>();
  for (const f of await discover(scope)) {
    const copias = grupos.get(f.name);
    if (copias) copias.push(f);
    else grupos.set(f.name, [f]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
    })
    .map(([name, copies]) => ({
      name,
      description: copies.find((c) => c.description !== null)?.description ?? null,
      // Basta una copia propia: el resto suelen ser sus réplicas para otros agentes.
      own: copies.some((c) => c.own),
      diverges: new Set(copies.map((c) => c.hash)).size > 1,
      copies,
    }));
}

/** Lo que ve el cliente de cada skill: sin rutas absolutas. */
export function summarize(grupos: readonly SkillGroup[]): SkillSummary[] {
  return grupos.map((g) => ({
    name: g.name,
    description: g.description,
    own: g.own,
    diverges: g.diverges,
    copies: g.copies.map(({ agent, label, path, hash }) => ({ agent, label, path, hash })),
  }));
}

/** Skill y copia pedidas: 400 si el nombre o la copia no son válidos, 404 si no existen. */
export function resolveSkill(grupos: readonly SkillGroup[], nombre: unknown, copia: unknown = 0): { group: SkillGroup; index: number; found: Found } {
  if (typeof nombre !== 'string' || nombre === '' || nombre.length > 1024 || nombre.includes('\0')) throw new SkillError(400, 'Indica la skill.');
  if (typeof copia !== 'number' || !Number.isInteger(copia) || copia < 0) throw new SkillError(400, 'La copia no es válida.');
  const group = grupos.find((g) => g.name === nombre);
  if (!group) throw new SkillError(404, 'La skill no existe.');
  const found = group.copies[copia];
  if (!found) throw new SkillError(404, 'La copia no existe.');
  return { group, index: copia, found };
}

async function listFiles(dir: string): Promise<string[]> {
  const archivos: string[] = [];
  const leer = async (d: string): Promise<Dirent[]> => {
    try {
      return (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return [];
    }
  };
  for (const e of await leer(dir)) {
    if (archivos.length >= MAX_FILES) break;
    if (e.name === SKILL_FILE) continue;
    if (!e.isDirectory()) {
      archivos.push(e.name);
      continue;
    }
    archivos.push(`${e.name}/`);
    for (const c of await leer(join(dir, e.name))) {
      if (archivos.length >= MAX_FILES) break;
      archivos.push(`${e.name}/${c.name}${c.isDirectory() ? '/' : ''}`);
    }
  }
  return archivos;
}

/** Lee el SKILL.md de una copia (frontmatter aparte del cuerpo) y la lista de archivos de su carpeta, sin leerlos. */
export async function readSkillCopy(found: Found, index: number): Promise<SkillContent> {
  let texto: string;
  try {
    const abierto = await openRegularFile(join(found.dir, SKILL_FILE));
    if (!abierto) throw new SkillError(404, 'La skill ya no existe.');
    try {
      if (abierto.stat.size > MAX_SKILL_BYTES) throw new SkillError(413, 'La skill es demasiado grande para mostrarla.');
      texto = (await abierto.fh.readFile()).toString('utf8');
    } finally {
      await abierto.fh.close().catch(() => {});
    }
  } catch (e) {
    if (e instanceof SkillError) throw e;
    throw new SkillError(404, 'La skill ya no existe.');
  }
  const { frontmatter, body } = splitFrontmatter(texto);
  return {
    name: found.name,
    copy: index,
    agent: found.agent,
    label: found.label,
    path: found.path,
    frontmatter,
    body,
    files: await listFiles(found.dir),
  };
}

/** Carpeta absoluta de una copia ya resuelta, para abrirla en el editor. */
export const skillFolder = (found: Found): string => found.dir;

export type EditorLauncher = (carpeta: string) => Promise<void>;

/**
 * Abre una carpeta en VS Code (`code <carpeta>`) sin shell y desacoplado: el
 * editor sigue vivo si el panel se para. Falla con SkillError 501 si `code` no existe.
 * (`spawn` y no `execFile`: este último no deja desacoplar el proceso ni ignorar su salida.)
 */
export const launchVSCode: EditorLauncher = (carpeta) =>
  new Promise((ok, ko) => {
    const hijo = spawn('code', [carpeta], { detached: true, stdio: 'ignore' });
    hijo.once('error', (e: NodeJS.ErrnoException) => {
      ko(
        e.code === 'ENOENT'
          ? new SkillError(501, 'No se encontró el comando «code»: instala VS Code y su comando de shell (en WSL, con la extensión Remote).')
          : new SkillError(500, `No se pudo abrir VS Code: ${e.message}`),
      );
    });
    hijo.once('spawn', () => {
      hijo.unref();
      ok();
    });
  });

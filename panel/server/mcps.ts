import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { readMcpServersToml } from './mcpToml.ts';
import type { TomlTable } from './mcpToml.ts';
import { openRegularFile, readRegularText } from './safefile.ts';
import { aHome, installedPlugins, sinEnlaces } from './skills.ts';

// Servidores MCP de los agentes (pantalla MCPs): los de un proyecto (archivos de
// configuración de la raíz de su checkout principal, los privados del proyecto en
// `~/.claude.json` y, en el harness, los de los subagentes) y los de usuario (home,
// plugins de Claude Code y conectores de claude.ai). Solo lectura. El cliente
// nunca envía rutas: pide por nombre y número de copia, y el servidor vuelve a
// descubrir y resuelve el archivo.
//
// SECRETOS: al navegador solo llega lo normalizado y ya oculto. De `env`, `environment`
// y las cabeceras salen solo los nombres; la URL, sin credenciales ni valores de
// query; los argumentos que siguen a opciones con nombre de secreto, enmascarados.

export type McpAgent = 'claude' | 'codex' | 'copilot' | 'opencode';
export type McpTransport = 'stdio' | 'http' | 'sse' | 'connector';

type Format = 'claude' | 'claude-local' | 'copilot' | 'codex' | 'opencode';

type McpSource = {
  scope: 'project' | 'user';
  /** Ruta del archivo, relativa a la raíz del proyecto (o al home con `home`) o, en `user`, al home. */
  file: string;
  /** Un archivo del home que se lee también al descubrir un proyecto (los MCP privados de `~/.claude.json`). */
  home?: boolean;
  agent: McpAgent;
  label: string;
  format: Format;
};

/**
 * Archivos de configuración de MCPs, en el orden de preferencia de la copia por
 * defecto (la primera). Es el único sitio donde viven estas convenciones, que
 * cambian con cada agente. Aparte quedan los de formato propio: el `.mcp.json` de
 * los plugins, los conectores de claude.ai y los subagentes del harness.
 */
export const MCP_SOURCES: readonly McpSource[] = [
  { scope: 'project', file: '.mcp.json', agent: 'claude', label: 'Claude', format: 'claude' },
  { scope: 'project', file: '.claude.json', home: true, agent: 'claude', label: 'Claude (local)', format: 'claude-local' },
  { scope: 'project', file: '.vscode/mcp.json', agent: 'copilot', label: 'Copilot', format: 'copilot' },
  { scope: 'project', file: '.codex/config.toml', agent: 'codex', label: 'Codex', format: 'codex' },
  { scope: 'project', file: 'opencode.json', agent: 'opencode', label: 'OpenCode', format: 'opencode' },
  { scope: 'project', file: 'opencode.jsonc', agent: 'opencode', label: 'OpenCode', format: 'opencode' },
  { scope: 'user', file: '.claude.json', agent: 'claude', label: 'Claude', format: 'claude' },
  { scope: 'user', file: '.codex/config.toml', agent: 'codex', label: 'Codex', format: 'codex' },
  { scope: 'user', file: '.config/opencode/opencode.json', agent: 'opencode', label: 'OpenCode', format: 'opencode' },
  { scope: 'user', file: '.config/opencode/opencode.jsonc', agent: 'opencode', label: 'OpenCode', format: 'opencode' },
];

const AGENTS_FILE = 'adapters/claude/agents.json';
const CLAUDE_JSON = '.claude.json';
const MAX_FILE_BYTES = 1024 * 1024;
// `~/.claude.json` guarda mucho más que los MCPs (historial, cachés) y crece.
const MAX_CLAUDE_JSON_BYTES = 16 * 1024 * 1024;
const MAX_COPIES = 1000;
const MAX_NAME = 200;
const MAX_STRING = 2000;
const MAX_ARGS = 100;
const MAX_NAMES = 100;
const MAX_EXTRA = 30;
const MAX_EXTRA_STRING = 500;
const MASK = '•••';

export type McpCopy = {
  agent: McpAgent;
  /** Agente u origen mostrado: «Claude», «Codex», «plugin vercel», «Claude (subagente qa)», «claude.ai»… */
  label: string;
  /** Archivo donde está definido, para mostrar (relativo al proyecto, o con `~`); null en los conectores. */
  path: string | null;
  transport: McpTransport;
  command: string | null;
  /** Argumentos con los secretos enmascarados. */
  args: string[];
  /** URL sin credenciales ni valores de query. */
  url: string | null;
  /** Solo los nombres: sus valores no salen del servidor. */
  envNames: string[];
  headerNames: string[];
  /** Otros campos escalares (`note`, `enabled`, `timeout`…), sin los que parecen secretos. */
  extra: Record<string, string | number | boolean>;
  /** El archivo tenía líneas que no se entendieron en este MCP: los datos pueden estar incompletos. */
  incomplete: boolean;
  /** Tiene archivo que abrir en el editor (los conectores de claude.ai no). */
  openable: boolean;
};

export type McpSummary = {
  name: string;
  /** La configuración de las copias (sin contar conectores ni incompletas) no es la misma. */
  diverges: boolean;
  /** La primera es la copia por defecto. */
  copies: McpCopy[];
};

export class McpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'McpError';
    this.status = status;
  }
}

// Lo que se guarda de cada copia descubierta; `file` es absoluto y nunca sale del servidor.
type Found = McpCopy & { name: string; file: string | null; hash: string };
export type McpGroup = { name: string; diverges: boolean; copies: Found[] };

/** `harness`: el proyecto es el propio harness, que además tiene los MCP de sus subagentes. `home` es de donde se lee `~/.claude.json`. */
export type McpScope = { kind: 'project'; path: string; home: string; harness?: boolean } | { kind: 'user'; home: string };

type Plain = Record<string, unknown>;
const esPlano = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);
// Claves que no se copian a objetos propios.
const claveSegura = (k: string): boolean => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
const limitar = (s: string, max = MAX_STRING): string => (s.length > max ? `${s.slice(0, max)}…` : s);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? limitar(v) : null);

// ---------- Secretos ----------

/** ¿El nombre de una opción, variable o campo parece de un secreto? Conservador: mejor ocultar de más. */
export const isSecretName = (nombre: string): boolean => /token|key|secret|passw|auth|credential|bearer|cookie/i.test(nombre);

// Formas conocidas de credenciales sueltas (tokens de GitHub, OpenAI, Slack, AWS, Google, JWT) y `Bearer xxx`.
const TOKEN_CONOCIDO =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*)/g;
const BEARER = /\b(bearer|basic)\s+\S+/gi;
const URL_EN_TEXTO = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi;

const pareceToken = (s: string): boolean => s.length >= 20 && /^[A-Za-z0-9_+=.-]+$/.test(s) && /[0-9]/.test(s) && /[A-Za-z]/.test(s);

/**
 * URL sin credenciales (`usuario:clave@`), sin el fragmento, con los valores de la
 * query ocultos (`?key=•••`) y sin segmentos de ruta que parecen un token. Se hace
 * con expresiones y no con `URL` para no reescribir lo demás (barra final, mayúsculas)
 * ni fallar con marcadores como `${VAR}`.
 */
export function redactUrl(url: string): string {
  let s = url;
  const fragmento = s.indexOf('#');
  if (fragmento !== -1) s = s.slice(0, fragmento);
  const q = s.indexOf('?');
  let base = q === -1 ? s : s.slice(0, q);
  const query = q === -1 ? null : s.slice(q + 1);
  base = base.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/]*@/i, '$1');
  base = base.replace(/(?<=[^/]\/)[A-Za-z0-9_+=.-]{20,}(?=\/|$)/g, (m) => (pareceToken(m) ? MASK : m));
  if (query === null) return base;
  const oculta = query
    .split('&')
    .map((p) => {
      if (p === '') return p;
      const e = p.indexOf('=');
      return e === -1 ? MASK : `${p.slice(0, e)}=${MASK}`;
    })
    .join('&');
  return `${base}?${oculta}`;
}

/** Oculta, dentro de un texto cualquiera, las URL con secretos, `Bearer xxx` y los tokens de formato conocido. */
export function redactText(s: string): string {
  return s.replace(URL_EN_TEXTO, redactUrl).replace(BEARER, `$1 ${MASK}`).replace(TOKEN_CONOCIDO, MASK);
}

// `Nombre: valor` de una cabecera pasada como argumento: se conserva el nombre.
const redactHeaderArg = (a: string): string => {
  const m = /^([^:]+):/.exec(a);
  return m ? `${m[1]}: ${MASK}` : MASK;
};
const OPCIONES_CABECERA = new Set(['--header', '--headers', '-H']);

/**
 * Enmascara los secretos de una lista de argumentos: el valor de una opción cuyo nombre
 * parece de un secreto (`--api-key xxx`, `--token=xxx`), el de una cabecera
 * (`--header "Authorization: Bearer xxx"`), `NOMBRE=valor` con nombre de secreto
 * (`-e API_KEY=xxx`) y lo que `redactText` reconoce.
 */
export function redactArgs(args: readonly string[]): string[] {
  const salida: string[] = [];
  let siguiente: 'secreto' | 'cabecera' | null = null;
  for (const a of args) {
    if (siguiente !== null) {
      const modo = siguiente;
      siguiente = null;
      if (modo === 'cabecera') {
        salida.push(redactHeaderArg(a));
        continue;
      }
      if (!a.startsWith('--')) {
        salida.push(MASK);
        continue;
      }
    }
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      const opcion = eq === -1 ? a : a.slice(0, eq);
      if (isSecretName(opcion)) {
        if (eq === -1) {
          salida.push(a);
          siguiente = 'secreto';
        } else salida.push(`${opcion}=${MASK}`);
        continue;
      }
      if (OPCIONES_CABECERA.has(opcion)) {
        if (eq === -1) {
          salida.push(a);
          siguiente = 'cabecera';
        } else salida.push(`${opcion}=${redactHeaderArg(a.slice(eq + 1))}`);
        continue;
      }
      salida.push(redactText(a));
      continue;
    }
    const asignacion = /^([A-Za-z_][A-Za-z0-9_.-]*)=/.exec(a);
    salida.push(asignacion && isSecretName(asignacion[1]!) ? `${asignacion[1]}=${MASK}` : redactText(a));
  }
  return salida;
}

// ---------- Normalización ----------

type McpConfig = Pick<McpCopy, 'transport' | 'command' | 'args' | 'url' | 'envNames' | 'headerNames' | 'extra'>;

const nombresDe = (v: unknown): string[] => (esPlano(v) ? Object.keys(v).filter(claveSegura).map((k) => limitar(k, MAX_NAME)).slice(0, MAX_NAMES) : []);

const listaDeTextos = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string | number | boolean => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean')
        .map((x) => limitar(String(x)))
        .slice(0, MAX_ARGS)
    : [];

// Campos escalares que no son estructura del MCP, sin los que parecen secretos.
function extraDe(raw: Plain, estructura: ReadonlySet<string>): McpConfig['extra'] {
  const extra: McpConfig['extra'] = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= MAX_EXTRA) break;
    if (estructura.has(k) || !claveSegura(k) || isSecretName(k)) continue;
    if (typeof v === 'string') extra[limitar(k, MAX_NAME)] = redactText(limitar(v, MAX_EXTRA_STRING));
    else if (typeof v === 'number' || typeof v === 'boolean') extra[limitar(k, MAX_NAME)] = v;
    else continue;
    n++;
  }
  return extra;
}

const unica = (v: string[]): string[] => [...new Set(v)];

function build(
  transport: Exclude<McpTransport, 'connector'>,
  datos: { command: string | null; args: string[]; url: string | null; envNames: string[]; headerNames: string[] },
  raw: Plain,
  estructura: ReadonlySet<string>,
): McpConfig {
  return {
    transport,
    command: datos.command === null ? null : redactText(datos.command),
    args: redactArgs(datos.args),
    url: datos.url === null ? null : redactUrl(datos.url),
    envNames: unica(datos.envNames),
    headerNames: unica(datos.headerNames),
    extra: extraDe(raw, estructura),
  };
}

const ESTRUCTURA_CLAUDE: ReadonlySet<string> = new Set(['type', 'command', 'args', 'url', 'env', 'headers']);
const ESTRUCTURA_OPENCODE: ReadonlySet<string> = new Set(['type', 'command', 'environment', 'url', 'headers']);
const ESTRUCTURA_CODEX: ReadonlySet<string> = new Set(['command', 'args', 'url', 'env', 'env_vars', 'http_headers', 'env_http_headers']);

/** Claude (`.mcp.json`, `~/.claude.json`, plugins, subagentes) y Copilot (`.vscode/mcp.json`): `type`, `command`, `args`, `url`, `env`, `headers`. */
function fromClaude(raw: unknown): McpConfig | null {
  if (!esPlano(raw)) return null;
  const command = texto(raw.command);
  const url = texto(raw.url);
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : null;
  const transport: Exclude<McpTransport, 'connector'> | null =
    type === 'stdio' ? (command ? 'stdio' : null) : type === 'sse' ? (url ? 'sse' : null) : type === 'http' || type === 'streamable-http' ? (url ? 'http' : null) : command ? 'stdio' : url ? 'http' : null;
  if (transport === null) return null;
  return build(transport, { command, args: listaDeTextos(raw.args), url, envNames: nombresDe(raw.env), headerNames: nombresDe(raw.headers) }, raw, ESTRUCTURA_CLAUDE);
}

/** OpenCode: `type: local` con `command` en lista y `environment`; `type: remote` con `url` y `headers`. */
function fromOpenCode(raw: unknown): McpConfig | null {
  if (!esPlano(raw)) return null;
  const url = texto(raw.url);
  const lista = listaDeTextos(raw.command);
  const comando = lista.length > 0 ? lista : texto(raw.command) !== null ? [texto(raw.command)!] : [];
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : null;
  const local = type === 'local' || (type === null && comando.length > 0);
  const remoto = type === 'remote' || (type === null && url !== null);
  if (local && comando.length > 0) {
    return build('stdio', { command: comando[0]!, args: comando.slice(1), url: null, envNames: nombresDe(raw.environment), headerNames: [] }, raw, ESTRUCTURA_OPENCODE);
  }
  if (remoto && url !== null) {
    return build('http', { command: null, args: [], url, envNames: [], headerNames: nombresDe(raw.headers) }, raw, ESTRUCTURA_OPENCODE);
  }
  return null;
}

/** Codex (`[mcp_servers.<nombre>]`): `command`, `args`, `env`, `env_vars`, `url`, `http_headers`, `env_http_headers`. */
function fromCodex(raw: TomlTable): McpConfig | null {
  const command = texto(raw.command);
  const url = texto(raw.url);
  const transport = command ? 'stdio' : url ? 'http' : null;
  if (transport === null) return null;
  const nombresEnv = [...nombresDe(raw.env), ...listaDeTextos(raw.env_vars).filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v))];
  return build(
    transport,
    { command, args: listaDeTextos(raw.args), url, envNames: nombresEnv, headerNames: [...nombresDe(raw.http_headers), ...nombresDe(raw.env_http_headers)] },
    raw,
    ESTRUCTURA_CODEX,
  );
}

// Huella de lo que ejecuta el MCP: sin `extra` (notas, `enabled`…) y sin importar el orden de las variables. Sobre lo ya oculto.
const hashOf = (c: McpConfig): string =>
  createHash('sha256').update(JSON.stringify([c.transport, c.command, c.args, c.url, [...c.envNames].sort(), [...c.headerNames].sort()])).digest('hex');

// ---------- Lectura ----------

/**
 * JSON con comentarios de línea y de bloque y comas finales, como `opencode.jsonc` y
 * `.vscode/mcp.json`. Recorre el texto respetando las cadenas, para no tocar un
 * `//` dentro de una URL. Devuelve undefined si no es JSON válido tras limpiarlo.
 */
export function parseJsonc(entrada: string): unknown {
  const t = entrada.replace(/^﻿/, '');
  const salida: string[] = [];
  let coma = -1; // posición en `salida` de la última coma pendiente de comprobar
  let i = 0;
  while (i < t.length) {
    const c = t[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1;
      coma = -1;
      salida.push(t.slice(i, j + 1));
      i = j + 1;
    } else if (c === '/' && t[i + 1] === '/') {
      while (i < t.length && t[i] !== '\n') i++;
    } else if (c === '/' && t[i + 1] === '*') {
      const fin = t.indexOf('*/', i + 2);
      i = fin === -1 ? t.length : fin + 2;
    } else {
      if (c === ',') coma = salida.length;
      else if (c === '}' || c === ']') {
        if (coma !== -1) salida[coma] = ' ';
        coma = -1;
      } else if (!/\s/.test(c)) coma = -1;
      salida.push(c);
      i++;
    }
  }
  try {
    return JSON.parse(salida.join(''));
  } catch {
    return undefined;
  }
}

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

type Entrada = { name: string; config: McpConfig; incomplete: boolean; label?: string };

// Un mapa `nombre → configuración` de un JSON (`mcpServers`, `servers`, `mcp`) a entradas.
function fromMap(mapa: unknown, convertir: (raw: unknown) => McpConfig | null, etiqueta?: string): Entrada[] {
  if (!esPlano(mapa)) return [];
  const entradas: Entrada[] = [];
  for (const [name, raw] of Object.entries(mapa)) {
    if (name === '' || name.length > MAX_NAME || name.includes('\0') || !claveSegura(name)) continue;
    const config = convertir(raw);
    if (config) entradas.push({ name, config, incomplete: false, ...(etiqueta === undefined ? {} : { label: etiqueta }) });
  }
  return entradas;
}

function parseSource(format: Format, contenido: string, proyecto: string | null): Entrada[] {
  switch (format) {
    case 'claude': {
      const json = parseJson(contenido);
      return esPlano(json) ? fromMap(json.mcpServers, fromClaude) : [];
    }
    case 'claude-local': {
      const json = parseJson(contenido);
      const proyectos = esPlano(json) ? json.projects : undefined;
      if (proyecto === null || !esPlano(proyectos) || !Object.hasOwn(proyectos, proyecto)) return [];
      const p = proyectos[proyecto];
      return esPlano(p) ? fromMap(p.mcpServers, fromClaude) : [];
    }
    case 'copilot': {
      const json = parseJsonc(contenido);
      return esPlano(json) ? fromMap(json.servers, fromClaude) : [];
    }
    case 'opencode': {
      const json = parseJsonc(contenido);
      return esPlano(json) ? fromMap(json.mcp, fromOpenCode) : [];
    }
    case 'codex': {
      const entradas: Entrada[] = [];
      for (const s of readMcpServersToml(contenido)) {
        if (s.name === '' || s.name.length > MAX_NAME || s.name.includes('\0') || !claveSegura(s.name)) continue;
        const config = fromCodex(s.table);
        if (config) entradas.push({ name: s.name, config, incomplete: s.incomplete });
      }
      return entradas;
    }
  }
}

// `.mcp.json` de un plugin: con `mcpServers` o, como admite Claude Code, con los servidores en la raíz.
function fromPlugin(contenido: string): Entrada[] {
  const json = parseJson(contenido);
  if (!esPlano(json)) return [];
  return fromMap(Object.hasOwn(json, 'mcpServers') ? json.mcpServers : json, fromClaude);
}

// `adapters/claude/agents.json` (harness): cada agente puede traer `mcpServers` como lista de `{nombre: configuración}`
// (o como objeto). Los nombres sueltos de la lista son referencias a MCPs ya configurados, no definiciones.
function fromAgents(contenido: string): Entrada[] {
  const json = parseJson(contenido);
  if (!esPlano(json)) return [];
  const entradas: Entrada[] = [];
  for (const [agente, def] of Object.entries(json)) {
    if (!esPlano(def) || !claveSegura(agente)) continue;
    const etiqueta = `Claude (subagente ${limitar(agente, MAX_NAME)})`;
    const mapas = Array.isArray(def.mcpServers) ? def.mcpServers : [def.mcpServers];
    for (const mapa of mapas) entradas.push(...fromMap(mapa, fromClaude, etiqueta));
  }
  return entradas;
}

async function discover(scope: McpScope): Promise<Found[]> {
  const encontradas: Found[] = [];
  const lleno = () => encontradas.length >= MAX_COPIES;
  const home = scope.home;
  const base = scope.kind === 'project' ? scope.path : home;
  const proyecto = scope.kind === 'project' ? scope.path : null;
  const anadir = (entradas: Entrada[], agent: McpAgent, label: string, file: string, path: string) => {
    for (const e of entradas) {
      if (lleno()) return;
      encontradas.push({ ...e.config, agent, label: e.label ?? label, path, incomplete: e.incomplete, openable: true, name: e.name, file, hash: hashOf(e.config) });
    }
  };

  // `~/.claude.json` se lee una vez: lo usan los MCP privados del proyecto, los de usuario y los conectores.
  let claudeJson: Promise<string | null> | undefined;
  const leerClaudeJson = () => (claudeJson ??= readRegularText(join(home, CLAUDE_JSON), MAX_CLAUDE_JSON_BYTES));

  for (const s of MCP_SOURCES) {
    if (s.scope !== scope.kind) continue;
    const desdeHome = scope.kind === 'user' || s.home === true;
    const raiz = desdeHome ? home : base;
    const archivo = join(raiz, s.file);
    // En un proyecto, ni `.vscode` ni `.codex` pueden ser enlaces: un repositorio no debe poder apuntar el listado fuera de sí.
    if (!desdeHome && dirname(s.file) !== '.' && !(await sinEnlaces(raiz, dirname(s.file)))) continue;
    const contenido = s.file === CLAUDE_JSON && desdeHome ? await leerClaudeJson() : await readRegularText(archivo, MAX_FILE_BYTES);
    if (contenido === null) continue;
    anadir(parseSource(s.format, contenido, proyecto), s.agent, s.label, archivo, desdeHome ? aHome(archivo, home) : s.file);
  }

  if (scope.kind === 'project' && scope.harness === true && (await sinEnlaces(base, dirname(AGENTS_FILE)))) {
    const archivo = join(base, AGENTS_FILE);
    const contenido = await readRegularText(archivo, MAX_FILE_BYTES);
    if (contenido !== null) anadir(fromAgents(contenido), 'claude', 'Claude', archivo, AGENTS_FILE);
  }

  if (scope.kind === 'user') {
    for (const { plugin, installPath } of await installedPlugins(home)) {
      const archivo = join(installPath, '.mcp.json');
      const contenido = await readRegularText(archivo, MAX_FILE_BYTES);
      if (contenido !== null) anadir(fromPlugin(contenido), 'claude', `plugin ${plugin}`, archivo, aHome(archivo, home));
    }
    // Conectores de claude.ai: `~/.claude.json` solo guarda los nombres de los que se han conectado alguna vez.
    const cj = await leerClaudeJson();
    const json = cj === null ? undefined : parseJson(cj);
    const conectados = esPlano(json) ? json.claudeAiMcpEverConnected : undefined;
    if (Array.isArray(conectados)) {
      for (const c of conectados) {
        if (lleno()) break;
        const name = typeof c === 'string' ? c.replace(/^claude\.ai\s+/i, '').trim() : '';
        if (name === '' || name.length > MAX_NAME || name.includes('\0')) continue;
        encontradas.push({ agent: 'claude', label: 'claude.ai', path: null, transport: 'connector', command: null, args: [], url: null, envNames: [], headerNames: [], extra: {}, incomplete: false, openable: false, name, file: null, hash: '' });
      }
    }
  }
  return encontradas;
}

/** Descubre los MCP del ámbito agrupados por nombre. Cada grupo conserva el orden de descubrimiento (tabla, plugins, conectores). */
export async function discoverMcps(scope: McpScope): Promise<McpGroup[]> {
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
      // Un conector no tiene configuración que comparar, y una copia incompleta daría diferencias falsas.
      diverges: new Set(copies.filter((c) => c.transport !== 'connector' && !c.incomplete).map((c) => c.hash)).size > 1,
      copies,
    }));
}

/** Lo que ve el cliente de cada MCP: sin rutas absolutas ni huellas. */
export function summarizeMcps(grupos: readonly McpGroup[]): McpSummary[] {
  return grupos.map((g) => ({
    name: g.name,
    diverges: g.diverges,
    copies: g.copies.map(({ agent, label, path, transport, command, args, url, envNames, headerNames, extra, incomplete, openable }) => ({
      agent,
      label,
      path,
      transport,
      command,
      args,
      url,
      envNames,
      headerNames,
      extra,
      incomplete,
      openable,
    })),
  }));
}

/** MCP y copia pedidos: 400 si el nombre o la copia no son válidos, 404 si no existen. */
export function resolveMcp(grupos: readonly McpGroup[], nombre: unknown, copia: unknown = 0): { group: McpGroup; index: number; found: Found } {
  if (typeof nombre !== 'string' || nombre === '' || nombre.length > 1024 || nombre.includes('\0')) throw new McpError(400, 'Indica el MCP.');
  if (typeof copia !== 'number' || !Number.isInteger(copia) || copia < 0) throw new McpError(400, 'La copia no es válida.');
  const group = grupos.find((g) => g.name === nombre);
  if (!group) throw new McpError(404, 'El MCP no existe.');
  const found = group.copies[copia];
  if (!found) throw new McpError(404, 'La copia no existe.');
  return { group, index: copia, found };
}

/**
 * Archivo absoluto de una copia ya resuelta, para abrirlo en el editor. Los conectores
 * de claude.ai no tienen (400). Se comprueba de nuevo que sigue siendo un archivo regular.
 */
export async function mcpFile(found: Found): Promise<string> {
  if (found.file === null) throw new McpError(400, 'Los conectores de claude.ai no tienen archivo de configuración.');
  const abierto = await openRegularFile(found.file);
  if (!abierto) throw new McpError(404, 'El archivo de configuración ya no existe.');
  await abierto.fh.close().catch(() => {});
  return found.file;
}

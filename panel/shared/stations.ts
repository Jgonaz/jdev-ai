// Estación del mapa de actividad a la que pertenece una herramienta. Módulo sin
// dependencias de Node: lo usan el servidor (para calcularla con la entrada
// completa) y el cliente (para los eventos que no la traen).
//
// Adaptado de `hooks/classify.ts` de lot-map: https://github.com/alexeyw/lot-map
// Se conserva su aviso de copyright y licencia:
//
//   MIT License
//
//   Copyright (c) 2026 Aleksei Volodin
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Cambios respecto al original: nombres de estación propios del panel, sin
// opciones configurables (servidores y comandos de memoria), sin etiquetas
// (el panel ya tiene verbo y objetivo) y sin la estación Hooks.

export const STATIONS = ['tu', 'modelo', 'memoria', 'archivos', 'shell', 'red', 'navegador', 'agentes', 'skills'] as const;
export type Station = (typeof STATIONS)[number];

/** Una ruta con separadores de Windows escrita con `/`, para que una sola regla lea las de todos los sistemas. */
const barras = (ruta: string): string => ruta.replace(/\\/g, '/');

/**
 * La memoria de Claude Code (`~/.claude/projects/<slug>/memory/`) y la del harness (`.agent/memory/`). Se busca
 * dentro de una ruta suelta o de una línea de comandos entera, así que la carpeta puede ir rodeada de espacios o comillas.
 */
const MEMORIA = /(?:\/\.claude\/projects\/[^/]+\/memory|(?:^|[/\s"'=:])\.agent\/memory)(?:[/\s"']|$)/;

const esRutaDeMemoria = (ruta: string): boolean => MEMORIA.test(barras(ruta));
const cad = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Comandos que solo trabajan con archivos: los leen, buscan, mueven o editan en su sitio. echo, cd y similares no dicen nada. */
const ARCHIVOS = new Set(['cat', 'head', 'tail', 'sed', 'grep', 'rg', 'find', 'ls', 'wc', 'cp', 'mv', 'mkdir', 'touch', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'awk', 'tee', 'stat', 'file', 'du', 'tree', 'ln', 'basename', 'dirname', 'realpath', 'jq', 'rm', 'rmdir']);
const NEUTROS = new Set(['echo', 'printf', 'cd', 'export', 'true', 'set', 'pwd', 'sleep', 'which', 'test', '[']);
const RED = new Set(['curl', 'wget', 'gh', 'ssh', 'scp', 'sftp', 'ftp', 'rsync', 'nc', 'ncat', 'telnet', 'ping', 'dig', 'nslookup']);
/** Comandos que solo llegan a la red con algunos de sus subcomandos. */
const RED_SUBCOMANDOS: Record<string, ReadonlySet<string>> = {
  git: new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote']),
  npm: new Set(['install', 'i', 'ci', 'add', 'update', 'publish', 'view', 'audit']),
  pnpm: new Set(['install', 'i', 'add', 'update', 'publish', 'dlx']),
  yarn: new Set(['install', 'add', 'upgrade', 'publish', 'dlx']),
  bun: new Set(['install', 'add', 'update', 'publish']),
  pip: new Set(['install', 'download']),
  pip3: new Set(['install', 'download']),
  pipx: new Set(['install', 'upgrade', 'upgrade-all', 'run']),
  uv: new Set(['add', 'sync', 'lock', 'publish', 'tool install']),
  poetry: new Set(['install', 'add', 'update', 'lock', 'publish']),
  docker: new Set(['pull', 'push', 'login']),
  'docker compose': new Set(['pull', 'push']),
  brew: new Set(['install', 'update', 'upgrade', 'fetch']),
  cargo: new Set(['install', 'fetch', 'publish', 'update']),
  go: new Set(['get', 'install', 'mod download']),
  apt: new Set(['install', 'update', 'upgrade', 'full-upgrade', 'dist-upgrade']),
  'apt-get': new Set(['install', 'update', 'upgrade', 'dist-upgrade']),
};
/** Programas que Python ejecuta como módulo: `python -m pip install` es `pip install`. */
const MODULOS_PY = new Set(['pip', 'uv', 'pipx', 'poetry']);

/**
 * Comandos que ejecutan otro comando: cuenta el que ejecutan. Cada uno lista sus opciones que llevan una palabra
 * detrás; `skip` es cuántas palabras propias siguen a las opciones, y con una opción de `asks` no ejecuta nada.
 */
const ENVOLTORIOS: Record<string, { takes?: readonly string[]; skip?: number; asks?: readonly string[] }> = {
  sudo: { takes: ['-u', '-g', '-p', '-h', '-C', '-D', '-R', '-T', '-U', '-r', '-t'] },
  doas: { takes: ['-u', '-C'] },
  env: { takes: ['-u', '-C'] },
  time: {},
  timeout: { takes: ['-s', '-k'], skip: 1 },
  nohup: {},
  nice: { takes: ['-n'] },
  ionice: { takes: ['-c', '-n'] },
  stdbuf: { takes: ['-i', '-o', '-e'] },
  caffeinate: { takes: ['-t', '-w'] },
  command: { asks: ['-v', '-V'] },
  exec: { takes: ['-a'] },
  xargs: { takes: ['-n', '-I', '-P', '-L', '-d', '-E', '-s', '-a', '-J', '-R'] },
};
const ASIGNACION = /^[A-Za-z_]\w*=/;
/** Opciones de git y de docker que llevan una palabra detrás y van antes del subcomando. */
const GIT_LLEVA = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const DOCKER_LLEVA = new Set(['-c', '--context', '-H', '--host', '--config', '-l', '--log-level', '-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory']);

/** Los nombres propios de PowerShell para los mismos tres tipos de comando, en minúsculas: PowerShell no distingue mayúsculas. */
const PS_ARCHIVOS = new Set(['get-content', 'gc', 'type', 'set-content', 'add-content', 'out-file', 'get-childitem', 'gci', 'dir', 'get-item', 'gi', 'select-string', 'sls', 'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'rename-item', 'rni', 'ren', 'new-item', 'ni', 'md', 'test-path', 'resolve-path', 'get-filehash']);
const PS_NEUTROS = new Set(['write-host', 'write-output', 'set-location', 'sl', 'get-location', 'gl', 'start-sleep', 'select-object', 'select', 'where-object', 'where', '?', 'foreach-object', 'foreach', '%', 'sort-object', 'measure-object', 'measure', 'format-table', 'ft', 'format-list', 'fl', 'out-string', 'out-null']);
const PS_RED = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'test-connection', 'test-netconnection', 'resolve-dnsname', 'start-bitstransfer']);

/** Las palabras tras las opciones: una opción de `lleva` tiene una palabra propia detrás. */
function trasOpciones(palabras: string[], lleva: { has(opcion: string): boolean }): string[] {
  let i = 0;
  while (i < palabras.length && (palabras[i] ?? '').startsWith('-')) i += lleva.has(palabras[i] ?? '') ? 2 : 1;
  return palabras.slice(i);
}

/**
 * Las palabras de cada comando de una línea de shell, sin las asignaciones del principio. Las comillas se conservan:
 * una palabra entre comillas es un argumento. `profundo` también corta en `$(…)`, comillas inversas y paréntesis,
 * para dar con un comando ejecutado dentro de otro; los trozos de alrededor ya no son comandos.
 */
function segmentos(comando: string, profundo = false): string[][] {
  return (
    comando
      .split(profundo ? /&&|\|\||;|\||\n|\$\(|`|\(|\)/ : /&&|\|\||;|\||\n/)
      // Corta por espacios fuera de comillas, para que "C:\Program Files\Git\cmd\git.exe" siga siendo una palabra.
      .map((parte) => parte.match(/(?:[^\s"']|"[^"]*"?|'[^']*'?)+/g) ?? [])
      .map((palabras) => {
        let i = 0;
        while (i < palabras.length && ASIGNACION.test(palabras[i] ?? '')) i++;
        return palabras.slice(i);
      })
      .filter((palabras) => palabras.length > 0)
  );
}

/**
 * El nombre propio de un comando: sin comillas ni carpeta delante. Un programa de Windows pierde `.exe`, `.cmd` o
 * `.bat` y las mayúsculas, porque Windows no distingue `CURL.EXE` de `curl`; cualquier otro nombre las conserva.
 */
function nombreDe(palabra = ''): string {
  const nombre = barras(palabra.replace(/["']/g, '')).split('/').pop() ?? palabra;
  return /\.(?:exe|cmd|bat)$/i.test(nombre) ? nombre.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase() : nombre;
}

/** La línea de una herramienta de shell. `powershell` añade los nombres propios de PowerShell y lee todos en minúsculas. */
function clasificaShell(comando: string, powershell = false): Station {
  const nombre = (palabra?: string): string => (powershell ? nombreDe(palabra).toLowerCase() : nombreDe(palabra));
  // PowerShell ejecuta una ruta entre comillas con `&` y guarda resultados en `$nombre = ...`: ninguno es el comando.
  const propias = (palabras: string[]): string[] => {
    if (!powershell) return palabras;
    let i = 0;
    if (/^\$[\w:]+$/.test(palabras[0] ?? '') && palabras[1] === '=') i = 2;
    if (palabras[i] === '&' || palabras[i] === '.') i++;
    return palabras.slice(i);
  };
  // `sudo curl` es curl, y también el curl que hay tras `env A=1`, `timeout 5` o `xargs`: cuenta el comando ejecutado.
  const sinEnvoltorios = (palabras: string[]): string[] => {
    let resto = palabras;
    for (let profundidad = 0; profundidad < 6; profundidad++) {
      const envoltorio = ENVOLTORIOS[nombre(resto[0])];
      if (envoltorio === undefined) break;
      if (envoltorio.asks?.some((opcion) => resto[1] === opcion) === true) break;
      resto = trasOpciones(resto.slice(1), new Set(envoltorio.takes ?? []));
      let i = 0;
      while (i < resto.length && ASIGNACION.test(resto[i] ?? '')) i++;
      resto = resto.slice(i + (envoltorio.skip ?? 0));
    }
    return resto;
  };
  /** Los comandos de un trozo de línea: el suyo y cada uno que `find` ejecuta con `-exec`. */
  const comandos = (palabras: string[]): string[][] => {
    const externo = sinEnvoltorios(palabras);
    const todos = [externo];
    if (nombre(externo[0]) === 'find') {
      externo.forEach((palabra, i) => {
        if (!/^-(?:exec|execdir|ok|okdir)$/.test(palabra)) return;
        const cola = externo.slice(i + 1);
        const fin = cola.findIndex((w) => w === ';' || w === '\\;' || w === '\\' || w === '+');
        todos.push(sinEnvoltorios(fin < 0 ? cola : cola.slice(0, fin)));
      });
    }
    return todos.filter((c) => c.length > 0);
  };
  /** Si un comando llega a la red: por su nombre, o por su nombre y subcomando. */
  const llegaALaRed = (palabras: string[]): boolean => {
    let cabeza = nombre(palabras[0]);
    let resto = palabras.slice(1);
    if (RED.has(cabeza) || (powershell && PS_RED.has(cabeza))) return true;
    if (/^(?:python[\d.]*|py)$/.test(cabeza) && resto[0] === '-m' && MODULOS_PY.has(resto[1] ?? '')) [cabeza, resto] = [resto[1] ?? '', resto.slice(2)];
    if (cabeza === 'uv' && resto[0] === 'pip') [cabeza, resto] = ['pip', resto.slice(1)];
    if (cabeza === 'git') resto = trasOpciones(resto, GIT_LLEVA);
    if (cabeza === 'docker') {
      resto = trasOpciones(resto, DOCKER_LLEVA);
      if (resto[0] === 'compose') [cabeza, resto] = ['docker compose', trasOpciones(resto.slice(1), DOCKER_LLEVA)];
    }
    // npx ejecuta lo ya instalado igual que descarga: solo su propio «sí, instala» lo dice.
    if (cabeza === 'npx') return resto.some((w) => w === '-y' || w === '--yes');
    const subs = RED_SUBCOMANDOS[cabeza];
    return subs !== undefined && (subs.has(resto[0] ?? '') || subs.has(`${resto[0] ?? ''} ${resto[1] ?? ''}`));
  };
  const lineas = segmentos(comando).map(propias).filter((palabras) => palabras.length > 0);
  if (segmentos(comando, true).map(propias).flatMap(comandos).some(llegaALaRed)) return 'red';
  const esNeutro = (cabeza: string): boolean => NEUTROS.has(cabeza) || (powershell && PS_NEUTROS.has(cabeza));
  const esArchivo = (cabeza: string): boolean => ARCHIVOS.has(cabeza) || (powershell && PS_ARCHIVOS.has(cabeza));
  const reales = lineas.flatMap(comandos).filter((palabras) => !esNeutro(nombre(palabras[0])));
  if (reales.length > 0 && reales.every((palabras) => esArchivo(nombre(palabras[0])))) return esRutaDeMemoria(comando) ? 'memoria' : 'archivos';
  return 'shell';
}

/**
 * La estación de una herramienta, a partir de su nombre y su entrada completa. Lo que no se reconoce va a Shell,
 * y la entrada puede venir vacía: sin ella, un Bash cuenta como Shell y un Read como Archivos.
 */
export function classifyTool(tool: string, input: Record<string, unknown>): Station {
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return esRutaDeMemoria(cad(input.file_path) || cad(input.notebook_path)) ? 'memoria' : 'archivos';
    case 'Grep':
    case 'Glob':
      return esRutaDeMemoria(cad(input.path)) ? 'memoria' : 'archivos';
    case 'Bash':
      return clasificaShell(cad(input.command));
    case 'PowerShell':
      return clasificaShell(cad(input.command), true);
    case 'WebFetch':
    case 'WebSearch':
    case 'Artifact':
      return 'red';
    case 'Agent':
    case 'Task':
    case 'Workflow':
    case 'SendMessage':
    case 'TaskStop':
      return 'agentes';
    case 'Skill':
    case 'ToolSearch':
      return 'skills';
    case 'AskUserQuestion':
    case 'SendUserFile':
      return 'tu';
  }
  if (!tool.startsWith('mcp__')) return 'shell';
  return /^mcp__playwright__/i.test(tool) || /^mcp__[^_].*browser/i.test(tool) || /^mcp__claude-in-chrome__/i.test(tool) ? 'navegador' : 'red';
}

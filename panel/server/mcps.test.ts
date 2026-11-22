import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpError, discoverMcps, isSecretName, mcpFile, parseJsonc, redactArgs, redactText, redactUrl, resolveMcp, summarizeMcps } from './mcps.ts';
import { readMcpServersToml } from './mcpToml.ts';

// Valores que no deben aparecer nunca en lo que sale del servidor.
const SECRETOS = ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', 'SEKRET_ENV_VALUE', 'SEKRET_HEADER_VALUE', 'SEKRET_QUERY_VALUE', 'SEKRET_PASS', 'SEKRET_ARG', 'SEKRET_EXTRA', 'SEKRET_PATH_TOKEN_abc123XYZ789'];

describe('lector de config.toml de Codex', () => {
  const real = `model = "gpt-5"

[mcp_servers.vercel]
url = "https://mcp.vercel.com"

[mcp_servers.playwright]
command = "npx"
args = ["-y", "@playwright/mcp@latest"]

[hooks.state]

[hooks.state."/<x>/config.toml:session_start:0:0"]
trusted_hash = "sha256:5b01"
enabled = true
`;

  it('lee las tablas de los MCP e ignora el resto del archivo', () => {
    const r = readMcpServersToml(real);
    expect(r.map((s) => [s.name, s.incomplete])).toEqual([['vercel', false], ['playwright', false]]);
    expect({ ...r[0]!.table }).toEqual({ url: 'https://mcp.vercel.com' });
    expect({ ...r[1]!.table }).toEqual({ command: 'npx', args: ['-y', '@playwright/mcp@latest'] });
  });

  it('subtablas env y cabeceras, nombres entre comillas, listas de varias líneas y tablas en línea', () => {
    const r = readMcpServersToml(`
# comentario
[mcp_servers."mi servidor"]
command = 'bin/x'   # literal
args = [
  "a",   # uno
  "b\\n",
]
startup_timeout_sec = 20
enabled = true
env = { A = "1", B = "2" }

[mcp_servers."mi servidor".env]
C = "3"

[mcp_servers.otro.http_headers]
Authorization = "Bearer x"
"X-Api" = "y"

[mcp_servers.otro]
url = "https://x.dev/mcp"
`);
    const por = Object.fromEntries(r.map((s) => [s.name, s]));
    expect(por['mi servidor']!.incomplete).toBe(false);
    expect(JSON.parse(JSON.stringify(por['mi servidor']!.table))).toEqual({
      command: 'bin/x',
      args: ['a', 'b\n'],
      startup_timeout_sec: 20,
      enabled: true,
      env: { A: '1', B: '2', C: '3' },
    });
    expect(JSON.parse(JSON.stringify(por.otro!.table))).toEqual({ url: 'https://x.dev/mcp', http_headers: { Authorization: 'Bearer x', 'X-Api': 'y' } });
  });

  it('una cadena de varias líneas con algo parecido a una cabecera no se confunde con una', () => {
    const r = readMcpServersToml(`instructions = """
[mcp_servers.falso]
command = "no"
"""

[mcp_servers.bueno]
command = "si"
`);
    expect(r.map((s) => s.name)).toEqual(['bueno']);
  });

  it('una línea que no se entiende dentro de un MCP lo marca como incompleto sin inventar datos', () => {
    const r = readMcpServersToml(`[mcp_servers.raro]
command = "npx"
args = ["a", ??? ]
otra = 5

[mcp_servers.sano]
command = "x"
`);
    expect(r.map((s) => [s.name, s.incomplete])).toEqual([['raro', true], ['sano', false]]);
    expect(JSON.parse(JSON.stringify(r[0]!.table))).toEqual({ command: 'npx', otra: 5 });
  });

  it('un archivo roto, vacío o con claves peligrosas no lanza ni contamina prototipos', () => {
    expect(readMcpServersToml('')).toEqual([]);
    expect(() => readMcpServersToml('[[[ = = "\n\u0000 \'\'\' sin cerrar')).not.toThrow();
    const r = readMcpServersToml('[mcp_servers.x]\ncommand = "a"\n[mcp_servers.x.__proto__]\npolluted = true\n');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r[0]!.name).toBe('x');
  });
});

describe('parseJsonc', () => {
  it('quita comentarios y comas finales sin tocar el interior de las cadenas', () => {
    const t = `{
  // línea
  "url": "https://x.dev/a//b", /* bloque */
  "texto": "una, } coma /* no */ // ni esto",
  "lista": [1, 2, ],
  "o": { "a": 1, },
}`;
    expect(parseJsonc(t)).toEqual({ url: 'https://x.dev/a//b', texto: 'una, } coma /* no */ // ni esto', lista: [1, 2], o: { a: 1 } });
  });

  it('JSON inválido devuelve undefined', () => {
    expect(parseJsonc('{ "a": ')).toBeUndefined();
    expect(parseJsonc('')).toBeUndefined();
  });
});

describe('ocultación de secretos', () => {
  it('URL: sin credenciales, sin valores de query y sin tokens en la ruta', () => {
    expect(redactUrl('https://x.dev/mcp?key=abc')).toBe('https://x.dev/mcp?key=•••');
    expect(redactUrl('https://user:SEKRET_PASS@x.dev:8443/mcp?a=1&b=2#frag')).toBe('https://x.dev:8443/mcp?a=•••&b=•••');
    expect(redactUrl('https://mcp.vercel.com')).toBe('https://mcp.vercel.com');
    expect(redactUrl('https://x.dev/mcp/')).toBe('https://x.dev/mcp/');
    expect(redactUrl('https://x.dev/SEKRET_PATH_TOKEN_abc123XYZ789/mcp')).toBe('https://x.dev/•••/mcp');
    expect(redactUrl('https://x.dev/${VAR}/mcp?token=${TOKEN}')).toBe('https://x.dev/${VAR}/mcp?token=•••');
    expect(redactUrl('https://x.dev/mcp?solo')).toBe('https://x.dev/mcp?•••');
  });

  it('argumentos: el valor que sigue a una opción con nombre de secreto', () => {
    expect(redactArgs(['-y', 'pkg', '--api-key', 'SEKRET_ARG', '--token=SEKRET_ARG', '--headless', '--browser', 'chromium'])).toEqual([
      '-y',
      'pkg',
      '--api-key',
      '•••',
      '--token=•••',
      '--headless',
      '--browser',
      'chromium',
    ]);
    // Una opción de secreto sin valor (la siguiente es otra opción) no se traga el argumento siguiente.
    expect(redactArgs(['--auth', '--verbose'])).toEqual(['--auth', '--verbose']);
    expect(redactArgs(['-e', 'API_KEY=SEKRET_ARG', 'NOMBRE=ok', '--header', 'Authorization: Bearer SEKRET_ARG', '--header=X-Key: SEKRET_ARG'])).toEqual([
      '-e',
      'API_KEY=•••',
      'NOMBRE=ok',
      '--header',
      'Authorization: •••',
      '--header=X-Key: •••',
    ]);
    expect(redactArgs(['mcp-remote', 'https://x.dev/sse?token=SEKRET_ARG'])).toEqual(['mcp-remote', 'https://x.dev/sse?token=•••']);
  });

  it('texto suelto: Bearer y tokens de formato conocido', () => {
    expect(redactText('Bearer SEKRET_ARG')).toBe('Bearer •••');
    expect(redactText('x ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 y')).toBe('x ••• y');
    expect(redactText('sin secretos aquí')).toBe('sin secretos aquí');
  });

  it('nombres de secreto', () => {
    for (const n of ['--api-key', 'GITHUB_TOKEN', 'client_secret', 'password', 'Authorization', 'bearer_token_env_var']) expect(isSecretName(n), n).toBe(true);
    for (const n of ['note', 'enabled', 'timeout', '--headless']) expect(isSecretName(n), n).toBe(false);
  });
});

describe('descubrimiento de MCPs', () => {
  let tmp: string;
  let proy: string;
  let home: string;
  const crear = (base: string, ruta: string, contenido: string) => {
    mkdirSync(join(base, ruta, '..'), { recursive: true });
    writeFileSync(join(base, ruta), contenido);
  };
  const claudeJson = (d: unknown) => crear(home, '.claude.json', JSON.stringify(d));

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-mcps-'));
    proy = join(tmp, 'proy');
    home = join(tmp, 'home');
    mkdirSync(proy);
    mkdirSync(home);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('un proyecto: .mcp.json, privados de ~/.claude.json, Copilot, Codex y OpenCode, agrupados por nombre', async () => {
    crear(proy, '.mcp.json', JSON.stringify({ mcpServers: { web: { type: 'http', url: 'https://x.dev/mcp' }, db: { command: 'npx', args: ['-y', 'db-mcp'], env: { DB_URL: 'x' } } } }));
    claudeJson({ mcpServers: { deusuario: { command: 'u' } }, projects: { [proy]: { mcpServers: { web: { type: 'http', url: 'https://x.dev/mcp' }, privado: { command: 'p' } } }, '/otro': { mcpServers: { ajeno: { command: 'a' } } } } });
    crear(proy, '.vscode/mcp.json', '{\n // jsonc\n "servers": { "web": { "type": "http", "url": "https://x.dev/mcp" }, "db": { "command": "npx", "args": ["-y", "db-mcp", "--otro"] }, }\n}');
    crear(proy, '.codex/config.toml', '[mcp_servers.db]\ncommand = "npx"\nargs = ["-y", "db-mcp"]\n');
    crear(proy, 'opencode.jsonc', '{ "mcp": { "db": { "type": "local", "command": ["npx", "-y", "db-mcp"], "environment": { "DB_URL": "x" } }, "nube": { "type": "remote", "url": "https://n.dev/mcp", "headers": { "X-A": "b" } } } }');

    const lista = summarizeMcps(await discoverMcps({ kind: 'project', path: proy, home }));
    expect(lista.map((m) => [m.name, m.diverges, m.copies.map((c) => c.label)])).toEqual([
      ['db', true, ['Claude', 'Copilot', 'Codex', 'OpenCode']],
      ['nube', false, ['OpenCode']],
      ['privado', false, ['Claude (local)']],
      ['web', false, ['Claude', 'Claude (local)', 'Copilot']],
    ]);
    const db = lista[0]!;
    expect(db.copies.map((c) => [c.agent, c.path, c.transport, c.command, c.args])).toEqual([
      ['claude', '.mcp.json', 'stdio', 'npx', ['-y', 'db-mcp']],
      ['copilot', '.vscode/mcp.json', 'stdio', 'npx', ['-y', 'db-mcp', '--otro']],
      ['codex', '.codex/config.toml', 'stdio', 'npx', ['-y', 'db-mcp']],
      ['opencode', 'opencode.jsonc', 'stdio', 'npx', ['-y', 'db-mcp']],
    ]);
    expect(db.copies[0]!.envNames).toEqual(['DB_URL']);
    expect(db.copies[3]!.envNames).toEqual(['DB_URL']);
    expect(lista[1]!.copies[0]).toMatchObject({ transport: 'http', url: 'https://n.dev/mcp', headerNames: ['X-A'], command: null });
    expect(lista[2]!.copies[0]!.path).toBe('~/.claude.json');
    // Los de usuario y los de otros proyectos de ~/.claude.json no salen en el proyecto.
    expect(lista.map((m) => m.name)).not.toContain('deusuario');
    expect(lista.map((m) => m.name)).not.toContain('ajeno');
    // Un proyecto sin ningún archivo no tiene MCPs.
    expect(await discoverMcps({ kind: 'project', path: join(tmp, 'vacio'), home })).toEqual([]);
  });

  it('el harness incluye los MCP de los subagentes; un proyecto normal no', async () => {
    mkdirSync(join(proy, 'adapters', 'claude'), { recursive: true });
    crear(
      proy,
      'adapters/claude/agents.json',
      JSON.stringify({
        implementer: { description: 'x', mcpServers: ['ya-configurado'] },
        qa: { description: 'y', mcpServers: [{ playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--headless'] } }] },
        extra: { mcpServers: { otro: { command: 'o' } } },
      }),
    );
    const harness = summarizeMcps(await discoverMcps({ kind: 'project', path: proy, home, harness: true }));
    expect(harness.map((m) => [m.name, m.copies.map((c) => [c.label, c.path])])).toEqual([
      ['otro', [['Claude (subagente extra)', 'adapters/claude/agents.json']]],
      ['playwright', [['Claude (subagente qa)', 'adapters/claude/agents.json']]],
    ]);
    expect(harness[1]!.copies[0]).toMatchObject({ agent: 'claude', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--headless'], openable: true });
    expect(await discoverMcps({ kind: 'project', path: proy, home })).toEqual([]);
  });

  it('usuario: ~/.claude.json, Codex, OpenCode, plugins y conectores de claude.ai', async () => {
    claudeJson({
      mcpServers: { propio: { command: 'bin' } },
      claudeAiMcpEverConnected: ['claude.ai Google Drive', 'claude.ai Claude Docs', 'sin prefijo', 42, ''],
      projects: { [proy]: { mcpServers: { local: { command: 'l' } } } },
    });
    crear(home, '.codex/config.toml', '[mcp_servers.vercel]\nurl = "https://mcp.vercel.com"\n\n[mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "@playwright/mcp@latest"]\n\n[hooks.state."/<x>/config.toml:session_start:0:0"]\nenabled = true\n');
    crear(home, '.config/opencode/opencode.json', '{ "mcp": { "propio": { "type": "local", "command": ["bin"] } } }');
    const plug = join(home, '.claude', 'plugins', 'cache', 'vercel', '1');
    const plano = join(home, '.claude', 'plugins', 'cache', 'linear', '1');
    crear(plug, '.mcp.json', JSON.stringify({ mcpServers: { vercel: { type: 'http', url: 'https://mcp.vercel.com', note: 'Oficial. Usa OAuth.' } } }));
    crear(plano, '.mcp.json', JSON.stringify({ linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } }));
    crear(home, '.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'vercel@oficial': [{ installPath: plug }], 'linear@oficial': [{ installPath: plano }] } }));

    const lista = summarizeMcps(await discoverMcps({ kind: 'user', home }));
    expect(lista.map((m) => [m.name, m.diverges, m.copies.map((c) => c.label)])).toEqual([
      ['Claude Docs', false, ['claude.ai']],
      ['Google Drive', false, ['claude.ai']],
      ['linear', false, ['plugin linear']],
      ['playwright', false, ['Codex']],
      ['propio', false, ['Claude', 'OpenCode']],
      ['sin prefijo', false, ['claude.ai']],
      ['vercel', false, ['Codex', 'plugin vercel']],
    ]);
    // Mismo servidor en el plugin y en Codex: sin aviso aunque el plugin traiga una nota.
    const vercel = lista.find((m) => m.name === 'vercel')!;
    expect(vercel.copies.map((c) => [c.transport, c.url])).toEqual([['http', 'https://mcp.vercel.com'], ['http', 'https://mcp.vercel.com']]);
    expect(vercel.copies[1]!.extra).toEqual({ note: 'Oficial. Usa OAuth.' });
    expect(vercel.copies[1]!.path).toBe('~/.claude/plugins/cache/vercel/1/.mcp.json');
    // Un conector: solo nombre y origen, sin archivo ni configuración.
    expect(lista[1]!.copies[0]).toEqual({ agent: 'claude', label: 'claude.ai', path: null, transport: 'connector', command: null, args: [], url: null, envNames: [], headerNames: [], extra: {}, incomplete: false, openable: false });
    // Los MCP privados de un proyecto no son de usuario.
    expect(lista.map((m) => m.name)).not.toContain('local');
  });

  it('avisa si la configuración difiere entre copias y no cuenta conectores ni copias incompletas', async () => {
    crear(proy, '.mcp.json', JSON.stringify({ mcpServers: { a: { command: 'x', args: ['1'] }, b: { command: 'x' }, c: { type: 'http', url: 'https://u.dev/mcp?k=1' } } }));
    crear(proy, '.codex/config.toml', '[mcp_servers.a]\ncommand = "x"\nargs = ["2"]\n[mcp_servers.b]\ncommand = "x"\nenabled = false\n[mcp_servers.c]\nurl = "https://u.dev/mcp?k=2"\nmal = ???\n');
    const m = Object.fromEntries(summarizeMcps(await discoverMcps({ kind: 'project', path: proy, home })).map((x) => [x.name, x]));
    expect(m.a!.diverges).toBe(true);
    // `extra` (enabled) no cuenta.
    expect(m.b!.diverges).toBe(false);
    // Dos copias que solo difieren en el valor de la query (oculto) son iguales; y la incompleta no se compara.
    expect(m.c!.diverges).toBe(false);
    expect(m.c!.copies.map((c) => [c.label, c.incomplete])).toEqual([['Claude', false], ['Codex', true]]);
  });

  it('ni un archivo ilegible ni un MCP sin comando o URL rompen el listado', async () => {
    crear(proy, '.mcp.json', '{ no es json');
    crear(proy, '.codex/config.toml', '\u0000\u0001 [[[');
    crear(proy, 'opencode.json', JSON.stringify({ mcp: { x: { type: 'local' }, y: 'texto', z: { type: 'remote' } } }));
    crear(proy, '.vscode/mcp.json', JSON.stringify({ servers: { solo: { type: 'stdio' } } }));
    claudeJson('no es un objeto');
    expect(await discoverMcps({ kind: 'project', path: proy, home })).toEqual([]);
    expect(await discoverMcps({ kind: 'user', home })).toEqual([]);
  });

  it('no sigue enlaces simbólicos: ni el archivo ni una carpeta de configuración del proyecto', async () => {
    crear(tmp, 'fuera/mcp.json', JSON.stringify({ servers: { fuera: { command: 'f' } } }));
    mkdirSync(join(tmp, 'fuera', 'codex'));
    crear(tmp, 'fuera/codex/config.toml', '[mcp_servers.fuera2]\ncommand = "f"\n');
    symlinkSync(join(tmp, 'fuera'), join(proy, '.vscode'));
    symlinkSync(join(tmp, 'fuera', 'codex'), join(proy, '.codex'));
    symlinkSync(join(tmp, 'fuera', 'mcp.json'), join(proy, '.mcp.json'));
    expect(await discoverMcps({ kind: 'project', path: proy, home })).toEqual([]);
  });

  it('nunca expone valores de variables, cabeceras, query, credenciales ni argumentos secretos', async () => {
    crear(
      proy,
      '.mcp.json',
      JSON.stringify({
        mcpServers: {
          gh: {
            type: 'http',
            url: 'https://user:SEKRET_PASS@x.dev/SEKRET_PATH_TOKEN_abc123XYZ789/mcp?key=SEKRET_QUERY_VALUE#SEKRET_QUERY_VALUE',
            headers: { Authorization: 'Bearer SEKRET_HEADER_VALUE', 'X-Otro': 'SEKRET_HEADER_VALUE' },
            note: 'ok',
            api_key: 'SEKRET_EXTRA',
            clientSecret: 'SEKRET_EXTRA',
            oauth: { clientId: 'SEKRET_EXTRA' },
            lista: ['SEKRET_EXTRA'],
          },
          local: {
            command: 'node',
            args: ['s.js', '--api-key', 'SEKRET_ARG', '--token=SEKRET_ARG', '-e', 'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', '--header', 'Authorization: Bearer SEKRET_HEADER_VALUE'],
            env: { GITHUB_TOKEN: 'SEKRET_ENV_VALUE', OTRA: 'SEKRET_ENV_VALUE' },
          },
        },
      }),
    );
    crear(proy, '.codex/config.toml', '[mcp_servers.gh]\nurl = "https://x.dev/mcp?key=SEKRET_QUERY_VALUE"\nbearer_token_env_var = "SEKRET_EXTRA"\nnote = "ok"\n[mcp_servers.gh.http_headers]\nX-Otro = "SEKRET_HEADER_VALUE"\n[mcp_servers.gh.env_http_headers]\nX-Env = "SEKRET_ENV_VALUE"\n[mcp_servers.local]\ncommand = "node"\n[mcp_servers.local.env]\nGITHUB_TOKEN = "SEKRET_ENV_VALUE"\n');
    crear(proy, 'opencode.json', JSON.stringify({ mcp: { local: { type: 'local', command: ['node', 's.js', '--password', 'SEKRET_ARG'], environment: { GITHUB_TOKEN: 'SEKRET_ENV_VALUE' } }, gh: { type: 'remote', url: 'https://x.dev/mcp?key=SEKRET_QUERY_VALUE', headers: { Authorization: 'SEKRET_HEADER_VALUE' } } } }));
    claudeJson({ projects: { [proy]: { mcpServers: { local: { command: 'node', env: { GITHUB_TOKEN: 'SEKRET_ENV_VALUE' } } } } } });

    const lista = summarizeMcps(await discoverMcps({ kind: 'project', path: proy, home }));
    const serializado = JSON.stringify(lista);
    for (const s of SECRETOS) expect(serializado, s).not.toContain(s);
    const gh = lista.find((m) => m.name === 'gh')!.copies[0]!;
    expect(gh.url).toBe('https://x.dev/•••/mcp?key=•••');
    expect(gh.headerNames).toEqual(['Authorization', 'X-Otro']);
    expect(gh.extra).toEqual({ note: 'ok' });
    const local = lista.find((m) => m.name === 'local')!.copies[0]!;
    expect(local.args).toEqual(['s.js', '--api-key', '•••', '--token=•••', '-e', 'GITHUB_TOKEN=•••', '--header', 'Authorization: •••']);
    expect(local.envNames).toEqual(['GITHUB_TOKEN', 'OTRA']);
    // Codex: las cabeceras de las dos subtablas dan nombres, y `bearer_token_env_var` no sale.
    const codex = lista.find((m) => m.name === 'gh')!.copies.find((c) => c.agent === 'codex')!;
    expect(codex.headerNames).toEqual(['X-Otro', 'X-Env']);
    expect(codex.extra).toEqual({ note: 'ok' });
  });

  describe('resolver y abrir', () => {
    it('resolveMcp: 400 si el nombre o la copia no son válidos, 404 si no existen', async () => {
      crear(proy, '.mcp.json', JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
      const grupos = await discoverMcps({ kind: 'project', path: proy, home });
      expect(resolveMcp(grupos, 'a').index).toBe(0);
      const estado = (nombre: unknown, copia?: unknown) => {
        try {
          resolveMcp(grupos, nombre, copia);
          return 200;
        } catch (e) {
          return e instanceof McpError ? e.status : -1;
        }
      };
      expect([estado(''), estado(7), estado('a', -1), estado('a', '0'), estado('a', 1.5)]).toEqual([400, 400, 400, 400, 400]);
      expect([estado('falta'), estado('a', 3), estado(join(proy, '.mcp.json'))]).toEqual([404, 404, 404]);
    });

    it('mcpFile devuelve el archivo de la copia y rechaza los conectores y los archivos que ya no existen', async () => {
      crear(proy, '.mcp.json', JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
      claudeJson({ claudeAiMcpEverConnected: ['claude.ai Drive'] });
      const grupos = await discoverMcps({ kind: 'project', path: proy, home });
      expect(await mcpFile(resolveMcp(grupos, 'a').found)).toBe(join(proy, '.mcp.json'));
      const usuario = await discoverMcps({ kind: 'user', home });
      await expect(mcpFile(resolveMcp(usuario, 'Drive').found)).rejects.toMatchObject({ status: 400 });
      rmSync(join(proy, '.mcp.json'));
      await expect(mcpFile(resolveMcp(grupos, 'a').found)).rejects.toMatchObject({ status: 404 });
    });
  });
});

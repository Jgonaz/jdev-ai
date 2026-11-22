import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { LEGACY, itemSource } from './backlog-fixtures.ts';
import { startServer } from './main.ts';
import { SkillError } from './skills.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Json = Record<string, any>;

describe('API de proyectos: backlog, guías y cambios', () => {
  const token = 'd'.repeat(64);
  const sock = `jdev-test-proj-${process.pid}-${Date.now().toString(36)}`;
  const auth = { Authorization: `Bearer ${token}` };
  let tmp: string;
  let proy: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  // Carpetas que el panel habría abierto en el editor (se inyecta un lanzador falso: no se lanza `code`).
  const abiertas: string[] = [];
  let editorSinCode = false;

  const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  const commit = (dir: string, msg = 'x') => {
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--no-verify', '--allow-empty', '-m', msg);
  };
  const item = (estado: string, id: string, contenido = itemSource(id, estado)) => {
    mkdirSync(join(proy, 'docs', 'backlog', estado), { recursive: true });
    writeFileSync(join(proy, 'docs', 'backlog', estado, `${id}.md`), contenido);
  };
  const api = (metodo: string, ruta: string, cuerpo?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  const json = async (r: Response) => (await r.json()) as Json;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-proj-api-'));
    const harness = join(tmp, 'harness');
    proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    git(proy, 'init', '-q', '-b', 'main');
    item('backlog', 'BL-20261024-1145-a');
    item('backlog', 'BL-20261024-1145-viejo', LEGACY);
    item('done', 'BL-20261024-1145-hecho');
    mkdirSync(join(proy, 'docs', 'user-guides', 'sub'), { recursive: true });
    writeFileSync(join(proy, 'docs', 'user-guides', 'uso.md'), '# Cómo se usa\n\nTexto.\n');
    writeFileSync(join(proy, 'docs', 'user-guides', 'sub', 'otra.md'), 'Sin título\n');
    writeFileSync(join(proy, 'docs', 'secreto.md'), '# Secreto\n');
    symlinkSync(join(proy, 'docs', 'secreto.md'), join(proy, 'docs', 'user-guides', 'enlace.md'));
    const skillMd = (nombre: string, cuerpo = 'Cuerpo.') => `---\nname: ${nombre}\ndescription: Hace ${nombre}\n---\n${cuerpo}\n`;
    for (const [dir, cuerpo] of [['.claude', 'Uno.'], ['.agents', 'Uno.'], ['.github', 'Otro.']] as const) {
      mkdirSync(join(proy, dir, 'skills', 'uno'), { recursive: true });
      writeFileSync(join(proy, dir, 'skills', 'uno', 'SKILL.md'), skillMd('uno', cuerpo));
    }
    writeFileSync(join(proy, '.claude', 'skills', 'uno', 'extra.md'), 'x');
    mkdirSync(join(tmp, 'home', '.claude', 'skills', 'synced', 'b', 'mia'), { recursive: true });
    writeFileSync(join(tmp, 'home', '.claude', 'skills', 'synced', 'b', 'mia', 'SKILL.md'), skillMd('mia'));
    // MCPs: uno con secretos en el proyecto y en Codex, uno privado del proyecto en ~/.claude.json, el del subagente del harness y un conector.
    writeFileSync(join(proy, '.mcp.json'), JSON.stringify({ mcpServers: { web: { type: 'http', url: 'https://x.dev/mcp?key=SEKRET_QUERY_VALUE', headers: { Authorization: 'Bearer SEKRET_HEADER_VALUE' } }, db: { command: 'npx', args: ['-y', 'db-mcp', '--api-key', 'SEKRET_ARG'], env: { GITHUB_TOKEN: 'SEKRET_ENV_VALUE' } } } }));
    mkdirSync(join(proy, '.codex'), { recursive: true });
    writeFileSync(join(proy, '.codex', 'config.toml'), '[mcp_servers.web]\nurl = "https://x.dev/mcp?key=SEKRET_QUERY_VALUE"\n');
    writeFileSync(
      join(tmp, 'home', '.claude.json'),
      JSON.stringify({ claudeAiMcpEverConnected: ['claude.ai Google Drive'], mcpServers: { usuario: { command: 'u', env: { K: 'SEKRET_ENV_VALUE' } } }, projects: { [proy]: { mcpServers: { privado: { command: 'p' } } } } }),
    );
    mkdirSync(join(harness, 'adapters', 'claude'), { recursive: true });
    writeFileSync(join(harness, 'adapters', 'claude', 'agents.json'), JSON.stringify({ qa: { mcpServers: [{ playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83'] } }] } }));
    commit(proy, 'inicio');

    // Worktrees reales: «uno» con 2 commits propios y cambios sin commit; «dos» limpio.
    const wts = join(harness, 'projects', 'foo.worktrees');
    mkdirSync(wts);
    git(proy, 'worktree', 'add', '-q', '-b', 'feat/uno', join(wts, 'uno'));
    git(proy, 'worktree', 'add', '-q', '-b', 'feat/dos', join(wts, 'dos'));
    commit(join(wts, 'uno'), 'a');
    commit(join(wts, 'uno'), 'b');
    writeFileSync(join(wts, 'uno', 'nuevo.txt'), 'x');
    commit(proy, 'principal');

    mkdirSync(join(tmp, 'dist'));
    cfg = tmuxConfig(harness, {}, {
      socket: sock,
      confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'),
      launcher: () => ['sh', '-c', 'sleep 60'],
    });
    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: join(tmp, 'state'),
      claudeConfigDir: join(tmp, 'claude'),
      uploadsDir: join(tmp, 'uploads'),
      homeDir: join(tmp, 'home'),
      openEditor: async (carpeta) => {
        if (editorSinCode) throw new SkillError(501, 'No se encontró el comando «code».');
        abiertas.push(carpeta);
      },
      pollMs: 200,
      stateFallbackMs: 200,
      backlogFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    let socketPath = '';
    try {
      socketPath = (await execFileAsync('tmux', ['-L', sock, 'start-server', ';', 'display-message', '-p', '#{socket_path}'], {
        env: { ...process.env, TMUX: '' },
      })).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exige token en todas las rutas', async () => {
    for (const [metodo, ruta] of [
      ['GET', '/api/projects/foo/backlog'],
      ['GET', '/api/projects/foo/backlog/BL-20261024-1145-a'],
      ['POST', '/api/projects/foo/backlog/BL-20261024-1145-a/move'],
      ['GET', '/api/projects/foo/guides'],
      ['GET', '/api/projects/foo/guides/content?path=uso.md'],
      ['GET', '/api/projects/foo/skills'],
      ['GET', '/api/projects/foo/skills/content?skill=uno'],
      ['POST', '/api/projects/foo/skills/open'],
      ['GET', '/api/user-skills'],
      ['GET', '/api/user-skills/content?skill=mia'],
      ['POST', '/api/user-skills/open'],
      ['GET', '/api/projects/foo/mcps'],
      ['POST', '/api/projects/foo/mcps/open'],
      ['GET', '/api/user-mcps'],
      ['POST', '/api/user-mcps/open'],
      ['GET', '/api/projects/foo/changes'],
      ['GET', '/api/projects/foo/changes/main'],
      ['GET', '/api/projects/foo/changes/wt/uno'],
      ['GET', '/api/projects/foo/changes/wt/uno/diff?path=nuevo.txt'],
      ['GET', '/api/changes'],
    ] as const) {
      expect((await fetch(`${base}${ruta}`, { method: metodo })).status, ruta).toBe(401);
    }
  });

  it('lista el backlog con los campos de las tarjetas y los cambios sin commit', async () => {
    const r = await api('GET', '/api/projects/foo/backlog');
    expect(r.status).toBe(200);
    const c = await json(r);
    expect(c.hasBacklog).toBe(true);
    expect(c.pending).toBe(0);
    expect(c.items.map((i: Json) => [i.id, i.status])).toEqual([
      ['BL-20261024-1145-a', 'backlog'],
      ['BL-20261024-1145-viejo', 'backlog'],
      ['BL-20261024-1145-hecho', 'done'],
    ]);
    expect(Object.keys(c.items[0]).sort()).toEqual(
      ['created', 'etag', 'file', 'id', 'priority', 'readSeconds', 'status', 'summary', 'title', 'type', 'updated', 'warnings'].sort(),
    );
    expect(c.items[1].warnings).toEqual(['legacy']);
    // El harness no tiene backlog.
    expect(await json(await api('GET', '/api/projects/harness/backlog'))).toEqual({ items: [], pending: 0, hasBacklog: false });
  });

  it('devuelve el detalle y valida proyecto e identificador', async () => {
    const c = await json(await api('GET', '/api/projects/foo/backlog/BL-20261024-1145-a'));
    expect(c.item).toMatchObject({
      id: 'BL-20261024-1145-a',
      path: 'docs/backlog/backlog/BL-20261024-1145-a.md',
      source: itemSource('BL-20261024-1145-a', 'backlog'),
      header: { priority: 'alta' },
    });
    expect(c.item.body.startsWith('## Resumen')).toBe(true);
    expect((await api('GET', '/api/projects/foo/backlog/BL-20261024-1145-zz')).status).toBe(404);
    expect((await api('GET', '/api/projects/foo/backlog/..%2F..%2Fsecreto')).status).toBe(400);
    expect((await api('GET', '/api/projects/foo/backlog/BL-20261024-1145-a.md')).status).toBe(400);
    const sinProyecto = await api('GET', '/api/projects/nada/backlog');
    expect(sinProyecto.status).toBe(404);
    expect((await json(sinProyecto)).error).toBe('El proyecto no existe.');
    expect((await api('POST', '/api/projects/foo/backlog')).status).toBe(405);
  });

  it('mueve con git mv, avisa por /ws/events y cuenta el cambio sin commit', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    const evento = new Promise<Json>((ok) => {
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as Json;
        if (m.type === 'backlog') ok(m);
      });
    });
    await new Promise((ok) => ws.once('open', ok));
    try {
      const { item: actual } = await json(await api('GET', '/api/projects/foo/backlog/BL-20261024-1145-a'));
      const ruta = '/api/projects/foo/backlog/BL-20261024-1145-a/move';

      const ajeno = await api('POST', ruta, { to: 'todo', etag: actual.etag }, { Origin: 'http://evil.example' });
      expect(ajeno.status).toBe(403);
      const conflicto = await api('POST', ruta, { to: 'todo', etag: 'viejo' });
      expect(conflicto.status).toBe(409);
      expect((await json(conflicto)).item.etag).toBe(actual.etag);
      expect((await api('POST', ruta, { to: 'backlog', etag: actual.etag })).status).toBe(400);

      const r = await api('POST', ruta, { to: 'todo', etag: actual.etag }, { Origin: `http://localhost:${srv.port}` });
      expect(r.status).toBe(200);
      const { item: movido } = await json(r);
      expect(movido).toMatchObject({ status: 'todo', path: 'docs/backlog/todo/BL-20261024-1145-a.md' });
      expect(readFileSync(join(proy, movido.path), 'utf8')).toContain("status: 'todo' # estado");
      expect(await evento).toEqual({ type: 'backlog', project: 'foo' });
      expect(git(proy, 'status', '--porcelain', '--', 'docs/backlog').trim()).toMatch(/^R  docs\/backlog\/backlog\/BL-20261024-1145-a\.md -> docs\/backlog\/todo\//);
      expect((await json(await api('GET', '/api/projects/foo/backlog'))).pending).toBe(1);

      const viejo = (await json(await api('GET', '/api/projects/foo/backlog/BL-20261024-1145-viejo'))).item;
      const legacy = await api('POST', '/api/projects/foo/backlog/BL-20261024-1145-viejo/move', { to: 'todo', etag: viejo.etag });
      expect(legacy.status).toBe(422);
      expect((await json(legacy)).error).toContain('formato antiguo');
      expect((await api('POST', ruta, 'no-json')).status).toBe(400);
    } finally {
      ws.close();
    }
  });

  it('avisa de cambios externos en el backlog', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/events`, { headers: { ...auth, Origin: `http://localhost:${srv.port}` } });
    const evento = new Promise<Json>((ok) => {
      ws.on('message', (d) => {
        const m = JSON.parse(String(d)) as Json;
        if (m.type === 'backlog') ok(m);
      });
    });
    await new Promise((ok) => ws.once('open', ok));
    try {
      item('in-progress', 'BL-20261024-1145-externo');
      expect(await evento).toEqual({ type: 'backlog', project: 'foo' });
    } finally {
      ws.close();
    }
  });

  it('lista y lee guías sin salir de docs/user-guides', async () => {
    const lista = await json(await api('GET', '/api/projects/foo/guides'));
    expect(lista.guides.map((g: Json) => [g.path, g.title])).toEqual([
      ['sub/otra.md', 'otra'],
      ['uso.md', 'Cómo se usa'],
    ]);
    expect(typeof lista.guides[0].updated).toBe('number');
    const ok = await json(await api('GET', '/api/projects/foo/guides/content?path=uso.md'));
    expect(ok).toEqual({ path: 'uso.md', title: 'Cómo se usa', source: '# Cómo se usa\n\nTexto.\n' });
    expect((await api('GET', `/api/projects/foo/guides/content?path=${encodeURIComponent('../secreto.md')}`)).status).toBe(403);
    expect((await api('GET', `/api/projects/foo/guides/content?path=${encodeURIComponent('sub/../../secreto.md')}`)).status).toBe(403);
    expect((await api('GET', `/api/projects/foo/guides/content?path=${encodeURIComponent(join(proy, 'docs', 'secreto.md'))}`)).status).toBe(403);
    expect((await api('GET', '/api/projects/foo/guides/content?path=enlace.md')).status).toBe(403);
    expect((await api('GET', '/api/projects/foo/guides/content?path=falta.md')).status).toBe(404);
    expect((await api('GET', '/api/projects/foo/guides/content?path=uso.txt')).status).toBe(400);
    expect((await api('GET', '/api/projects/foo/guides/content')).status).toBe(400);
    expect(await json(await api('GET', '/api/projects/harness/guides'))).toEqual({ guides: [] });
  });

  it('lista las skills de un proyecto agrupadas por nombre, y el harness sin ninguna', async () => {
    const lista = await json(await api('GET', '/api/projects/foo/skills'));
    expect(lista.skills).toHaveLength(1);
    const [uno] = lista.skills;
    expect([uno.name, uno.description, uno.diverges]).toEqual(['uno', 'Hace uno', true]);
    expect(uno.copies.map((c: Json) => [c.agent, c.path])).toEqual([
      ['claude', '.claude/skills/uno'],
      ['codex', '.agents/skills/uno'],
      ['copilot', '.github/skills/uno'],
    ]);
    expect(JSON.stringify(lista)).not.toContain(tmp);
    expect(await json(await api('GET', '/api/projects/harness/skills'))).toEqual({ skills: [] });
    expect((await api('GET', '/api/projects/nada/skills')).status).toBe(404);
  });

  it('lee el contenido de una skill por nombre y copia, nunca por ruta', async () => {
    const c0 = await json(await api('GET', '/api/projects/foo/skills/content?skill=uno'));
    expect(c0).toMatchObject({
      name: 'uno',
      copy: 0,
      agent: 'claude',
      frontmatter: { name: 'uno', description: 'Hace uno' },
      body: 'Uno.\n',
      files: ['extra.md'],
    });
    const c2 = await json(await api('GET', '/api/projects/foo/skills/content?skill=uno&copy=2'));
    expect([c2.agent, c2.body]).toEqual(['copilot', 'Otro.\n']);
    for (const [q, estado] of [
      ['skill=falta', 404],
      ['skill=uno&copy=9', 404],
      ['skill=uno&copy=-1', 400],
      ['skill=uno&copy=x', 400],
      ['', 400],
      [`skill=${encodeURIComponent('../../etc/passwd')}`, 404],
      [`skill=${encodeURIComponent(join(proy, '.claude', 'skills', 'uno'))}`, 404],
    ] as const) {
      expect((await api('GET', `/api/projects/foo/skills/content?${q}`)).status, q).toBe(estado);
    }
    expect((await api('POST', '/api/projects/foo/skills')).status).toBe(405);
    expect((await api('GET', '/api/projects/foo/skills/open')).status).toBe(405);
    expect((await api('GET', '/api/projects/foo/skills/otro')).status).toBe(404);
  });

  it('abre en el editor solo la carpeta de una skill descubierta, con protección de origen', async () => {
    abiertas.length = 0;
    const ok = await api('POST', '/api/projects/foo/skills/open', { skill: 'uno', copy: 1 });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ opened: true });
    expect(abiertas).toEqual([join(proy, '.agents', 'skills', 'uno')]);
    // Sin copia, la de por defecto.
    expect((await api('POST', '/api/projects/foo/skills/open', { skill: 'uno' })).status).toBe(200);
    expect(abiertas[1]).toBe(join(proy, '.claude', 'skills', 'uno'));
    // Una ruta enviada por el cliente no abre nada.
    for (const cuerpo of [{ skill: join(proy, '.claude', 'skills', 'uno') }, { skill: 'falta' }, { skill: 'uno', copy: 7 }, { skill: 'uno', copy: '1' }, {}]) {
      expect((await api('POST', '/api/projects/foo/skills/open', cuerpo)).status, JSON.stringify(cuerpo)).toBeGreaterThanOrEqual(400);
    }
    expect(abiertas).toHaveLength(2);
    // Un origen ajeno se rechaza antes de tocar nada.
    const ajeno = await api('POST', '/api/projects/foo/skills/open', { skill: 'uno' }, { Origin: 'http://evil.example' });
    expect(ajeno.status).toBe(403);
    expect(abiertas).toHaveLength(2);
    // Sin `code` instalado, el panel lo explica.
    editorSinCode = true;
    try {
      const sin = await api('POST', '/api/projects/foo/skills/open', { skill: 'uno' });
      expect(sin.status).toBe(501);
      expect((await json(sin)).error).toMatch(/code/);
    } finally {
      editorSinCode = false;
    }
  });

  it('lista, lee y abre las skills de usuario del home inyectado', async () => {
    const lista = await json(await api('GET', '/api/user-skills'));
    expect(lista.skills.map((s: Json) => [s.name, s.copies[0].label, s.copies[0].path])).toEqual([
      ['mia', 'Claude (claude.ai)', '~/.claude/skills/synced/b/mia'],
    ]);
    const c = await json(await api('GET', '/api/user-skills/content?skill=mia'));
    expect(c).toMatchObject({ name: 'mia', body: 'Cuerpo.\n', files: [] });
    expect((await api('GET', '/api/user-skills/content?skill=uno')).status).toBe(404);
    abiertas.length = 0;
    expect((await api('POST', '/api/user-skills/open', { skill: 'mia', copy: 0 })).status).toBe(200);
    expect(abiertas).toEqual([join(tmp, 'home', '.claude', 'skills', 'synced', 'b', 'mia')]);
    expect((await api('GET', '/api/user-skills/otro')).status).toBe(404);
  });

  it('lista los MCPs de un proyecto y del harness, sin ningún valor secreto en la respuesta', async () => {
    const respuesta = await api('GET', '/api/projects/foo/mcps');
    expect(respuesta.status).toBe(200);
    const texto = await respuesta.text();
    for (const s of ['SEKRET_QUERY_VALUE', 'SEKRET_HEADER_VALUE', 'SEKRET_ARG', 'SEKRET_ENV_VALUE']) expect(texto, s).not.toContain(s);
    const lista = JSON.parse(texto) as { mcps: Json[] };
    expect(lista.mcps.map((m) => [m.name, m.diverges, m.copies.map((c: Json) => c.label)])).toEqual([
      ['db', false, ['Claude']],
      ['privado', false, ['Claude (local)']],
      ['web', true, ['Claude', 'Codex']],
    ]);
    const web = lista.mcps[2]!.copies[0];
    expect(web).toMatchObject({ transport: 'http', url: 'https://x.dev/mcp?key=•••', headerNames: ['Authorization'], path: '.mcp.json', openable: true });
    expect(lista.mcps[0]!.copies[0]).toMatchObject({ command: 'npx', args: ['-y', 'db-mcp', '--api-key', '•••'], envNames: ['GITHUB_TOKEN'] });
    // La respuesta no lleva rutas absolutas.
    expect(texto).not.toContain(tmp);
    // El harness trae los de sus subagentes (y no los privados del proyecto foo).
    const harness = await json(await api('GET', '/api/projects/harness/mcps'));
    expect(harness.mcps.map((m: Json) => [m.name, m.copies[0].label])).toEqual([['playwright', 'Claude (subagente qa)']]);
    expect((await api('GET', '/api/projects/nada/mcps')).status).toBe(404);
  });

  it('MCPs: métodos y rutas no válidos', async () => {
    expect((await api('POST', '/api/projects/foo/mcps')).status).toBe(405);
    expect((await api('GET', '/api/projects/foo/mcps/open')).status).toBe(405);
    expect((await api('GET', '/api/projects/foo/mcps/content')).status).toBe(404);
    expect((await api('POST', '/api/user-mcps')).status).toBe(405);
    expect((await api('GET', '/api/user-mcps/otro')).status).toBe(404);
  });

  it('abre en el editor solo el archivo de un MCP descubierto, con protección de origen', async () => {
    abiertas.length = 0;
    const ok = await api('POST', '/api/projects/foo/mcps/open', { mcp: 'web', copy: 1 });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ opened: true });
    expect(abiertas).toEqual([join(proy, '.codex', 'config.toml')]);
    expect((await api('POST', '/api/projects/foo/mcps/open', { mcp: 'web' })).status).toBe(200);
    expect(abiertas[1]).toBe(join(proy, '.mcp.json'));
    // Un MCP privado se abre en ~/.claude.json; un subagente, en agents.json del harness.
    expect((await api('POST', '/api/projects/foo/mcps/open', { mcp: 'privado' })).status).toBe(200);
    expect((await api('POST', '/api/projects/harness/mcps/open', { mcp: 'playwright' })).status).toBe(200);
    expect(abiertas.slice(2)).toEqual([join(tmp, 'home', '.claude.json'), join(tmp, 'harness', 'adapters', 'claude', 'agents.json')]);
    // Una ruta enviada por el cliente no abre nada.
    for (const cuerpo of [{ mcp: join(proy, '.mcp.json') }, { mcp: 'falta' }, { mcp: 'web', copy: 7 }, { mcp: 'web', copy: '1' }, { file: join(proy, '.mcp.json') }, {}]) {
      expect((await api('POST', '/api/projects/foo/mcps/open', cuerpo)).status, JSON.stringify(cuerpo)).toBeGreaterThanOrEqual(400);
    }
    expect(abiertas).toHaveLength(4);
    // Un origen ajeno se rechaza antes de tocar nada.
    const ajeno = await api('POST', '/api/projects/foo/mcps/open', { mcp: 'web' }, { Origin: 'http://evil.example' });
    expect(ajeno.status).toBe(403);
    expect(abiertas).toHaveLength(4);
    // Sin `code` instalado, el panel lo explica.
    editorSinCode = true;
    try {
      const sin = await api('POST', '/api/projects/foo/mcps/open', { mcp: 'web' });
      expect(sin.status).toBe(501);
      expect((await json(sin)).error).toMatch(/code/);
    } finally {
      editorSinCode = false;
    }
  });

  it('lista y abre los MCPs de usuario del home inyectado; un conector no tiene archivo', async () => {
    const respuesta = await api('GET', '/api/user-mcps');
    const texto = await respuesta.text();
    expect(texto).not.toContain('SEKRET_ENV_VALUE');
    const lista = JSON.parse(texto) as { mcps: Json[] };
    expect(lista.mcps.map((m) => [m.name, m.copies[0].label, m.copies[0].transport, m.copies[0].path])).toEqual([
      ['Google Drive', 'claude.ai', 'connector', null],
      ['usuario', 'Claude', 'stdio', '~/.claude.json'],
    ]);
    expect(lista.mcps[1]!.copies[0].envNames).toEqual(['K']);
    abiertas.length = 0;
    expect((await api('POST', '/api/user-mcps/open', { mcp: 'usuario', copy: 0 })).status).toBe(200);
    expect(abiertas).toEqual([join(tmp, 'home', '.claude.json')]);
    const conector = await api('POST', '/api/user-mcps/open', { mcp: 'Google Drive' });
    expect(conector.status).toBe(400);
    expect(abiertas).toHaveLength(1);
  });

  it('lugares con ahead, behind, dirty, cambios y sesiones del panel', async () => {
    const creada = await api('POST', '/api/sessions', { project: 'foo', agent: 'codex', location: 'existing-worktree', feature: 'uno' });
    expect(creada.status).toBe(201);
    const nombre = (await json(creada)).session.name as string;
    const r = await api('GET', '/api/projects/foo/changes');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const c = await json(r);
    expect(c.base).toBe('main');
    // El checkout principal no tiene rama remota; los tests anteriores del backlog le dejaron cambios sin commit.
    const enPrincipal = git(proy, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).length;
    expect(enPrincipal).toBeGreaterThan(0);
    expect(c.main).toEqual({ branch: 'main', upstream: null, ahead: null, behind: null, dirty: true, changes: enPrincipal, sessions: [] });
    const por = Object.fromEntries(c.worktrees.map((w: Json) => [w.name, w]));
    expect(por.uno).toMatchObject({ branch: 'feat/uno', ahead: 2, behind: 1, dirty: true, sessions: [nombre], changes: 1 });
    expect(por.dos).toMatchObject({ branch: 'feat/dos', ahead: 0, behind: 1, dirty: false, sessions: [], changes: 0 });
    // El contrato de /api/projects no cambia.
    const proyectos = await json(await api('GET', '/api/projects'));
    expect(Object.keys(proyectos.projects[1].worktrees[0]).sort()).toEqual(['branch', 'name', 'path']);
    // El harness solo tiene su checkout principal.
    const h = await json(await api('GET', '/api/projects/harness/changes'));
    expect(h.worktrees).toEqual([]);
    // El harness del test no es un repositorio git: sus datos son null, pero el lugar existe.
    expect(h.main).toMatchObject({ branch: null, changes: null, sessions: [] });
  });

  it('resumen de cambios por proyecto visible', async () => {
    const r = await api('GET', '/api/changes');
    expect(r.status).toBe(200);
    const c = await json(r);
    // foo: los archivos sin commit de su checkout principal más el sin seguimiento de «uno».
    const enPrincipal = git(proy, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).length;
    expect(c.projects.foo).toBe(enPrincipal + 1);
    expect(Object.keys(c.projects)).toContain('harness');
    expect((await api('POST', '/api/changes', {})).status).toBe(405);
  });

  it('cambios de un lugar y diff de un archivo', async () => {
    const r = await api('GET', '/api/projects/foo/changes/wt/uno');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const c = await json(r);
    expect(c).toMatchObject({ base: 'main', upstream: null, truncated: false, total: 1 });
    expect(c.mergeBase).toBe(git(proy, 'rev-parse', 'HEAD~1').trim());
    expect(c.files).toEqual([{ path: 'nuevo.txt', oldPath: null, status: 'U', added: 1, deleted: 0, binary: false }]);
    expect((await json(await api('GET', '/api/projects/foo/changes/wt/dos'))).files).toEqual([]);

    const d = await api('GET', '/api/projects/foo/changes/wt/uno/diff?path=nuevo.txt');
    expect(d.status).toBe(200);
    expect(await json(d)).toMatchObject({ path: 'nuevo.txt', status: 'U', binary: false, tooLarge: false, patch: expect.stringContaining('+x') });
  });

  it('cambios del checkout principal: sin commit y sin seguimiento, y su diff', async () => {
    writeFileSync(join(proy, 'docs', 'user-guides', 'uso.md'), '# Cómo se usa\n\nTexto cambiado.\n');
    writeFileSync(join(proy, 'suelto.txt'), 'hola\n');
    try {
      const c = await json(await api('GET', '/api/projects/foo/changes/main'));
      expect(c).toMatchObject({ base: 'main', upstream: null });
      const propios = c.files.filter((f: Json) => f.path === 'suelto.txt' || f.path.startsWith('docs/user-guides/'));
      expect(propios.map((f: Json) => [f.path, f.status])).toEqual([['docs/user-guides/uso.md', 'M'], ['suelto.txt', 'U']]);
      const d = await json(await api('GET', `/api/projects/foo/changes/main/diff?path=${encodeURIComponent('docs/user-guides/uso.md')}`));
      expect(d.patch).toContain('+Texto cambiado.');
      const resumen = await json(await api('GET', '/api/projects/foo/changes'));
      expect(resumen.main).toMatchObject({ dirty: true, changes: c.total });
    } finally {
      git(proy, 'checkout', '--', 'docs/user-guides/uso.md');
      rmSync(join(proy, 'suelto.txt'));
    }
  });

  it('cambios: validación del lugar, del archivo y del método', async () => {
    expect((await api('GET', '/api/projects/foo/changes/wt/no-existe')).status).toBe(404);
    expect((await api('GET', '/api/projects/foo/changes/wt/no-existe/diff?path=a')).status).toBe(404);
    // Un nombre con ruta o con codificación rota nunca llega a git.
    expect((await api('GET', '/api/projects/foo/changes/wt/..%2Funo')).status).toBe(404);
    expect((await api('GET', '/api/projects/foo/changes/wt/%E0%A4%A')).status).toBe(400);
    expect((await api('GET', '/api/projects/harness/changes/wt/uno')).status).toBe(404);
    expect((await api('GET', '/api/projects/nada/changes/main')).status).toBe(404);
    // Archivos fuera de la lista, también con `../` o sin parámetro, en los dos lugares.
    for (const lugar of ['wt/uno', 'main']) {
      for (const ruta of ['../../.ssh/id_rsa', '%2E%2E/foo/nuevo.txt', '/etc/passwd', 'otro.txt', '']) {
        expect((await api('GET', `/api/projects/foo/changes/${lugar}/diff?path=${ruta}`)).status, `${lugar} ${ruta}`).toBe(404);
      }
      expect((await api('GET', `/api/projects/foo/changes/${lugar}/diff`)).status).toBe(404);
    }
    expect((await api('GET', '/api/projects/foo/changes/otra')).status).toBe(404);
    expect((await api('GET', '/api/projects/foo/changes/wt')).status).toBe(404);
    expect((await api('GET', '/api/projects/foo/worktrees')).status).toBe(404);
    const post = await api('POST', '/api/projects/foo/changes/wt/uno', {});
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET');
  });
});

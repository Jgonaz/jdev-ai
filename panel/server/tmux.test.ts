import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Project } from './projects.ts';
import {
  SessionInputError,
  createSession,
  isPanelSessionName,
  killServer,
  killSession,
  listSessions,
  paneCurrentPath,
  planSession,
  sessionExists,
  shellQuote,
  tmuxConfig,
  validateFeature,
} from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const HARNESS = resolve(import.meta.dirname, '..', '..');

function proyecto(id: string, extra: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    path: `/x/${id}`,
    harness: false,
    branch: 'main',
    worktrees: [],
    mono: 'XX',
    color: '#000000',
    visible: true,
    defaultMono: 'XX',
    defaultColor: '#000000',
    runCommand: null,
    runSource: null,
    runDetected: null,
    ...extra,
  };
}

const PROYECTOS: Project[] = [
  proyecto('jdev-ai', { harness: true }),
  proyecto('balanz.io', { worktrees: [{ name: 'typescript-7', path: '/x/wt', branch: 'feat/typescript-7' }] }),
  proyecto('fitnessia'),
];

const plan = (entrada: unknown) => planSession(entrada, PROYECTOS, HARNESS);
const rechaza = (entrada: unknown) => {
  try {
    plan(entrada);
  } catch (e) {
    expect(e).toBeInstanceOf(SessionInputError);
    return (e as Error).message;
  }
  throw new Error('debía rechazarse');
};

describe('validación y comando de bin/agent', () => {
  it('construye los argumentos como lista para cada ubicación y agente', () => {
    expect(plan({ project: 'balanz.io', agent: 'claude', location: 'main' }).agentArgs).toEqual(['balanz.io']);
    const wt = plan({ project: 'balanz.io', agent: 'claude', location: 'new-worktree', feature: 'typescript-7', prompt: 'hola mundo' });
    expect(wt.agentArgs).toEqual(['balanz.io', '--wt', 'typescript-7', '--', 'hola mundo']);
    expect(wt.argv).toEqual([join(HARNESS, 'bin', 'agent'), ...wt.agentArgs]);
    expect(wt.command).toBe('bin/agent balanz.io --wt typescript-7 -- "hola mundo"');
    expect(plan({ project: 'fitnessia', agent: 'codex' }).agentArgs).toEqual(['fitnessia', '--codex']);
    expect(plan({ project: 'fitnessia', agent: 'copilot' }).command).toBe('bin/agent fitnessia --copilot');
    expect(plan({ project: 'fitnessia', agent: 'opencode', location: 'main', prompt: '   ' }).agentArgs).toEqual([
      'fitnessia',
      '--opencode',
    ]);
    const existente = plan({ project: 'balanz.io', agent: 'claude', location: 'existing-worktree', feature: 'typescript-7' });
    expect(existente.worktree).toBe('typescript-7');
  });

  it('abre el harness con «.» y sin worktree', () => {
    expect(plan({ project: 'jdev-ai', agent: 'claude', location: 'main' }).agentArgs).toEqual(['.']);
    expect(rechaza({ project: 'jdev-ai', location: 'new-worktree', feature: 'x' })).toMatch(/harness no admite worktrees/);
    expect(rechaza({ project: 'jdev-ai', location: 'existing-worktree', feature: 'x' })).toMatch(/harness no admite worktrees/);
  });

  it('rechaza proyecto, agente, ubicación y worktree inexistentes o inválidos', () => {
    expect(rechaza({})).toMatch(/proyecto/);
    expect(rechaza({ project: 'no-existe' })).toMatch(/no existe/);
    expect(rechaza({ project: '../etc' })).toMatch(/no existe/);
    expect(rechaza({ project: 'fitnessia', agent: 'gpt' })).toMatch(/Agente no válido/);
    expect(rechaza({ project: 'fitnessia', location: 'otra' })).toMatch(/Ubicación no válida/);
    expect(rechaza({ project: 'balanz.io', location: 'existing-worktree', feature: 'otro' })).toMatch(/no existe en balanz.io/);
    expect(rechaza({ project: 'balanz.io', location: 'new-worktree' })).toMatch(/Indica el nombre de la feature/);
    expect(rechaza('texto')).toMatch(/objeto/);
    expect(rechaza({ project: 'fitnessia', prompt: 3 })).toMatch(/texto/);
    expect(rechaza({ project: 'fitnessia', prompt: 'a\0b' })).toMatch(/nulos/);
    expect(rechaza({ project: 'fitnessia', prompt: 'x'.repeat(20001) })).toMatch(/demasiado largo/);
  });

  it('retoma una sesión de Claude con «-- --resume <id>», en el checkout o en un worktree', () => {
    const id = '0a1b2c3d-1111-4222-8333-444455556666';
    const principal = plan({ project: 'balanz.io', agent: 'claude', location: 'main', resume: id });
    expect(principal.agentArgs).toEqual(['balanz.io', '--', '--resume', id]);
    expect(principal.resume).toBe(id);
    expect(principal.command).toBe(`bin/agent balanz.io -- --resume ${id}`);
    const wt = plan({ project: 'balanz.io', location: 'existing-worktree', feature: 'typescript-7', resume: id });
    expect(wt.agentArgs).toEqual(['balanz.io', '--wt', 'typescript-7', '--', '--resume', id]);
    expect(wt.command).toBe(`bin/agent balanz.io --wt typescript-7 -- --resume ${id}`);
    expect(plan({ project: 'jdev-ai', resume: id }).agentArgs).toEqual(['.', '--', '--resume', id]);
    // Sin resume, el plan no lo menciona.
    expect('resume' in plan({ project: 'balanz.io' })).toBe(false);
    expect('resume' in plan({ project: 'balanz.io', resume: null })).toBe(false);
  });

  it('rechaza un resume no válido, con otro agente o junto a un prompt', () => {
    const id = '0a1b2c3d-1111-4222-8333-444455556666';
    for (const malo of ['', 'abc', '../x', `${id}; ls`, id.toUpperCase(), `${id} `, '--resume', 5, {}]) {
      expect(rechaza({ project: 'balanz.io', resume: malo }), String(malo)).toMatch(/id de la sesión a retomar/);
    }
    expect(rechaza({ project: 'balanz.io', agent: 'codex', resume: id })).toMatch(/Solo se pueden retomar sesiones de Claude/);
    expect(rechaza({ project: 'balanz.io', resume: id, prompt: 'hola' })).toMatch(/No se puede indicar un prompt/);
    // Un prompt en blanco no cuenta como prompt.
    expect(plan({ project: 'balanz.io', resume: id, prompt: '  ' }).agentArgs).toEqual(['balanz.io', '--', '--resume', id]);
  });

  it('valida la feature con el mismo patrón que bin/worktree', () => {
    for (const buena of ['typescript-7', 'a', 'v1.2_x', 'a.b-c']) expect(validateFeature(buena)).toBe(buena);
    for (const mala of ['', '.x', '-x', 'a..b', 'A', 'a b', 'a/b', 'a;b', 'x.lock', 'x.', 'ñ', '$(x)', 'x'.repeat(101)]) {
      expect(() => validateFeature(mala), mala).toThrow(SessionInputError);
    }
    expect(() => validateFeature(undefined)).toThrow(SessionInputError);
  });

  it('cita el comando legible sin cambiar lo que se ejecuta', () => {
    expect(shellQuote('abc-1.x')).toBe('abc-1.x');
    expect(shellQuote('con espacios')).toBe('"con espacios"');
    expect(shellQuote('cuesta $5')).toBe(`'cuesta $5'`);
    expect(shellQuote(`it's "x"`)).toBe(`'it'\\''s "x"'`);
    expect(plan({ project: 'fitnessia', prompt: 'haz `ls`' }).agentArgs).toEqual(['fitnessia', '--', 'haz `ls`']);
  });

  describe('terminal sin agente (shell)', () => {
    let raiz: string;
    let proy: Project;
    const planShell = (entrada: object, env: NodeJS.ProcessEnv = { SHELL: '/bin/sh' }) =>
      planSession({ agent: 'shell', ...entrada }, [proy, proyecto('jdev-ai', { harness: true, path: raiz })], HARNESS, env);
    const rechazaShell = (entrada: object, env?: NodeJS.ProcessEnv) => {
      try {
        planShell(entrada, env);
      } catch (e) {
        expect(e).toBeInstanceOf(SessionInputError);
        return (e as Error).message;
      }
      throw new Error('debía rechazarse');
    };

    beforeAll(() => {
      raiz = mkdtempSync(join(tmpdir(), 'jdev-shell-'));
      mkdirSync(join(raiz, 'wt'), { recursive: true });
      proy = proyecto('app', { path: raiz, worktrees: [{ name: 'f1', path: join(raiz, 'wt'), branch: 'feat/f1' }] });
    });
    afterAll(() => rmSync(raiz, { recursive: true, force: true }));

    it('lanza la shell de login interactiva en la carpeta del proyecto, sin bin/agent', () => {
      const p = planShell({ project: 'app' });
      expect(p).toMatchObject({ agent: 'shell', location: 'main', worktree: '', agentArgs: [], argv: ['/bin/sh', '-l'], cwd: raiz });
      // Interactiva: sin «-c» ni argumentos que la hagan ejecutar nada.
      expect(p.argv).not.toContain('-c');
      expect(p.command).toBe(`cd ${shellQuote(raiz)} && /bin/sh -l`);
      expect(planShell({ project: 'app', prompt: '   ' }).agentArgs).toEqual([]);
    });

    it('usa la carpeta del worktree existente y la del propio harness', () => {
      const wt = planShell({ project: 'app', location: 'existing-worktree', feature: 'f1' });
      expect(wt).toMatchObject({ worktree: 'f1', location: 'existing-worktree', cwd: join(raiz, 'wt') });
      expect(planShell({ project: 'jdev-ai' }).cwd).toBe(raiz);
    });

    it('cae a bash si SHELL falta, no es absoluta o no es ejecutable', () => {
      for (const env of [{}, { SHELL: '' }, { SHELL: 'zsh' }, { SHELL: '/no/existe/zsh' }, { SHELL: raiz }]) {
        expect(planShell({ project: 'app' }, env).argv, JSON.stringify(env)).toEqual(['bash', '-l']);
      }
    });

    it('rechaza worktree nuevo, prompt, retomar y carpetas inexistentes', () => {
      expect(rechazaShell({ project: 'app', location: 'new-worktree', feature: 'x' })).toMatch(/no crea worktrees/);
      expect(rechazaShell({ project: 'app', prompt: 'hola' })).toMatch(/no admite prompt/);
      expect(rechazaShell({ project: 'app', resume: '0a1b2c3d-1111-4222-8333-444455556666' })).toMatch(/no retoma/);
      expect(rechazaShell({ project: 'app', location: 'existing-worktree', feature: 'otro' })).toMatch(/no existe en app/);
      expect(rechazaShell({ project: 'jdev-ai', location: 'existing-worktree', feature: 'x' })).toMatch(/harness no admite worktrees/);
      // Un proyecto cuya ruta ya no existe (PROYECTOS usa rutas ficticias).
      expect(() => planSession({ project: 'fitnessia', agent: 'shell' }, PROYECTOS, HARNESS)).toThrow(/carpeta del proyecto/);
      const sinWt = proyecto('app', { path: raiz, worktrees: [{ name: 'f1', path: join(raiz, 'borrado'), branch: null }] });
      expect(() => planSession({ project: 'app', agent: 'shell', location: 'existing-worktree', feature: 'f1' }, [sinWt], HARNESS)).toThrow(/carpeta del worktree/);
    });
  });

  it('reconoce solo nombres de sesión del panel', () => {
    expect(isPanelSessionName('jdev-balanz-io-1')).toBe(true);
    for (const n of ['otra', 'jdev-', 'jdev-x', 'jdev-x-a', 'jdev-x-1; kill-server', '=jdev-x-1', '']) {
      expect(isPanelSessionName(n), n).toBe(false);
    }
  });
});

describe('tmux con un socket aislado', () => {
  let cfg: TmuxConfig;
  let tmp: string;
  const sock = `jdev-test-${process.pid}-${Date.now().toString(36)}`;
  const tmux = (...args: string[]) =>
    execFileSync('tmux', ['-L', sock, ...args], { encoding: 'utf8', env: { ...process.env, TMUX: '' } });

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-tmux-'));
    cfg = tmuxConfig(HARNESS, {}, { socket: sock, launcher: () => ['sh', '-c', 'sleep 60'] });
  });

  afterAll(async () => {
    // Solo el servidor de prueba: nunca el tmux del usuario. tmux deja el
    // archivo del socket tras kill-server, así que se borra también.
    let socketPath = '';
    try {
      socketPath = tmux('start-server', ';', 'display-message', '-p', '#{socket_path}').trim();
    } catch {
      // Sin servidor no hay socket que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  it('con el servidor sin arrancar la lista está vacía y no es un error', async () => {
    expect(await listSessions(cfg)).toEqual([]);
    expect(await sessionExists(cfg, 'jdev-x-1')).toBe(false);
    expect(await killSession(cfg, 'jdev-x-1')).toBe(false);
  });

  it('rechaza un nombre de socket con caracteres raros', () => {
    expect(() => tmuxConfig(HARNESS, {}, { socket: '../x' })).toThrow();
    expect(() => tmuxConfig(HARNESS, {}, { socket: '-L' })).toThrow();
    expect(tmuxConfig(HARNESS, { JDEV_PANEL_TMUX_SOCKET: 'abc' }).socket).toBe('abc');
    expect(tmuxConfig(HARNESS, {}).socket).toBe('jdev');
  });

  it('crea sesiones con metadatos, las lista y las numera por proyecto', async () => {
    const a = await createSession(cfg, plan({ project: 'balanz.io', agent: 'codex', location: 'new-worktree', feature: 'ts-7' }), {
      historyLimit: 1234,
    });
    expect(a.name).toBe('jdev-balanz-io-1');
    const b = await createSession(cfg, plan({ project: 'balanz.io' }));
    expect(b.name).toBe('jdev-balanz-io-2');
    const c = await createSession(cfg, plan({ project: 'jdev-ai' }));
    expect(c.name).toBe('jdev-jdev-ai-1');

    const lista = await listSessions(cfg);
    expect(lista.map((s) => s.name).sort()).toEqual(['jdev-balanz-io-1', 'jdev-balanz-io-2', 'jdev-jdev-ai-1']);
    const primera = lista.find((s) => s.name === a.name)!;
    expect(primera).toMatchObject({ project: 'balanz.io', agent: 'codex', worktree: 'ts-7', alive: true, attached: 0 });
    expect(Math.abs(primera.created - Date.now())).toBeLessThan(30000);
    expect(Math.abs(primera.activity - Date.now())).toBeLessThan(30000);
    expect(lista.find((s) => s.name === b.name)).toMatchObject({ agent: 'claude', worktree: '' });
    expect(tmux('show-options', '-t', `=${a.name}:`, '@jdev_created').trim()).toMatch(/@jdev_created "?\d{4}-\d\d-\d\dT/);

    // El historial del ajuste de scroll se aplica a la sesión nueva.
    expect(tmux('display-message', '-p', '-t', `=${a.name}:`, '#{history_limit}').trim()).toBe('1234');
    // El hueco libre más bajo se reutiliza tras terminar una sesión.
    expect(await killSession(cfg, b.name)).toBe(true);
    expect((await createSession(cfg, plan({ project: 'balanz.io' }))).name).toBe('jdev-balanz-io-2');
  });

  it('entrega intactos los argumentos, también un prompt que termina en «;»', async () => {
    const salida = join(tmp, 'arg.txt');
    const cfgArg = tmuxConfig(HARNESS, {}, {
      socket: sock,
      launcher: (args) => ['sh', '-c', `printf '%s' "$1" > '${salida}'; sleep 60`, 'sh', args.at(-1)!],
    });
    const prompt = 'haz esto; y esto;';
    const s = await createSession(cfgArg, plan({ project: 'fitnessia', prompt }));
    await vi.waitFor(() => expect(existsSync(salida)).toBe(true));
    await vi.waitFor(() => expect(readFileSync(salida, 'utf8')).toBe(prompt));
    // No se creó ninguna sesión extra por interpretar «;» como separador.
    expect((await listSessions(cfg)).filter((x) => x.project === 'fitnessia').map((x) => x.name)).toEqual([s.name]);
    await killSession(cfg, s.name);
  });

  it('arranca las sesiones con JDEV_SURFACE=panel, también al retomar, aunque el panel tenga otra', async () => {
    const salida = join(tmp, 'surface.txt');
    const cfgEnv = tmuxConfig(HARNESS, {}, {
      socket: sock,
      launcher: () => ['sh', '-c', `printf '%s' "$JDEV_SURFACE" > '${salida}'; sleep 60`],
    });
    const previo = process.env.JDEV_SURFACE;
    process.env.JDEV_SURFACE = 'terminal';
    try {
      const nueva = await createSession(cfgEnv, plan({ project: 'fitnessia' }));
      await vi.waitFor(() => expect(readFileSync(salida, 'utf8')).toBe('panel'));
      expect(tmux('show-environment', '-t', `=${nueva.name}`, 'JDEV_SURFACE').trim()).toBe('JDEV_SURFACE=panel');
      // Renderizador clásico de Claude Code: su salida va al historial de tmux.
      expect(tmux('show-environment', '-t', `=${nueva.name}`, 'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN').trim()).toBe(
        'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1',
      );
      await killSession(cfg, nueva.name);

      rmSync(salida);
      const id = '0a1b2c3d-1111-4222-8333-444455556666';
      const retomada = await createSession(cfgEnv, plan({ project: 'fitnessia', resume: id }));
      await vi.waitFor(() => expect(readFileSync(salida, 'utf8')).toBe('panel'));
      await killSession(cfg, retomada.name);
    } finally {
      if (previo === undefined) delete process.env.JDEV_SURFACE;
      else process.env.JDEV_SURFACE = previo;
    }
  });

  it('abre una terminal sin agente: shell interactiva en la carpeta del proyecto con sus metadatos', async () => {
    const carpeta = realpathSync(mkdtempSync(join(tmp, 'term-')));
    const proy = proyecto('fitnessia', { path: carpeta });
    const p = planSession({ project: 'fitnessia', agent: 'shell' }, [proy], HARNESS, { SHELL: '/bin/sh' });
    // El lanzador de pruebas sustituye a bin/agent, no a la shell: aquí no se usa.
    const s = await createSession(cfg, p);
    const fila = (await listSessions(cfg)).find((x) => x.name === s.name)!;
    expect(fila).toMatchObject({ project: 'fitnessia', agent: 'shell', worktree: '', alive: true });
    await vi.waitFor(async () => expect(await paneCurrentPath(cfg, s.name)).toBe(carpeta));
    expect(tmux('show-environment', '-t', `=${s.name}`, 'JDEV_SURFACE').trim()).toBe('JDEV_SURFACE=panel');
    expect(tmux('show-environment', '-t', `=${s.name}`, 'SHELL').trim()).toBe('SHELL=/bin/sh');
    // Interactiva: acepta órdenes y su $- incluye «i».
    tmux('send-keys', '-t', `=${s.name}:`, 'echo "flags=$-" "dir=$PWD"', 'Enter');
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-t', `=${s.name}:`)).toMatch(new RegExp(`flags=\\w*i\\w* dir=${carpeta}`)));
    await killSession(cfg, s.name);
  });

  it('obtiene el directorio actual del panel de una sesión y su cambio', async () => {
    const destino = realpathSync(tmp);
    const otro = join(destino, 'otro dir ');
    mkdirSync(otro, { recursive: true });
    const cfgDir = tmuxConfig(HARNESS, {}, {
      socket: sock,
      launcher: () => ['sh', '-c', `cd '${otro}' && sleep 60`],
    });
    const s = await createSession(cfgDir, plan({ project: 'fitnessia' }));
    // La sesión se crea con -c <harness>; el agente cambia de carpeta y tmux lo refleja.
    await vi.waitFor(async () => expect(await paneCurrentPath(cfg, s.name)).toBe(otro));
    await killSession(cfg, s.name);
    const enHarness = await createSession(cfg, plan({ project: 'fitnessia' }));
    await vi.waitFor(async () => expect(await paneCurrentPath(cfg, enHarness.name)).toBe(realpathSync(HARNESS)));
    await killSession(cfg, enHarness.name);
  });

  it('el directorio del panel es null si la sesión no existe o el nombre no es del panel', async () => {
    expect(await paneCurrentPath(cfg, 'jdev-nada-9')).toBeNull();
    expect(await paneCurrentPath(cfg, 'otra')).toBeNull();
    expect(await paneCurrentPath(cfg, 'jdev-x-1; kill-server')).toBeNull();
    expect(await paneCurrentPath(cfg, '=jdev-x-1')).toBeNull();
  });

  it('deja la sesión terminada (no viva) cuando el proceso acaba', async () => {
    const cfgFin = tmuxConfig(HARNESS, {}, { socket: sock, launcher: () => ['sh', '-c', 'echo adiós; exit 3'] });
    const s = await createSession(cfgFin, plan({ project: 'fitnessia' }));
    await vi.waitFor(async () => {
      const x = (await listSessions(cfg)).find((e) => e.name === s.name);
      expect(x?.alive).toBe(false);
    });
    expect(await killSession(cfg, s.name)).toBe(true);
    expect((await listSessions(cfg)).some((e) => e.name === s.name)).toBe(false);
  });

  it('solo termina sesiones jdev-* y devuelve false si no existen', async () => {
    tmux('new-session', '-d', '-s', 'otra', 'sleep 60');
    expect(await killSession(cfg, 'otra')).toBe(false);
    expect(await killSession(cfg, 'jdev-nada-9')).toBe(false);
    expect(tmux('has-session', '-t', '=otra')).toBe('');
    // Las sesiones ajenas al panel no se listan.
    expect((await listSessions(cfg)).some((s) => s.name === 'otra')).toBe(false);
    tmux('kill-session', '-t', '=otra');
  });

  it('killServer es idempotente cuando no queda servidor', async () => {
    await killServer(cfg);
    expect(await listSessions(cfg)).toEqual([]);
    await killServer(cfg);
  });
});

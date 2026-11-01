import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateStore, deriveState, parseStateFile, stateByTmuxSession } from './states.ts';
import type { StateFile } from './states.ts';

const base = (extra: Record<string, unknown> = {}) => ({
  session_id: 'abc-1',
  state: 'working',
  event: 'UserPromptSubmit',
  updated_at: '2026-11-01T10:00:00Z',
  project: 'balanz.io',
  agent: 'claude',
  worktree: 'typescript-7',
  transcript_path: '/home/u/.claude/projects/x/abc-1.jsonl',
  cwd: '/home/u/p',
  tmux_session: 'jdev-balanz-io-1',
  ...extra,
});

const archivo = (extra: Partial<StateFile> = {}): StateFile => ({
  sessionId: 'abc-1',
  state: 'working',
  event: 'UserPromptSubmit',
  updatedAt: Date.parse('2026-11-01T10:00:00Z'),
  project: 'balanz.io',
  agent: 'claude',
  worktree: '',
  transcriptPath: '',
  cwd: '',
  tmuxSession: 'jdev-balanz-io-1',
  message: '',
  ...extra,
});

describe('parseStateFile', () => {
  it('convierte el JSON de bin/session-state y decodifica los escapes', () => {
    const f = parseStateFile(JSON.stringify(base({ project: 'a"b\\c', cwd: '/ruta/ñandú' })));
    expect(f).toMatchObject({
      sessionId: 'abc-1',
      state: 'working',
      project: 'a"b\\c',
      cwd: '/ruta/ñandú',
      tmuxSession: 'jdev-balanz-io-1',
      updatedAt: Date.parse('2026-11-01T10:00:00Z'),
    });
    // Escapes tal como los escribe el script: \" y \\ y ñ.
    const crudo = '{"session_id":"s1","state":"idle","project":"p\\"q","cwd":"/a\\\\b","worktree":"\\u00f1","tmux_session":""}';
    expect(parseStateFile(crudo)).toMatchObject({ project: 'p"q', cwd: '/a\\b', worktree: 'ñ' });
  });

  it('lee el mensaje del aviso solo si la sesión espera', () => {
    expect(parseStateFile(JSON.stringify(base({ state: 'waiting', message: 'Claude needs your permission to use "Bash"' })))?.message).toBe(
      'Claude needs your permission to use "Bash"',
    );
    expect(parseStateFile(JSON.stringify(base({ state: 'working', message: 'resto' })))?.message).toBe('');
    expect(parseStateFile(JSON.stringify(base({ state: 'waiting' })))?.message).toBe('');
    expect(parseStateFile(JSON.stringify(base({ state: 'waiting', message: 3 })))?.message).toBe('');
  });

  it('rechaza JSON roto, sin sesión o con un estado desconocido', () => {
    expect(parseStateFile('{"session_id":')).toBeNull();
    expect(parseStateFile('[]')).toBeNull();
    expect(parseStateFile('')).toBeNull();
    expect(parseStateFile(JSON.stringify(base({ session_id: '' })))).toBeNull();
    expect(parseStateFile(JSON.stringify(base({ state: 'dormido' })))).toBeNull();
    expect(parseStateFile(JSON.stringify(base({ updated_at: 'ayer' })))?.updatedAt).toBe(0);
  });
});

describe('StateStore', () => {
  let dir: string;
  let store: StateStore | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jdev-states-'));
  });
  afterEach(() => {
    store?.stop();
    store = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('lee los .json válidos e ignora ocultos, temporales, no JSON y JSON inválido', async () => {
    writeFileSync(join(dir, 'abc-1.json'), JSON.stringify(base()));
    writeFileSync(join(dir, 'abc-2.json'), JSON.stringify(base({ session_id: 'abc-2', state: 'waiting' })));
    writeFileSync(join(dir, '.abc-3.XXXX'), JSON.stringify(base({ session_id: 'abc-3' })));
    writeFileSync(join(dir, '.abc-4.json'), JSON.stringify(base({ session_id: 'abc-4' })));
    writeFileSync(join(dir, 'abc-5.json.tmp'), JSON.stringify(base({ session_id: 'abc-5' })));
    writeFileSync(join(dir, 'roto.json'), '{"session_id":"x", ');
    writeFileSync(join(dir, 'estado-malo.json'), JSON.stringify(base({ session_id: 'x', state: 'zzz' })));
    writeFileSync(join(dir, 'notas.txt'), 'hola');
    mkdirSync(join(dir, 'carpeta.json'));

    store = new StateStore(dir);
    await store.refresh();
    expect(store.snapshot().map((f) => [f.sessionId, f.state])).toEqual([
      ['abc-1', 'working'],
      ['abc-2', 'waiting'],
    ]);
  });

  it('con el directorio inexistente devuelve una lista vacía', async () => {
    store = new StateStore(join(dir, 'no-existe'));
    await store.refresh();
    expect(store.snapshot()).toEqual([]);
  });

  it('avisa de los cambios con fs.watch aunque el directorio no existiera al empezar', async () => {
    const destino = join(dir, 'sub');
    const onChange = vi.fn();
    store = new StateStore(destino, onChange, 100);
    await store.start();
    expect(onChange).not.toHaveBeenCalled();

    mkdirSync(destino);
    writeFileSync(join(destino, 'abc-1.json'), JSON.stringify(base()));
    await vi.waitFor(() => expect(store!.snapshot()).toHaveLength(1), { timeout: 3000 });
    expect(onChange).toHaveBeenCalledTimes(1);

    writeFileSync(join(destino, 'abc-1.json'), JSON.stringify(base({ state: 'waiting', updated_at: '2026-11-01T10:05:00Z' })));
    await vi.waitFor(() => expect(store!.snapshot()[0]!.state).toBe('waiting'), { timeout: 3000 });
    expect(onChange).toHaveBeenCalledTimes(2);

    rmSync(join(destino, 'abc-1.json'));
    await vi.waitFor(() => expect(store!.snapshot()).toHaveLength(0), { timeout: 3000 });
  });

  it('la relectura periódica recoge cambios aunque no llegue ningún evento', async () => {
    store = new StateStore(dir, () => {}, 100);
    await store.start();
    store.stop(); // sin watcher ni temporizador propio de la prueba
    store = new StateStore(dir, () => {}, 100);
    // Simula un fs.watch que no entrega eventos: se cierra el watcher y solo queda el sondeo.
    await store.start();
    (store as unknown as { watcher: { close(): void } | null }).watcher?.close();
    writeFileSync(join(dir, 'abc-9.json'), JSON.stringify(base({ session_id: 'abc-9' })));
    await vi.waitFor(() => expect(store!.snapshot().map((f) => f.sessionId)).toContain('abc-9'), { timeout: 3000 });
  });
});

describe('combinación con tmux', () => {
  const creada = Date.parse('2026-11-01T09:59:00Z');
  const sesiones = [
    { name: 'jdev-balanz-io-1', created: creada },
    { name: 'jdev-fit-1', created: creada },
  ];

  it('elige el estado más reciente por sesión de tmux', () => {
    const m = stateByTmuxSession(
      [
        archivo({ sessionId: 'a', state: 'idle', updatedAt: creada + 1000 }),
        archivo({ sessionId: 'b', state: 'waiting', updatedAt: creada + 5000 }),
        archivo({ sessionId: 'c', state: 'working', updatedAt: creada + 2000 }),
        archivo({ sessionId: 'd', tmuxSession: 'jdev-fit-1', state: 'idle', updatedAt: creada + 3000 }),
      ],
      sesiones,
    );
    expect(m.get('jdev-balanz-io-1')?.sessionId).toBe('b');
    expect(m.get('jdev-fit-1')?.sessionId).toBe('d');
  });

  it('ignora archivos sin sesión de tmux, de sesiones inexistentes o anteriores a la creación', () => {
    const m = stateByTmuxSession(
      [
        archivo({ sessionId: 'sin', tmuxSession: '' }),
        archivo({ sessionId: 'otra', tmuxSession: 'jdev-otra-3' }),
        archivo({ sessionId: 'vieja', updatedAt: creada - 60000 }),
      ],
      sesiones,
    );
    expect(m.size).toBe(0);
  });

  it('deduce el estado visible', () => {
    expect(deriveState(archivo({ state: 'waiting' }), true)).toBe('waiting');
    expect(deriveState(archivo({ state: 'working' }), true)).toBe('working');
    expect(deriveState(archivo({ state: 'idle' }), true)).toBe('idle');
    expect(deriveState(archivo({ state: 'ended' }), true)).toBe('ended');
    // El proceso terminó aunque el último evento dijera otra cosa.
    expect(deriveState(archivo({ state: 'working' }), false)).toBe('ended');
    // Sin estado (Codex, Copilot, OpenCode, Claude antes del primer evento): viva o terminada.
    expect(deriveState(undefined, true)).toBe('alive');
    expect(deriveState(undefined, false)).toBe('ended');
  });
});

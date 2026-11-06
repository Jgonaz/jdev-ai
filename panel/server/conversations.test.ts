import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONVERSATION_NOTE_MAX,
  checkNote,
  isConversationId,
  isConversationKey,
  legacyTmuxConversationKey,
  parseConversation,
  resolveDone,
  tmuxConversationKey,
  writeConversation,
} from './conversations.ts';
import { conversationStateDir } from './paths.ts';

const execFileAsync = promisify(execFile);
const ID = '1111aaaa-2222-3333-4444-5555bbbb5555';

describe('claves de conversación', () => {
  it('acepta el id de Claude y la clave de tmux, y nada más', () => {
    expect(isConversationKey(ID)).toBe(true);
    expect(isConversationKey('tmux-jdev-foo-1-1730000000')).toBe(true);
    expect(isConversationKey('tmux-jdev-mi_proy-12-1730000000')).toBe(true);
    for (const mala of [undefined, 3, '', 's-1', ID.toUpperCase(), `${ID}x`, '../x', 'tmux-foo-1-1', 'tmux-jdev-foo-1', 'tmux-jdev-foo-1-1/x', `${ID}.json`]) {
      expect(isConversationKey(mala), String(mala)).toBe(false);
    }
    expect(isConversationId(ID)).toBe(true);
    expect(isConversationId('tmux-jdev-foo-1-1730000000')).toBe(false);
  });

  it('la clave de tmux lleva la creación en milisegundos; la de segundos solo se lee', () => {
    expect(tmuxConversationKey('jdev-foo-2', 1730000000999)).toBe('tmux-jdev-foo-2-1730000000999');
    expect(tmuxConversationKey('jdev-foo-2', 1730000000999)).not.toBe(tmuxConversationKey('jdev-foo-2', 1730000000123));
    expect(isConversationKey(tmuxConversationKey('jdev-foo-2', 1730000000999))).toBe(true);
    expect(legacyTmuxConversationKey('jdev-foo-2', 1730000000999)).toBe('tmux-jdev-foo-2-1730000000');
    expect(isConversationKey(legacyTmuxConversationKey('jdev-foo-2', 1730000000999))).toBe(true);
  });
});

describe('checkNote', () => {
  it('admite vacío, recorta y cuenta caracteres, no unidades UTF-16', () => {
    expect(checkNote(undefined)).toEqual({ ok: true, note: null });
    expect(checkNote(null)).toEqual({ ok: true, note: null });
    expect(checkNote('   ')).toEqual({ ok: true, note: null });
    expect(checkNote('  Integrada ñ 😀 ')).toEqual({ ok: true, note: 'Integrada ñ 😀' });
    expect(checkNote('😀'.repeat(CONVERSATION_NOTE_MAX)).ok).toBe(true);
    expect(checkNote('😀'.repeat(CONVERSATION_NOTE_MAX + 1)).ok).toBe(false);
  });

  it('rechaza lo que no es texto y los caracteres de control', () => {
    for (const mala of [3, {}, [], 'a\nb', 'a\tb', 'a\0b', 'a b']) {
      expect(checkNote(mala).ok, JSON.stringify(mala)).toBe(false);
    }
  });
});

describe('parseConversation', () => {
  it('lee los campos y normaliza la fecha', () => {
    expect(parseConversation('{"state":"done","at":"2026-11-05T15:20:00Z","by":"user","note":"Hecho"}\n')).toEqual({
      state: 'done',
      at: '2026-11-05T15:20:00.000Z',
      by: 'user',
      note: 'Hecho',
    });
    expect(parseConversation('{"state":"open","at":"2026-11-05T15:20:00Z","by":"agent"}')).toEqual({
      state: 'open',
      at: '2026-11-05T15:20:00.000Z',
      by: 'agent',
      note: null,
    });
  });

  it('descarta lo que no es válido, pero no por una nota inválida', () => {
    for (const mal of ['', 'basura', '[]', '{}', '{"state":"hecha","at":"2026-11-05T15:20:00Z","by":"user"}', '{"state":"done","at":"ayer","by":"user"}', '{"state":"done","at":"2026-11-05T15:20:00Z","by":"otro"}', '{"state":"done","by":"user"}']) {
      expect(parseConversation(mal), mal).toBeNull();
    }
    expect(parseConversation('{"state":"done","at":"2026-11-05T15:20:00Z","by":"user","note":"a\\nb"}')?.note).toBeNull();
    expect(parseConversation(`{"state":"done","at":"2026-11-05T15:20:00Z","by":"user","note":"${'a'.repeat(501)}"}`)?.note).toBeNull();
  });
});

describe('resolveDone', () => {
  const abierta = { state: 'open', at: '2026-11-05T15:20:00.000Z', by: 'user', note: null } as const;
  const hecha = { state: 'done', at: '2026-11-05T15:20:00.000Z', by: 'agent', note: 'Integrada' } as const;

  it('manda el archivo sobre la marca antigua', () => {
    expect(resolveDone(hecha, false)).toEqual({ at: '2026-11-05T15:20:00.000Z', by: 'agent', note: 'Integrada' });
    expect(resolveDone(hecha, true)).toEqual({ at: '2026-11-05T15:20:00.000Z', by: 'agent', note: 'Integrada' });
    expect(resolveDone(abierta, true)).toBeNull();
    expect(resolveDone(abierta, false)).toBeNull();
  });

  it('sin archivo, la marca antigua cuenta como hecha por el agente y sin fecha', () => {
    expect(resolveDone(undefined, true)).toEqual({ at: null, by: 'agent', note: null });
    expect(resolveDone(undefined, false)).toBeNull();
  });
});

describe('writeConversation', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'jdev-conv-')), 'conversations');
  });
  afterEach(() => rmSync(resolve(dir, '..'), { recursive: true, force: true }));

  it('crea el directorio, escribe de forma atómica y privada y no deja temporales', async () => {
    await writeConversation(dir, ID, { state: 'done', at: '2026-11-05T15:20:00.000Z', by: 'user', note: 'Con "comillas" y ñ' });
    expect(readdirSync(dir)).toEqual([`${ID}.json`]);
    expect(JSON.parse(readFileSync(join(dir, `${ID}.json`), 'utf8'))).toEqual({
      state: 'done',
      at: '2026-11-05T15:20:00.000Z',
      by: 'user',
      note: 'Con "comillas" y ñ',
    });
    expect(statSync(join(dir, `${ID}.json`)).mode & 0o777).toBe(0o600);
    // Sin nota, el campo no se escribe.
    await writeConversation(dir, ID, { state: 'open', at: '2026-11-05T15:21:00.000Z', by: 'user', note: null });
    expect(readFileSync(join(dir, `${ID}.json`), 'utf8')).toBe('{"state":"open","at":"2026-11-05T15:21:00.000Z","by":"user"}\n');
    expect(readdirSync(dir)).toEqual([`${ID}.json`]);
  });

  it('rechaza una clave que no es de conversación', async () => {
    await expect(writeConversation(dir, '../x', { state: 'done', at: '2026-11-05T15:20:00.000Z', by: 'user', note: null })).rejects.toThrow();
    expect(() => readdirSync(dir)).toThrow();
  });
});

describe('conversationStateDir', () => {
  it('sigue XDG_STATE_HOME si es absoluta', () => {
    expect(conversationStateDir({ XDG_STATE_HOME: '/x/estado' })).toBe('/x/estado/jdev-ai/conversations');
    expect(conversationStateDir({ XDG_STATE_HOME: 'relativa' })).toMatch(/\.local\/state\/jdev-ai\/conversations$/);
  });
});

// bin/session-done y el servidor deben entenderse: lo que escribe el script lo lee el servidor.
describe('bin/session-done', () => {
  let state: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'jdev-sd-'));
  });
  afterEach(() => rmSync(state, { recursive: true, force: true }));

  const ejecutar = (...args: string[]) =>
    execFileAsync('sh', [join(resolve(import.meta.dirname, '..', '..'), 'bin', 'session-done'), ...args], {
      env: { PATH: process.env.PATH, HOME: state, XDG_STATE_HOME: state, CLAUDE_CODE_SESSION_ID: ID, CLAUDE_CONFIG_DIR: join(state, 'claude') },
    });

  it('escribe un archivo que parseConversation entiende', async () => {
    mkdirSync(state, { recursive: true });
    await ejecutar('--note', 'Integrada en "main"');
    const archivo = join(state, 'jdev-ai', 'conversations', `${ID}.json`);
    expect(parseConversation(readFileSync(archivo, 'utf8'))).toMatchObject({ state: 'done', by: 'agent', note: 'Integrada en "main"' });
    await ejecutar('--open');
    expect(parseConversation(readFileSync(archivo, 'utf8'))).toMatchObject({ state: 'open', by: 'agent', note: null });
  });

  it('el hook de session-title escribe un archivo que parseConversation entiende', async () => {
    const dirConv = join(state, 'jdev-ai', 'conversations');
    mkdirSync(dirConv, { recursive: true });
    writeFileSync(join(dirConv, `${ID}.json`), '{"state":"done","at":"2026-11-05T15:20:00.000Z","by":"user","note":"x"}\n');
    const hook = execFile('sh', [join(resolve(import.meta.dirname, '..', '..'), 'bin', 'session-title'), '--hook'], {
      env: { PATH: process.env.PATH, HOME: state, XDG_STATE_HOME: state },
    });
    const salida = new Promise<string>((ok) => {
      let texto = '';
      hook.stdout?.on('data', (d) => (texto += String(d)));
      hook.on('close', () => ok(texto));
    });
    hook.stdin?.end(JSON.stringify({ session_id: ID, transcript_path: join(state, 'no-existe.jsonl') }));
    expect(await salida).toBe('');
    expect(parseConversation(readFileSync(join(dirConv, `${ID}.json`), 'utf8'))).toMatchObject({ state: 'open', by: 'user' });
  });
});

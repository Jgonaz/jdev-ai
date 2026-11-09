import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { CHAT_NO_TRANSCRIPT, CHAT_ONLY_CLAUDE } from './sessions.ts';
import { killServer, pasteMessage, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';
import { conversacionMuestra, persona } from './follow-fixtures.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Conversacion = { error?: string; sessionId?: string; from?: number; size?: number; more?: boolean; reset?: boolean; events?: { type: string; text?: string }[] };
type Sesion = { name: string; agent: string; chat: { available: boolean; reason: string | null } };

describe('vista chat: GET /conversation y POST /input', () => {
  const token = 'f'.repeat(64);
  const sock = `jdev-test-chat-${process.pid}-${Date.now().toString(36)}`;
  const sid = 'abc-chat-1';
  let tmp: string;
  let srv: RunningServer;
  let cfg: TmuxConfig;
  let base: string;
  let estado = '';
  let transcript = '';
  let recibido = '';
  let claude = '';
  let sinEstado = '';
  let codex = '';
  const auth = { Authorization: `Bearer ${token}` };
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });
  const api = (metodo: string, ruta: string, cuerpo?: unknown, extra: Record<string, string> = {}) =>
    fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { ...auth, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });
  const conversar = async (nombre: string, from?: number) => {
    const r = await api('GET', `/api/sessions/${encodeURIComponent(nombre)}/conversation${from === undefined ? '' : `?from=${from}`}`);
    return { status: r.status, cache: r.headers.get('cache-control'), body: (await r.json()) as Conversacion };
  };
  const enviar = async (nombre: string, cuerpo: unknown, extra: Record<string, string> = {}) => {
    const r = await api('POST', `/api/sessions/${encodeURIComponent(nombre)}/input`, cuerpo, extra);
    return { status: r.status, body: (await r.json()) as { sent?: boolean; error?: string } };
  };
  const crear = async (agent: string) => {
    const r = await api('POST', '/api/sessions', { project: 'foo', agent, location: 'main' });
    return ((await r.json()) as { session: { name: string } }).session.name;
  };
  const sesiones = async () => ((await (await api('GET', '/api/sessions')).json()) as { sessions: Sesion[] }).sessions;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-chat-api-'));
    estado = join(tmp, 'jdev-ai', 'sessions');
    const harness = join(tmp, 'harness');
    const proy = join(harness, 'projects', 'foo');
    mkdirSync(proy, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', proy]);
    mkdirSync(join(tmp, 'dist'));
    recibido = join(tmp, 'recibido.txt');
    writeFileSync(recibido, '');
    transcript = join(tmp, 'claude', 'projects', '-proj', `${sid}.jsonl`);
    mkdirSync(join(tmp, 'claude', 'projects', '-proj'), { recursive: true });
    writeFileSync(transcript, conversacionMuestra());
    // Cada sesión activa el pegado entre corchetes y vuelca lo que recibe, con los controles visibles (cat -v).
    cfg = tmuxConfig(harness, {}, {
      socket: sock,
      confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'),
      launcher: () => ['sh', '-c', `printf '\\033[?2004h'; exec cat -v >> '${recibido}'`],
    });
    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: estado,
      claudeConfigDir: join(tmp, 'claude'),
      pollMs: 200,
      stateFallbackMs: 200,
    });
    base = `http://127.0.0.1:${srv.port}`;
    claude = await crear('claude');
    sinEstado = await crear('claude');
    codex = await crear('codex');
    mkdirSync(estado, { recursive: true });
    writeFileSync(
      join(estado, `${sid}.json`),
      JSON.stringify({
        session_id: sid,
        state: 'working',
        event: 'UserPromptSubmit',
        updated_at: new Date(Date.now() + 1000).toISOString(),
        project: 'foo',
        agent: 'claude',
        worktree: '',
        transcript_path: transcript,
        cwd: '/home/u/proyecto',
        tmux_session: claude,
        message: '',
      }),
    );
    await vi.waitFor(async () => expect((await conversar(claude)).status).toBe(200));
  });

  afterAll(async () => {
    await srv.close();
    let socketPath = '';
    try {
      socketPath = (await tmuxCli('start-server', ';', 'display-message', '-p', '#{socket_path}')).stdout.trim();
    } catch {
      // Sin servidor no hay nada que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('SessionInfo.chat', () => {
    it('Claude con transcripción lo tiene disponible; sin ella o con otro agente, no, y dice por qué', async () => {
      const lista = await sesiones();
      expect(lista.find((s) => s.name === claude)?.chat).toEqual({ available: true, reason: null });
      expect(lista.find((s) => s.name === sinEstado)?.chat).toEqual({ available: false, reason: CHAT_NO_TRANSCRIPT });
      expect(lista.find((s) => s.name === codex)?.chat).toEqual({ available: false, reason: CHAT_ONLY_CLAUDE });
    });
  });

  describe('GET /api/sessions/:nombre/conversation', () => {
    it('exige el token y solo admite GET', async () => {
      expect((await fetch(`${base}/api/sessions/${claude}/conversation`)).status).toBe(401);
      expect((await api('POST', `/api/sessions/${claude}/conversation`, {})).status).toBe(405);
    });

    it('sirve la conversación sin caché y después solo lo nuevo', async () => {
      const { status, cache, body } = await conversar(claude);
      expect(status).toBe(200);
      expect(cache).toBe('no-store');
      expect(body).toMatchObject({ sessionId: sid, more: false, reset: false });
      expect(body.events?.filter((e) => e.type === 'user').map((e) => e.text)).toEqual(['Revisa el login\ny dime qué falla', '[Image #1] ¿y esta captura?', 'Gracias']);
      expect((await conversar(claude, body.from)).body.events).toEqual([]);
      appendFileSync(transcript, persona('Una más') + '\n');
      const mas = await conversar(claude, body.from);
      expect(mas.body.events).toEqual([{ type: 'user', text: 'Una más', at: expect.any(Number) }]);
      expect(mas.body.from).toBe(mas.body.size);
    });

    it('rechaza nombres que no son del panel y un `from` que no es un número', async () => {
      expect((await conversar('otra-cosa')).status).toBe(400);
      expect((await conversar(`${claude}%2F..`)).status).toBe(400);
      expect((await api('GET', `/api/sessions/${claude}/conversation?from=-1`)).status).toBe(400);
      expect((await api('GET', `/api/sessions/${claude}/conversation?from=abc`)).status).toBe(400);
    });

    it('404 con el motivo si la sesión no existe, no es de Claude o aún no tiene transcripción', async () => {
      expect((await conversar('jdev-foo-9999')).body.error).toBe('La sesión no existe.');
      const sinTranscripcion = await conversar(sinEstado);
      expect(sinTranscripcion).toMatchObject({ status: 404, body: { error: CHAT_NO_TRANSCRIPT } });
      expect(await conversar(codex)).toMatchObject({ status: 404, body: { error: CHAT_ONLY_CLAUDE } });
    });
  });

  describe('transcript anunciado pero aún sin crear', () => {
    it('el chat está disponible y la conversación responde vacía (200), no un error, hasta que Claude crea el archivo', async () => {
      const pendiente = await crear('claude');
      const sidP = 'abc-chat-pendiente';
      const ruta = join(tmp, 'claude', 'projects', '-proj', `${sidP}.jsonl`);
      writeFileSync(
        join(estado, `${sidP}.json`),
        JSON.stringify({
          session_id: sidP,
          state: 'idle',
          event: 'SessionStart',
          updated_at: new Date(Date.now() + 2000).toISOString(),
          project: 'foo',
          agent: 'claude',
          worktree: '',
          transcript_path: ruta,
          cwd: '/home/u/proyecto',
          tmux_session: pendiente,
          message: '',
        }),
      );
      await vi.waitFor(async () => expect((await sesiones()).find((s) => s.name === pendiente)?.chat.available).toBe(true));
      expect(await conversar(pendiente)).toMatchObject({ status: 200, cache: 'no-store', body: { sessionId: sidP, from: 0, more: false, reset: false, events: [] } });
      writeFileSync(ruta, persona('Primer mensaje') + '\n');
      const ya = await conversar(pendiente);
      expect(ya.status).toBe(200);
      expect(ya.body.events).toEqual([{ type: 'user', text: 'Primer mensaje', at: expect.any(Number) }]);
    });
  });

  describe('POST /api/sessions/:nombre/input', () => {
    it('exige el token, solo admite POST y un origen propio', async () => {
      expect((await fetch(`${base}/api/sessions/${claude}/input`, { method: 'POST', body: '{"text":"hola"}' })).status).toBe(401);
      expect((await api('GET', `/api/sessions/${claude}/input`)).status).toBe(405);
      expect((await enviar(claude, { text: 'hola' }, { Origin: 'http://evil.example' })).status).toBe(403);
    });

    it('valida el nombre y el cuerpo', async () => {
      expect((await enviar('otra-cosa', { text: 'hola' })).status).toBe(400);
      for (const malo of [{}, { text: 3 }, { text: null }, { text: '' }, { text: '  \n ' }, { text: 'a\u001b[201~b' }, { text: 'a\u0000b' }, [], 'no es json', '{"text":']) {
        expect((await enviar(claude, malo)).status, JSON.stringify(malo)).toBe(400);
      }
    });

    it('rechaza un mensaje de más de 64 KiB con 413, también si el cuerpo es mayor que el límite general', async () => {
      expect((await enviar(claude, { text: 'x'.repeat(64 * 1024 + 1) })).status).toBe(413);
      expect((await enviar(claude, { text: 'ñ'.repeat(40 * 1024) })).status).toBe(413); // 80 KiB en UTF-8
      // Un cuerpo mucho mayor se corta antes de leerlo entero: error de conexión o 400, nunca un envío.
      const enorme = await api('POST', `/api/sessions/${claude}/input`, { text: 'x'.repeat(300 * 1024) }).then((r) => r.status, () => 'cortado');
      expect([400, 'cortado']).toContain(enorme);
    });

    it('404 si la sesión no existe y 409 si no es de Claude', async () => {
      expect(await enviar('jdev-foo-9999', { text: 'hola' })).toMatchObject({ status: 404, body: { error: 'La sesión no existe.' } });
      expect(await enviar(codex, { text: 'hola' })).toMatchObject({ status: 409, body: { error: CHAT_ONLY_CLAUDE } });
    });

    it('entrega un mensaje de varias líneas como un único pegado entre corchetes y pulsa Enter', async () => {
      const r = await enviar(claude, { text: 'primera línea\n\n  tercera con ¡acentos! $HOME `x`;\r\ncuarta  \n' });
      expect(r).toMatchObject({ status: 200, body: { sent: true } });
      await vi.waitFor(() => expect(readFileSync(recibido, 'utf8')).toContain('^[[201~'));
      // El pegado va entre marcas y conserva los saltos de línea, los espacios y los caracteres especiales
      // (cat -v escribe los bytes UTF-8 como «M-…»); el Enter llega después de la marca de cierre.
      expect(readFileSync(recibido, 'utf8')).toBe('^[[200~primera lM-CM--nea\n\n  tercera con M-BM-!acentos! $HOME `x`;\ncuarta^[[201~\n');
    });
  });

  describe('POST /input con una ventana de Claude abierta', () => {
    it('409 `tui-busy` y no pega nada mientras la terminal muestra un diálogo; después vuelve a enviar', async () => {
      // El eco de la terminal (modo canónico) deja en pantalla lo que se teclea, sin entregarlo a la aplicación.
      await tmuxCli('send-keys', '-t', `=${claude}:`, '-l', 'Do you want to proceed?');
      await vi.waitFor(async () => expect((await tmuxCli('capture-pane', '-p', '-t', `=${claude}:`)).stdout).toContain('Do you want to proceed?'));
      const antes = readFileSync(recibido, 'utf8');
      const r = await enviar(claude, { text: 'no debe llegar' });
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: 'La terminal tiene abierta una ventana de Claude: ciérrala o respóndela en la terminal.', code: 'tui-busy' });
      await new Promise((ok) => setTimeout(ok, 300));
      expect(readFileSync(recibido, 'utf8')).toBe(antes);

      await tmuxCli('send-keys', '-t', `=${claude}:`, 'C-u');
      await vi.waitFor(async () => expect((await tmuxCli('capture-pane', '-p', '-t', `=${claude}:`)).stdout).not.toContain('Do you want to proceed?'));
      expect((await enviar(claude, { text: 'ya puedes' })).status).toBe(200);
      await vi.waitFor(() => expect(readFileSync(recibido, 'utf8')).toContain('ya puedes'));
    });
  });

  describe('pasteMessage', () => {
    it('devuelve false si la sesión no existe o su nombre no es del panel', async () => {
      expect(await pasteMessage(cfg, 'jdev-foo-9999', 'hola')).toBe(false);
      expect(await pasteMessage(cfg, 'otra-cosa', 'hola')).toBe(false);
    });

    it('no deja buffers de tmux sueltos', async () => {
      await pasteMessage(cfg, claude, 'uno');
      await pasteMessage(cfg, 'jdev-foo-9999', 'dos');
      const { stdout } = await tmuxCli('list-buffers');
      expect(stdout).not.toContain('jdev-msg-');
    });
  });
});

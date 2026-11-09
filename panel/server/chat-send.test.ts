import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendChatMessage } from './chat-send.ts';
import type { ChatSendOptions } from './chat-send.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const execFileAsync = promisify(execFile);
const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

// Una «Claude Code» de mentira en un pty real de tmux: con pegado entre corchetes, y con las ventanas
// de la TUI que importan al chat. Con la ventana de /btw abierta pierde lo que se pega (como el real),
// Abajo/Arriba la desplazan 3 líneas (muestra 5 de las 12 de la respuesta), PageDown no hace nada
// (como el real), Escape la cierra y «c» queda anotada en el log (el servidor no debe pulsarla nunca).
// Modos (argv[3]): «normal» (respuesta con scroll), «corta» (cabe entera, sin scroll) y «colgado» (/btw no termina de responder).
const FALSA = `
import { appendFileSync } from 'node:fs';
const [log, modo] = [process.argv[2], process.argv[3]];
const TOTAL = modo === 'corta' ? 3 : 12;
const ALTO = 5;
const RESPUESTA = Array.from({ length: TOTAL }, (_, i) => 'Línea ' + (i + 1) + ' de la respuesta.');
let ventana = null;
let texto = '';
const pinta = (lineas) => process.stdout.write('\\x1b[2J\\x1b[H' + lineas.join('\\r\\n') + '\\r\\n');
const caja = ['─'.repeat(40), '❯ ', '─'.repeat(40), '  ⏵⏵ auto mode on (shift+tab to cycle)'];
const reposo = () => pinta(['● listo', '', ...caja]);
const btw = () => {
  const { pregunta, listo, desde } = ventana;
  const pie = TOTAL > ALTO ? '↑/↓ to scroll · c to copy · f to fork · Esc to close' : '⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close';
  pinta(['❯ /btw ' + pregunta, '', '  /btw ' + pregunta, '', ...(listo ? [...RESPUESTA.slice(desde, desde + ALTO).map((l) => '    ' + l), '', '  ' + pie] : ['    · Answering…', '  Esc to close'])]);
};
process.stdout.write('\\x1b[?2004h');
reposo();
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (d) => {
  const s = d.toString();
  if (ventana !== null) {
    if (s === '\\x1b') {
      ventana = null;
      appendFileSync(log, 'CERRADA\\n');
      reposo();
    } else if (ventana.listo && s === '\\x1b[B') {
      ventana.desde = Math.min(Math.max(0, TOTAL - ALTO), ventana.desde + 3);
      appendFileSync(log, 'ABAJO\\n');
      btw();
    } else if (s === 'c') {
      appendFileSync(log, 'PULSADA_C\\n');
    } else {
      appendFileSync(log, 'PERDIDO ' + JSON.stringify(s) + '\\n');
    }
    return;
  }
  texto += s.replace(/\\x1b\\[20[01]~/g, '');
  if (!texto.endsWith('\\r')) return;
  const linea = texto.slice(0, -1);
  texto = '';
  if (linea.startsWith('/btw ')) {
    const pregunta = linea.slice(5);
    ventana = { pregunta, listo: false, desde: 0 };
    appendFileSync(log, 'BTW ' + pregunta + '\\n');
    btw();
    if (modo !== 'colgado') setTimeout(() => {
      if (ventana === null) return;
      ventana.listo = true;
      btw();
    }, 600);
  } else if (linea === '/model') {
    ventana = { pregunta: '', listo: false, desde: 0 };
    appendFileSync(log, 'MODEL\\n');
    pinta(['  Select model', '  ❯ 1. Default', '', '  Enter to confirm · Esc to cancel']);
  } else {
    appendFileSync(log, 'MSG ' + JSON.stringify(linea) + '\\n');
  }
});
`;

describe('sendChatMessage con una TUI falsa en tmux real', () => {
  const sock = `jdev-test-send-${process.pid}-${Date.now().toString(36)}`;
  let tmp: string;
  let cfg: TmuxConfig;
  let log = '';
  const tmuxCli = (...args: string[]) => execFileAsync('tmux', ['-L', sock, ...args], { env: { ...process.env, TMUX: '' } });
  const lineasDeLog = () => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
  const timing = { pollMs: 50, settleMs: 200, btwTimeoutMs: 6000, btwBareTimeoutMs: 600, commandWatchMs: 500, scrollWaitMs: 80, maxScrollSteps: 50, closeWaitMs: 1000 };
  let n = 0;

  /** Arranca una TUI falsa en una sesión nueva y espera a que pinte el reposo. */
  const sesion = async (modo = 'normal') => {
    const nombre = `jdev-fake-${++n}`;
    await tmuxCli('new-session', '-d', '-s', nombre, '-x', '100', '-y', '30', '-c', tmp, '--', 'node', join(tmp, 'falsa.mjs'), log, modo);
    await vi.waitFor(async () => expect((await tmuxCli('capture-pane', '-p', '-t', `=${nombre}:`)).stdout).toContain('auto mode on'));
    return nombre;
  };
  const opciones = (extra: Partial<ChatSendOptions> = {}): ChatSendOptions => ({ timing, ...extra });

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-chat-send-'));
    log = join(tmp, 'log.txt');
    writeFileSync(log, '');
    writeFileSync(join(tmp, 'falsa.mjs'), FALSA);
    cfg = tmuxConfig(REAL_HARNESS, {}, { socket: sock, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf') });
    execFileSync('tmux', ['-L', sock, '-f', cfg.confFile, 'start-server'], { env: { ...process.env, TMUX: '' } });
  });

  afterAll(async () => {
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

  it('un mensaje normal se entrega y responde {sent:true}', async () => {
    const s = await sesion();
    const r = await sendChatMessage(cfg, s, 'hola mundo', opciones());
    expect(r).toEqual({ status: 200, body: { sent: true } });
    await vi.waitFor(() => expect(lineasDeLog()).toContain('MSG "hola mundo"'));
  });

  it('404 si la sesión no existe', async () => {
    expect(await sendChatMessage(cfg, 'jdev-fake-9999', 'hola', opciones())).toMatchObject({ status: 404 });
  });

  it('/btw con scroll: desplaza la ventana con Abajo, reconstruye la respuesta completa, la cierra y el siguiente mensaje llega, sin pulsar «c»', async () => {
    const s = await sesion();
    const r = await sendChatMessage(cfg, s, '/btw ¿qué archivo?', opciones());
    expect(r.status).toBe(200);
    const completa = Array.from({ length: 12 }, (_, i) => `Línea ${i + 1} de la respuesta.`).join('\n');
    expect(r).toMatchObject({ body: { sent: true, btw: { question: '¿qué archivo?', answer: completa, truncated: false } } });
    expect(lineasDeLog().filter((l) => l === 'ABAJO').length).toBeGreaterThan(2);
    expect(lineasDeLog()).not.toContain('PULSADA_C');
    expect(lineasDeLog().filter((l) => l.startsWith('CERRADA'))).toHaveLength(1);
    expect((await tmuxCli('capture-pane', '-p', '-t', `=${s}:`)).stdout).not.toContain('Esc to close');

    const siguiente = await sendChatMessage(cfg, s, 'sigamos', opciones());
    expect(siguiente.status).toBe(200);
    await vi.waitFor(() => expect(lineasDeLog()).toContain('MSG "sigamos"'));
    expect(lineasDeLog().some((l) => l.startsWith('PERDIDO'))).toBe(false);
  });

  it('/btw que cabe entera: no es truncada aunque se pruebe a desplazar, y no se pulsa «c»', async () => {
    const s = await sesion('corta');
    const r = await sendChatMessage(cfg, s, '/btw corta', opciones());
    expect(r).toMatchObject({
      status: 200,
      body: { sent: true, btw: { question: 'corta', answer: 'Línea 1 de la respuesta.\nLínea 2 de la respuesta.\nLínea 3 de la respuesta.', truncated: false } },
    });
    expect(lineasDeLog()).not.toContain('PULSADA_C');
    expect((await tmuxCli('capture-pane', '-p', '-t', `=${s}:`)).stdout).not.toContain('Esc to close');
  });

  it('/btw más larga que el tope de pasos: devuelve lo leído como truncada y cierra la ventana', async () => {
    const s = await sesion();
    const r = await sendChatMessage(cfg, s, '/btw tope', { timing: { ...timing, maxScrollSteps: 2 } });
    expect(r).toMatchObject({ status: 200, body: { btw: { truncated: true } } });
    if (r.status !== 200 || !r.body.btw) throw new Error('sin respuesta');
    expect(r.body.btw.answer.startsWith('Línea 1 de la respuesta.')).toBe(true);
    expect(r.body.btw.answer).not.toContain('Línea 12');
    expect((await tmuxCli('capture-pane', '-p', '-t', `=${s}:`)).stdout).not.toContain('Esc to close');
  });

  it('/btw que no responde a tiempo: pending, sin pulsar Escape, y mientras la ventana siga abierta no se envía nada (409)', async () => {
    const s = await sesion('colgado');
    const r = await sendChatMessage(cfg, s, '/btw lenta', { timing: { ...timing, btwTimeoutMs: 800 } });
    expect(r).toEqual({ status: 200, body: { sent: true, btw: null, pending: true } });
    expect((await tmuxCli('capture-pane', '-p', '-t', `=${s}:`)).stdout).toContain('Esc to close');

    const bloqueado = await sendChatMessage(cfg, s, 'esto no debe llegar', opciones());
    expect(bloqueado).toEqual({
      status: 409,
      body: { error: 'La terminal tiene abierta una ventana de Claude: ciérrala o respóndela en la terminal.', code: 'tui-busy' },
    });
    await new Promise((ok) => setTimeout(ok, 300));
    expect(readFileSync(log, 'utf8')).not.toContain('esto no debe llegar');
    expect(lineasDeLog().some((l) => l.startsWith('PERDIDO'))).toBe(false);
  });

  it('un comando que abre un menú se envía y avisa de que espera en la terminal; después, 409', async () => {
    const s = await sesion();
    expect(await sendChatMessage(cfg, s, '/model', opciones())).toEqual({ status: 200, body: { sent: true, awaitingTerminal: true } });
    expect(await sendChatMessage(cfg, s, 'hola', opciones())).toMatchObject({ status: 409, body: { code: 'tui-busy' } });
  });

  it('un comando sin ventana responde {sent:true} y un texto que empieza por una ruta no se trata como comando', async () => {
    const s = await sesion();
    expect(await sendChatMessage(cfg, s, '/goal close', opciones())).toEqual({ status: 200, body: { sent: true } });
    const t0 = Date.now();
    expect(await sendChatMessage(cfg, s, '/home/u/archivo.ts falla', opciones())).toEqual({ status: 200, body: { sent: true } });
    expect(Date.now() - t0).toBeLessThan(timing.commandWatchMs);
  });

  it('/btw sin pregunta no se queda esperando para siempre', async () => {
    const s = await sesion();
    const t0 = Date.now();
    const r = await sendChatMessage(cfg, s, '/btw', opciones());
    expect(r).toEqual({ status: 200, body: { sent: true, btw: null } });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('el cerrojo por sesión ordena dos envíos: el segundo espera a que /btw termine y no se pierde', async () => {
    const s = await sesion();
    const [a, b] = await Promise.all([sendChatMessage(cfg, s, '/btw primero', opciones()), sendChatMessage(cfg, s, 'segundo', opciones())]);
    expect(a.status).toBe(200);
    expect(b).toEqual({ status: 200, body: { sent: true } });
    await vi.waitFor(() => expect(lineasDeLog()).toContain('MSG "segundo"'));
    const orden = lineasDeLog().filter((l) => l === 'BTW primero' || l === 'MSG "segundo"' || l === 'CERRADA');
    expect(orden.slice(-3)).toEqual(['BTW primero', 'CERRADA', 'MSG "segundo"']);
  });
});

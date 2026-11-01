import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SVG, gif, jpeg, png, webpExtended } from './image-fixtures.ts';
import { startServer } from './main.ts';
import type { RunningServer } from './main.ts';
import { killServer, tmuxConfig } from './tmux.ts';
import type { TmuxConfig } from './tmux.ts';

vi.setConfig({ testTimeout: 30000 });

const REAL_HARNESS = resolve(import.meta.dirname, '..', '..');

type Error_ = { error: string };

// Petición con http para controlar Transfer-Encoding y cuerpos que el servidor corta.
function enviar(
  puerto: number,
  opts: { method: string; path: string; headers: Record<string, string>; cuerpo?: Buffer[] },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; cuerpo: Buffer }> {
  return new Promise((ok, ko) => {
    const req = request({ host: '127.0.0.1', port: puerto, method: opts.method, path: opts.path, headers: opts.headers }, (res) => {
      const trozos: Buffer[] = [];
      res.on('data', (t: Buffer) => trozos.push(t));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, cuerpo: Buffer.concat(trozos) }));
      res.on('error', ko);
    });
    req.on('error', ko);
    for (const t of opts.cuerpo ?? []) req.write(t);
    req.end();
  });
}

describe('GET /api/image y POST /api/uploads', () => {
  const token = 'e'.repeat(64);
  const sock = `jdev-test-media-${process.pid}-${Date.now().toString(36)}`;
  const auth = { Authorization: `Bearer ${token}` };
  let tmp: string;
  let harness: string;
  let permitida: string;
  let fuera: string;
  let subidas: string;
  let proyecto: string;
  let cfg: TmuxConfig;
  let srv: RunningServer;
  let base: string;
  const tmuxCli = (...args: string[]) => execFileSync('tmux', ['-L', sock, '-f', join(REAL_HARNESS, 'panel', 'tmux.conf'), ...args], { env: { ...process.env, TMUX: '' } });

  const imagen = (ruta: string, extra = '', headers: Record<string, string> = auth, method = 'GET') =>
    fetch(`${base}/api/image?${extra}path=${encodeURIComponent(ruta)}`, { method, headers });
  const subir = (cuerpo: Buffer, tipo: string | null, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/uploads`, { method: 'POST', headers: { ...auth, ...(tipo ? { 'Content-Type': tipo } : {}), ...headers }, body: new Uint8Array(cuerpo) });

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(join(tmpdir(), 'jdev-media-')));
    harness = join(tmp, 'harness');
    proyecto = join(harness, 'projects', 'demo');
    permitida = join(tmp, 'permitida');
    fuera = join(tmp, 'fuera');
    subidas = join(tmp, 'cache', 'uploads');
    mkdirSync(join(proyecto, 'docs', 'img'), { recursive: true });
    mkdirSync(permitida);
    mkdirSync(fuera);
    mkdirSync(join(tmp, 'dist'));
    writeFileSync(join(proyecto, 'docs', 'img', 'logo.png'), png(30, 20));
    writeFileSync(join(permitida, 'captura.png'), png(300, 200));
    writeFileSync(join(permitida, 'foto.jpg'), jpeg(640, 480));
    writeFileSync(join(permitida, 'anim.gif'), gif(4, 5));
    writeFileSync(join(permitida, 'nueva.webp'), webpExtended(8, 9));
    writeFileSync(join(permitida, 'dibujo.svg'), SVG);
    writeFileSync(join(permitida, 'falso.png'), 'esto es texto, no una imagen');
    writeFileSync(join(permitida, 'grande.png'), png(1, 1, 5000));
    writeFileSync(join(fuera, 'secreto.png'), png());
    symlinkSync(join(fuera, 'secreto.png'), join(permitida, 'enlace.png'));
    symlinkSync(join(permitida, 'captura.png'), join(permitida, 'enlace-ok.png'));

    cfg = tmuxConfig(harness, {}, { socket: sock, confFile: join(REAL_HARNESS, 'panel', 'tmux.conf'), launcher: () => ['sh', '-c', 'sleep 60'] });
    // Una sesión del panel con el directorio del proyecto, y otra que no es del panel.
    tmuxCli('new-session', '-d', '-s', 'jdev-demo-1', '-c', proyecto, 'sleep 60');
    tmuxCli('new-session', '-d', '-s', 'otra', '-c', proyecto, 'sleep 60');

    srv = await startServer({
      harnessRoot: harness,
      port: 0,
      token,
      distDir: join(tmp, 'dist'),
      configDir: join(tmp, 'config'),
      tmux: cfg,
      stateDir: join(tmp, 'state'),
      claudeConfigDir: join(tmp, 'claude'),
      uploadsDir: subidas,
      imageDirs: [harness, permitida, subidas],
      imageMaxBytes: 4000,
      uploadMaxBytes: 1000,
      pollMs: 500,
      stateFallbackMs: 500,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await srv.close();
    let socketPath = '';
    try {
      socketPath = tmuxCli('start-server', ';', 'display-message', '-p', '#{socket_path}').toString().trim();
    } catch {
      // Sin servidor no hay socket que borrar.
    }
    await killServer(cfg);
    if (socketPath.endsWith(`/${sock}`)) rmSync(socketPath, { force: true });
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('GET /api/image', () => {
    it('exige token, también en HEAD', async () => {
      const ruta = join(permitida, 'captura.png');
      expect((await imagen(ruta, '', {})).status).toBe(401);
      expect((await imagen(ruta, '', { Authorization: 'Bearer mal' })).status).toBe(401);
      expect((await imagen(ruta, '', {}, 'HEAD')).status).toBe(401);
    });

    it('entrega una imagen permitida con las cabeceras seguras y sus dimensiones', async () => {
      const casos: [string, string, string, string][] = [
        ['captura.png', 'image/png', '300', '200'],
        ['foto.jpg', 'image/jpeg', '640', '480'],
        ['anim.gif', 'image/gif', '4', '5'],
        ['nueva.webp', 'image/webp', '8', '9'],
      ];
      for (const [nombre, tipo, ancho, alto] of casos) {
        const r = await imagen(join(permitida, nombre));
        expect(r.status, nombre).toBe(200);
        const cuerpo = Buffer.from(await r.arrayBuffer());
        expect(cuerpo.equals(readFileSync(join(permitida, nombre)))).toBe(true);
        expect(r.headers.get('content-type')).toBe(tipo);
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect(r.headers.get('x-image-size')).toBe(String(cuerpo.length));
        expect(r.headers.get('x-image-width')).toBe(ancho);
        expect(r.headers.get('x-image-height')).toBe(alto);
        expect(r.headers.get('content-security-policy')).toBeNull();
      }
    });

    it('entrega el SVG con CSP que impide ejecutar scripts y sin dimensiones', async () => {
      const r = await imagen(join(permitida, 'dibujo.svg'));
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/svg+xml');
      expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('x-image-width')).toBeNull();
      expect(await r.text()).toBe(SVG);
    });

    it('HEAD devuelve las mismas cabeceras sin cuerpo', async () => {
      const r = await imagen(join(permitida, 'captura.png'), '', auth, 'HEAD');
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(r.headers.get('content-length')).toBe(String(png(300, 200).length));
      expect(r.headers.get('x-image-size')).toBe(String(png(300, 200).length));
      expect(r.headers.get('x-image-width')).toBe('300');
      expect((await r.arrayBuffer()).byteLength).toBe(0);
      expect((await imagen(join(fuera, 'secreto.png'), '', auth, 'HEAD')).status).toBe(403);
      const svg = await imagen(join(permitida, 'dibujo.svg'), '', auth, 'HEAD');
      expect(svg.headers.get('content-security-policy')).toContain('sandbox');
    });

    it('resuelve una ruta relativa con el directorio actual de la sesión', async () => {
      const r = await imagen('docs/img/logo.png', 'session=jdev-demo-1&');
      expect(r.status).toBe(200);
      expect(r.headers.get('x-image-width')).toBe('30');
      expect((await imagen('./docs/img/logo.png', 'session=jdev-demo-1&')).status).toBe(200);
      expect((await imagen('docs/img/otra.png', 'session=jdev-demo-1&')).status).toBe(404);
      // Una absoluta con sesión no necesita el directorio de la sesión.
      expect((await imagen(join(permitida, 'captura.png'), 'session=jdev-demo-1&')).status).toBe(200);
    });

    it('informa de la ruta real en X-Image-Path (GET y HEAD), codificada y con los enlaces resueltos', async () => {
      const real = (r: Response) => decodeURIComponent(r.headers.get('x-image-path') ?? '');
      const relativa = join(proyecto, 'docs', 'img', 'logo.png');
      for (const metodo of ['GET', 'HEAD']) {
        expect(real(await imagen('./docs/img/../img/logo.png', 'session=jdev-demo-1&', auth, metodo))).toBe(relativa);
        expect(real(await imagen(relativa, '', auth, metodo))).toBe(relativa);
      }
      // Un enlace simbólico dentro de las carpetas permitidas apunta al archivo real.
      const viaEnlace = await imagen(join(permitida, 'enlace-ok.png'));
      expect(viaEnlace.status).toBe(200);
      expect(real(viaEnlace)).toBe(join(permitida, 'captura.png'));
      // Caracteres no ASCII: la cabecera va codificada.
      const rara = join(permitida, 'captura ñandú ✓.png');
      writeFileSync(rara, png(3, 3));
      const r = await imagen(rara);
      expect(r.status).toBe(200);
      expect(r.headers.get('x-image-path')).toMatch(/^[\x20-\x7e]+$/);
      expect(real(r)).toBe(rara);
    });

    it('exige una sesión del panel que exista para una ruta relativa', async () => {
      const mensaje = async (r: Response) => ((await r.json()) as Error_).error;
      const sinSesion = await imagen('docs/img/logo.png');
      expect(sinSesion.status).toBe(400);
      expect(await mensaje(sinSesion)).toMatch(/sesión/);
      expect((await imagen('docs/img/logo.png', 'session=otra&')).status).toBe(400);
      expect((await imagen('docs/img/logo.png', 'session=..%2F..&')).status).toBe(400);
      expect((await imagen('docs/img/logo.png', 'session=jdev-demo-9&')).status).toBe(404);
      expect((await imagen('docs/img/logo.png', 'session=jdev-nada-1&')).status).toBe(404);
    });

    it('no sale de las carpetas permitidas: ruta fuera, .., enlaces simbólicos', async () => {
      const mensaje = async (r: Response) => ((await r.json()) as Error_).error;
      const fueraR = await imagen(join(fuera, 'secreto.png'));
      expect(fueraR.status).toBe(403);
      expect(await mensaje(fueraR)).toMatch(/fuera de las carpetas permitidas/);
      expect((await imagen('/etc/passwd')).status).toBe(403);
      expect((await imagen(`${permitida}/../fuera/secreto.png`)).status).toBe(403);
      expect((await imagen('../../../../../../etc/passwd', 'session=jdev-demo-1&')).status).toBe(403);
      expect((await imagen('../../../../fuera/secreto.png', 'session=jdev-demo-1&')).status).toBe(403);
      expect((await imagen(join(permitida, 'enlace.png'))).status).toBe(403);
      // Una ruta inexistente fuera tampoco revela nada.
      expect((await imagen(join(fuera, 'no-existe.png'))).status).toBe(403);
      expect((await imagen(join(permitida, 'no-existe.png'))).status).toBe(404);
    });

    it('rechaza lo que no es una imagen aunque se llame .png', async () => {
      const r = await imagen(join(permitida, 'falso.png'));
      expect(r.status).toBe(415);
      expect(((await r.json()) as Error_).error).toMatch(/no es una imagen/);
      writeFileSync(join(permitida, 'notas.txt'), 'hola');
      expect((await imagen(join(permitida, 'notas.txt'))).status).toBe(415);
    });

    it('aplica el límite de tamaño y valida los parámetros', async () => {
      const grande = await imagen(join(permitida, 'grande.png'));
      expect(grande.status).toBe(413);
      expect(((await grande.json()) as Error_).error).toMatch(/límite/);
      expect((await fetch(`${base}/api/image`, { headers: auth })).status).toBe(400);
      expect((await fetch(`${base}/api/image?path=`, { headers: auth })).status).toBe(400);
      expect((await fetch(`${base}/api/image?path=${join(permitida, 'captura.png')}%00.txt`, { headers: auth })).status).toBe(400);
      const post = await fetch(`${base}/api/image?path=x`, { method: 'POST', headers: auth });
      expect(post.status).toBe(405);
      expect(post.headers.get('allow')).toBe('GET, HEAD');
    });
  });

  describe('POST /api/uploads', () => {
    it('exige token y origen propio', async () => {
      const sinToken = await fetch(`${base}/api/uploads`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png()) });
      expect(sinToken.status).toBe(401);
      expect((await subir(png(), 'image/png', { Origin: 'http://evil.example' })).status).toBe(403);
      expect((await subir(png(), 'image/png', { Origin: `http://localhost:${srv.port}` })).status).toBe(201);
      const get = await fetch(`${base}/api/uploads`, { headers: auth });
      expect(get.status).toBe(405);
      expect(get.headers.get('allow')).toBe('POST');
    });

    it('guarda una imagen válida con nombre único y permisos del usuario, y se puede ver', async () => {
      const datos = png(50, 40, 100);
      const r = await subir(datos, 'image/png');
      expect(r.status).toBe(201);
      const cuerpo = (await r.json()) as { path: string; name: string; size: number };
      expect(cuerpo.name).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{6}\.png$/);
      expect(cuerpo.path).toBe(join(subidas, cuerpo.name));
      expect(cuerpo.size).toBe(datos.length);
      expect(readFileSync(cuerpo.path).equals(datos)).toBe(true);
      expect(statSync(cuerpo.path).mode & 0o777).toBe(0o600);
      expect(statSync(subidas).mode & 0o777).toBe(0o700);
      // Dos subidas iguales no se pisan.
      const otra = (await (await subir(datos, 'image/png')).json()) as { name: string };
      expect(otra.name).not.toBe(cuerpo.name);
      // La carpeta de subidas es una de las permitidas para el visor.
      const vista = await imagen(cuerpo.path);
      expect(vista.status).toBe(200);
      expect(vista.headers.get('x-image-width')).toBe('50');
    });

    it('acepta JPEG, GIF y WEBP y guarda con la extensión del contenido', async () => {
      const jpg = (await (await subir(jpeg(), 'image/jpeg')).json()) as { name: string };
      expect(jpg.name).toMatch(/\.jpg$/);
      expect(((await (await subir(gif(), 'image/gif')).json()) as { name: string }).name).toMatch(/\.gif$/);
      expect(((await (await subir(webpExtended(), 'image/webp')).json()) as { name: string }).name).toMatch(/\.webp$/);
    });

    it('rechaza tipos no permitidos, firmas falsas y cuerpos vacíos sin guardar nada', async () => {
      const antes = readdirSync(subidas).length;
      const tipo = await subir(Buffer.from(SVG), 'image/svg+xml');
      expect(tipo.status).toBe(415);
      expect(((await tipo.json()) as Error_).error).toMatch(/PNG, JPEG, GIF o WEBP/);
      expect((await subir(Buffer.from('hola'), 'text/plain')).status).toBe(415);
      expect((await subir(png(), null)).status).toBe(415);
      const falsa = await subir(Buffer.from('esto no es un png'), 'image/png');
      expect(falsa.status).toBe(415);
      expect(((await falsa.json()) as Error_).error).toMatch(/no coincide/);
      expect((await subir(jpeg(), 'image/png')).status).toBe(415);
      expect((await subir(Buffer.alloc(0), 'image/png')).status).toBe(400);
      expect(readdirSync(subidas).length).toBe(antes);
    });

    it('corta al superar el límite, con Content-Length o sin él', async () => {
      const antes = readdirSync(subidas).length;
      const grande = Buffer.concat([png(), Buffer.alloc(5000)]);
      const r = await subir(grande, 'image/png');
      expect(r.status).toBe(413);
      expect(((await r.json()) as Error_).error).toMatch(/límite/);
      // Sin Content-Length (Transfer-Encoding: chunked): se corta al pasar del límite.
      const chunked = await enviar(srv.port, {
        method: 'POST',
        path: '/api/uploads',
        headers: { ...auth, 'Content-Type': 'image/png', 'Transfer-Encoding': 'chunked' },
        cuerpo: [png(), Buffer.alloc(600), Buffer.alloc(600)],
      });
      expect(chunked.status).toBe(413);
      expect(chunked.headers.connection).toBe('close');
      expect(readdirSync(subidas).length).toBe(antes);
      // Justo en el límite sí entra.
      expect((await subir(png(1, 1, 1000 - 33), 'image/png')).status).toBe(201);
      expect((await subir(png(1, 1, 1000 - 32), 'image/png')).status).toBe(413);
    });
  });

  describe('limpieza al arrancar', () => {
    it('el servidor borra las subidas de más de 7 días al iniciarse', async () => {
      const dir = join(tmp, 'cache2', 'uploads');
      mkdirSync(dir, { recursive: true });
      const vieja = join(dir, '2026-10-01-1000-aaaaaa.png');
      const reciente = join(dir, '2026-10-30-1000-bbbbbb.png');
      writeFileSync(vieja, png());
      writeFileSync(reciente, png());
      const hace9 = (Date.now() - 9 * 86400000) / 1000;
      utimesSync(vieja, hace9, hace9);
      const otro = await startServer({
        harnessRoot: harness,
        port: 0,
        token,
        distDir: join(tmp, 'dist'),
        configDir: join(tmp, 'config'),
        tmux: cfg,
        stateDir: join(tmp, 'state'),
        claudeConfigDir: join(tmp, 'claude'),
        uploadsDir: dir,
        imageDirs: [dir],
      });
      try {
        await vi.waitFor(() => expect(existsSync(vieja)).toBe(false));
        expect(existsSync(reciente)).toBe(true);
      } finally {
        await otro.close();
      }
    });
  });
});

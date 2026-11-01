import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SVG, gif, jpeg, png, webpExtended } from './image-fixtures.ts';
import { UPLOAD_MAX_AGE_MS, UploadError, cleanOldUploads, saveUpload, startUploadCleanup } from './uploads.ts';
import { uploadsDir } from './paths.ts';

const DIA = 24 * 60 * 60 * 1000;

describe('saveUpload', () => {
  let tmp: string;
  let dir: string;
  const rechazo = async (...args: Parameters<typeof saveUpload>) => {
    try {
      await saveUpload(...args);
    } catch (e) {
      expect(e).toBeInstanceOf(UploadError);
      return e as UploadError;
    }
    throw new Error('debía rechazarse');
  };

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-up-'));
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  beforeEach(() => {
    dir = join(tmp, `uploads-${Math.random().toString(36).slice(2)}`);
  });

  it('guarda cada tipo con nombre único, extensión del contenido y permisos del usuario', async () => {
    const casos: [string, Buffer, string][] = [
      ['image/png', png(), 'png'],
      ['image/jpeg', jpeg(), 'jpg'],
      ['image/gif', gif(), 'gif'],
      ['image/webp', webpExtended(), 'webp'],
      ['IMAGE/PNG; charset=binary', png(), 'png'],
    ];
    const nombres = new Set<string>();
    for (const [tipo, datos, ext] of casos) {
      const r = await saveUpload(datos, tipo, dir, new Date(2026, 10, 1, 9, 5));
      expect(r.name).toMatch(new RegExp(`^2026-11-01-0905-[0-9a-f]{6}\\.${ext}$`));
      expect(r.path).toBe(join(dir, r.name));
      expect(r.size).toBe(datos.length);
      expect(readFileSync(r.path).equals(datos)).toBe(true);
      expect(statSync(r.path).mode & 0o777).toBe(0o600);
      nombres.add(r.name);
    }
    expect(nombres.size).toBe(casos.length);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('deja la carpeta y el archivo en 0700 y 0600 aunque la máscara sea abierta o la carpeta ya exista', async () => {
    mkdirSync(dir, { mode: 0o755 });
    const antes = process.umask(0);
    try {
      const r = await saveUpload(png(), 'image/png', dir);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(r.path).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(antes);
    }
  });

  it('rechaza tipos no admitidos, también SVG', async () => {
    for (const tipo of ['image/svg+xml', 'text/plain', 'application/octet-stream', 'video/mp4', 'image/bmp', '', undefined]) {
      expect((await rechazo(png(), tipo, dir)).status, String(tipo)).toBe(415);
    }
    expect((await rechazo(Buffer.from(SVG), 'image/svg+xml', dir)).status).toBe(415);
    expect(existsSync(dir)).toBe(false);
  });

  it('rechaza una firma falsa o que no coincide con el tipo', async () => {
    expect((await rechazo(Buffer.from('no soy un png'), 'image/png', dir)).status).toBe(415);
    expect((await rechazo(jpeg(), 'image/png', dir)).status).toBe(415);
    expect((await rechazo(Buffer.from(SVG), 'image/png', dir)).status).toBe(415);
    expect((await rechazo(Buffer.alloc(0), 'image/png', dir)).status).toBe(400);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('limpieza de subidas antiguas', () => {
  let dir: string;
  const antiguedad = (ruta: string, dias: number) => {
    const t = (Date.now() - dias * DIA) / 1000;
    utimesSync(ruta, t, t);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jdev-clean-'));
  });

  it('borra solo las imágenes adjuntadas de más de 7 días', async () => {
    try {
      const vieja = join(dir, '2026-10-01-1000-aaaaaa.png');
      const limite = join(dir, '2026-10-20-1000-bbbbbb.jpg');
      const reciente = join(dir, '2026-10-31-1000-cccccc.webp');
      writeFileSync(vieja, png());
      writeFileSync(limite, jpeg());
      writeFileSync(reciente, png());
      antiguedad(vieja, 8);
      antiguedad(limite, 6.9);
      // Archivos ajenos a las subidas: no se tocan aunque sean antiguos.
      const ajeno = join(dir, 'notas.txt');
      const otroNombre = join(dir, '2026-10-01-1000-AAAAAA.png');
      writeFileSync(ajeno, 'x');
      writeFileSync(otroNombre, png());
      antiguedad(ajeno, 30);
      antiguedad(otroNombre, 30);
      // Un enlace con nombre de subida no se sigue ni se borra como archivo.
      const objetivo = join(dir, 'objetivo.txt');
      writeFileSync(objetivo, 'x');
      symlinkSync(objetivo, join(dir, '2026-09-01-1000-dddddd.png'));
      mkdirSync(join(dir, '2026-09-01-1000-eeeeee.gif'));

      expect(await cleanOldUploads(dir)).toBe(1);
      expect(readdirSync(dir).sort()).toEqual(
        ['2026-09-01-1000-dddddd.png', '2026-09-01-1000-eeeeee.gif', '2026-10-01-1000-AAAAAA.png', '2026-10-20-1000-bbbbbb.jpg', '2026-10-31-1000-cccccc.webp', 'notas.txt', 'objetivo.txt'].sort(),
      );
      expect(UPLOAD_MAX_AGE_MS).toBe(7 * DIA);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('con la carpeta inexistente no hace nada', async () => {
    rmSync(dir, { recursive: true, force: true });
    expect(await cleanOldUploads(dir)).toBe(0);
  });

  it('la tarea periódica limpia al arrancar y de nuevo en cada pasada, y se puede detener', async () => {
    try {
      const vieja = join(dir, '2026-10-01-1000-aaaaaa.png');
      writeFileSync(vieja, png());
      antiguedad(vieja, 9);
      const parar = startUploadCleanup(dir, 50);
      await vi.waitFor(() => expect(existsSync(vieja)).toBe(false), { timeout: 5000 });
      const otra = join(dir, '2026-10-02-1000-bbbbbb.png');
      writeFileSync(otra, png());
      antiguedad(otra, 9);
      await vi.waitFor(() => expect(existsSync(otra)).toBe(false), { timeout: 5000 });
      parar();
      // Una pasada que ya hubiera empezado antes de parar puede seguir en curso:
      // se deja terminar antes de crear el archivo que debe sobrevivir.
      await new Promise((ok) => setTimeout(ok, 150));
      const ultima = join(dir, '2026-10-03-1000-cccccc.png');
      writeFileSync(ultima, png());
      antiguedad(ultima, 9);
      await new Promise((ok) => setTimeout(ok, 200));
      expect(existsSync(ultima)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('el temporizador no impide que el proceso termine', () => {
    try {
      const modulo = resolve(import.meta.dirname, 'uploads.ts');
      // Si el temporizador mantuviera vivo el proceso, execFileSync agotaría el tiempo.
      execFileSync(process.execPath, ['--input-type=module', '-e', `import { startUploadCleanup } from ${JSON.stringify(modulo)}; startUploadCleanup(${JSON.stringify(dir)}, 60000);`], {
        timeout: 15000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('carpeta de subidas', () => {
  it('sigue XDG_CACHE_HOME y cae en ~/.cache', () => {
    expect(uploadsDir({ XDG_CACHE_HOME: '/x/cache' })).toBe('/x/cache/jdev-ai/panel/uploads');
    expect(uploadsDir({ XDG_CACHE_HOME: 'relativa' })).toMatch(/\/\.cache\/jdev-ai\/panel\/uploads$/);
    expect(uploadsDir({})).toMatch(/\/\.cache\/jdev-ai\/panel\/uploads$/);
  });
});

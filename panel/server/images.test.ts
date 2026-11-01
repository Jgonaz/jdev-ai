import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SVG, gif, jpeg, png, webpExtended, webpLossless, webpLossy } from './image-fixtures.ts';
import { ImageError, defaultImageDirs, detectImageKind, imageDimensions, openImage } from './images.ts';

describe('firma y dimensiones', () => {
  it('reconoce cada formato por sus bytes', () => {
    expect(detectImageKind(png())).toBe('png');
    expect(detectImageKind(jpeg())).toBe('jpeg');
    expect(detectImageKind(gif())).toBe('gif');
    expect(detectImageKind(webpLossy())).toBe('webp');
    expect(detectImageKind(Buffer.from(SVG))).toBe('svg');
    expect(detectImageKind(Buffer.from('<svg viewBox="0 0 1 1"/>'))).toBe('svg');
    expect(detectImageKind(Buffer.from('﻿  <!-- x --><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
  });

  it('rechaza lo que no es una imagen', () => {
    expect(detectImageKind(Buffer.alloc(0))).toBeNull();
    expect(detectImageKind(Buffer.from('hola, esto es texto'))).toBeNull();
    expect(detectImageKind(Buffer.from('<html><body><svg></svg></body></html>'))).toBeNull();
    expect(detectImageKind(Buffer.from('<?xml version="1.0"?><note/>'))).toBeNull();
    expect(detectImageKind(Buffer.from('RIFF....WAVE'))).toBeNull();
    expect(detectImageKind(Buffer.concat([Buffer.from('<svg>'), Buffer.from([0]), Buffer.from('</svg>')]))).toBeNull();
  });

  it('lee las dimensiones de la cabecera', () => {
    expect(imageDimensions(png(300, 200), 'png')).toEqual({ width: 300, height: 200 });
    expect(imageDimensions(gif(40, 50), 'gif')).toEqual({ width: 40, height: 50 });
    expect(imageDimensions(jpeg(640, 480), 'jpeg')).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(webpExtended(800, 600), 'webp')).toEqual({ width: 800, height: 600 });
    expect(imageDimensions(webpLossless(100, 110), 'webp')).toEqual({ width: 100, height: 110 });
    expect(imageDimensions(webpLossy(12, 13), 'webp')).toEqual({ width: 12, height: 13 });
    expect(imageDimensions(Buffer.from(SVG), 'svg')).toBeNull();
    expect(imageDimensions(png().subarray(0, 10), 'png')).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2]), 'jpeg')).toBeNull();
  });

  it('las carpetas por defecto incluyen harness, QA, subidas y temporal', () => {
    expect(defaultImageDirs('/h', '/u', { TMPDIR: '/t', PLAYWRIGHT_MCP_OUTPUT_DIR: '/qa/x' })).toEqual(['/h', '/qa/x', '/t/jdev-qa', '/u', '/t']);
    expect(defaultImageDirs('/h', '/u', {})).toEqual(['/h', '/tmp/jdev-qa', '/u', '/tmp']);
    // Una variable relativa se ignora.
    expect(defaultImageDirs('/h', '/u', { TMPDIR: 'rel', PLAYWRIGHT_MCP_OUTPUT_DIR: 'rel' })).toEqual(['/h', '/tmp/jdev-qa', '/u', '/tmp']);
  });
});

describe('openImage', () => {
  let tmp: string;
  let permitida: string;
  let fuera: string;
  const rechazo = async (opts: Parameters<typeof openImage>[0]) => {
    try {
      (await openImage(opts)).handle.close();
    } catch (e) {
      expect(e).toBeInstanceOf(ImageError);
      return e as ImageError;
    }
    throw new Error('debía rechazarse');
  };

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jdev-img-'));
    permitida = join(tmp, 'permitida');
    fuera = join(tmp, 'fuera');
    mkdirSync(join(permitida, 'sub'), { recursive: true });
    mkdirSync(fuera);
    writeFileSync(join(permitida, 'a.png'), png(5, 4));
    writeFileSync(join(permitida, 'sub', 'b.JPG'), jpeg());
    writeFileSync(join(fuera, 'secreto.png'), png());
    // Prefijo común que no es subcarpeta: «permitida-otra» no está dentro de «permitida».
    mkdirSync(join(tmp, 'permitida-otra'));
    writeFileSync(join(tmp, 'permitida-otra', 'c.png'), png());
    symlinkSync(join(fuera, 'secreto.png'), join(permitida, 'enlace.png'));
    symlinkSync(fuera, join(permitida, 'carpeta-enlace'));
    symlinkSync(join(permitida, 'a.png'), join(fuera, 'hacia-dentro.png'));
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('abre una imagen permitida, absoluta o relativa, con tipo, tamaño y dimensiones', async () => {
    const a = await openImage({ path: join(permitida, 'a.png'), allowedDirs: [permitida] });
    expect(a).toMatchObject({ kind: 'png', contentType: 'image/png', size: png(5, 4).length, width: 5, height: 4 });
    await a.handle.close();
    const b = await openImage({ path: 'sub/b.JPG', cwd: permitida, allowedDirs: [permitida] });
    expect(b.kind).toBe('jpeg');
    await b.handle.close();
    const c = await openImage({ path: '../a.png', cwd: join(permitida, 'sub'), allowedDirs: [permitida] });
    expect(c.file).toBe(join(permitida, 'a.png'));
    await c.handle.close();
    // Un enlace que apunta a una carpeta permitida se acepta (la ruta real está dentro).
    const d = await openImage({ path: join(fuera, 'hacia-dentro.png'), allowedDirs: [permitida] });
    expect(d.file).toBe(join(permitida, 'a.png'));
    await d.handle.close();
  });

  it('rechaza rutas fuera, con .. y enlaces que salen', async () => {
    expect((await rechazo({ path: join(fuera, 'secreto.png'), allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: join(permitida, '..', 'fuera', 'secreto.png'), allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: '../fuera/secreto.png', cwd: permitida, allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: join(permitida, 'enlace.png'), allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: join(permitida, 'carpeta-enlace', 'secreto.png'), allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: join(tmp, 'permitida-otra', 'c.png'), allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: '/etc/passwd', allowedDirs: [permitida] })).status).toBe(403);
  });

  it('no revela si existe un archivo fuera de las carpetas permitidas', async () => {
    expect((await rechazo({ path: join(fuera, 'no-existe.png'), allowedDirs: [permitida] })).status).toBe(403);
    expect((await rechazo({ path: join(permitida, 'no-existe.png'), allowedDirs: [permitida] })).status).toBe(404);
  });

  it('valida la petición', async () => {
    expect((await rechazo({ path: '', allowedDirs: [permitida] })).status).toBe(400);
    expect((await rechazo({ path: 'a.png', allowedDirs: [permitida] })).status).toBe(400);
    expect((await rechazo({ path: 'a.png', cwd: null, allowedDirs: [permitida] })).status).toBe(400);
    expect((await rechazo({ path: `${permitida}/a.png\0.txt`, allowedDirs: [permitida] })).status).toBe(400);
    expect((await rechazo({ path: `/${'a'.repeat(5000)}.png`, allowedDirs: [permitida] })).status).toBe(400);
  });

  it('comprueba extensión, contenido y que sea un archivo', async () => {
    writeFileSync(join(permitida, 'texto.png'), 'esto no es una imagen');
    writeFileSync(join(permitida, 'vacio.png'), '');
    writeFileSync(join(permitida, 'notas.txt'), 'hola');
    writeFileSync(join(permitida, 'sin-extension'), png());
    writeFileSync(join(permitida, 'jpeg-como.png'), jpeg());
    writeFileSync(join(permitida, 'svg-como.png'), SVG);
    writeFileSync(join(permitida, 'png-como.svg'), png());
    mkdirSync(join(permitida, 'dir.png'));
    for (const nombre of ['texto.png', 'vacio.png', 'notas.txt', 'sin-extension', 'jpeg-como.png', 'svg-como.png', 'png-como.svg']) {
      expect((await rechazo({ path: join(permitida, nombre), allowedDirs: [permitida] })).status, nombre).toBe(415);
    }
    expect((await rechazo({ path: join(permitida, 'dir.png'), allowedDirs: [permitida] })).status).toBe(404);
  });

  it('aplica el límite de tamaño', async () => {
    writeFileSync(join(permitida, 'grande.png'), png(1, 1, 5000));
    const e = await rechazo({ path: join(permitida, 'grande.png'), allowedDirs: [permitida], maxBytes: 1000 });
    expect(e.status).toBe(413);
    expect(e.message).toMatch(/límite/);
    const ok = await openImage({ path: join(permitida, 'grande.png'), allowedDirs: [permitida], maxBytes: 6000 });
    await ok.handle.close();
  });

  it('un SVG se detecta como svg y no lleva dimensiones', async () => {
    writeFileSync(join(permitida, 'v.svg'), SVG);
    const s = await openImage({ path: join(permitida, 'v.svg'), allowedDirs: [permitida] });
    expect(s).toMatchObject({ kind: 'svg', contentType: 'image/svg+xml' });
    expect(s.width).toBeUndefined();
    await s.handle.close();
  });
});

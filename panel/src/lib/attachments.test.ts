import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, hasFiles, pastedImages, uploadMime, validateUpload } from './attachments.ts';

const archivo = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('validateUpload', () => {
  it('admite png, jpg, gif y webp', () => {
    expect(validateUpload(archivo('a.png', 'image/png'))).toEqual({ ok: true, type: 'image/png' });
    expect(validateUpload(archivo('a.jpg', 'image/jpeg'))).toEqual({ ok: true, type: 'image/jpeg' });
    expect(validateUpload(archivo('a.gif', 'image/gif'))).toEqual({ ok: true, type: 'image/gif' });
    expect(validateUpload(archivo('a.webp', 'image/webp'))).toEqual({ ok: true, type: 'image/webp' });
  });
  it('acepta exactamente 20 MB y rechaza un byte más', () => {
    expect(validateUpload(archivo('a.png', 'image/png', MAX_UPLOAD_BYTES)).ok).toBe(true);
    const r = validateUpload(archivo('grande.png', 'image/png', MAX_UPLOAD_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('«grande.png» pesa 20,0 MB. Adjunta png, jpg, gif o webp de hasta 20 MB.');
  });
  it('rechaza lo que no es una imagen admitida con el motivo del diseño', () => {
    const r = validateUpload(archivo('grabacion.mov', 'video/quicktime'));
    expect(r).toEqual({ ok: false, reason: '«grabacion.mov» no es una imagen. Adjunta png, jpg, gif o webp de hasta 20 MB.' });
    expect(validateUpload(archivo('icono.svg', 'image/svg+xml')).ok).toBe(false);
    expect(validateUpload(archivo('nota.txt', 'text/plain')).ok).toBe(false);
  });
  it('rechaza archivos vacíos', () => {
    const r = validateUpload(archivo('vacia.png', 'image/png', 0));
    expect(r).toEqual({ ok: false, reason: '«vacia.png» está vacío.' });
  });
  it('si el navegador no da tipo usa la extensión, pero no contradice un tipo declarado', () => {
    expect(uploadMime(archivo('a.JPEG', ''))).toBe('image/jpeg');
    expect(uploadMime(archivo('a.png', 'application/octet-stream'))).toBe('image/png');
    expect(uploadMime(archivo('a.png', 'video/mp4'))).toBeNull();
    expect(uploadMime(archivo('sin-extension', ''))).toBeNull();
    expect(uploadMime(archivo('a.png', 'image/png; charset=binary'))).toBe('image/png');
  });
});

describe('pegar', () => {
  const png = archivo('image.png', 'image/png');
  it('sube las imágenes cuando no hay texto', () => {
    expect(pastedImages([png], '')).toEqual([png]);
    expect(pastedImages([png], '  \n')).toEqual([png]);
  });
  it('con texto deja el pegado normal', () => {
    expect(pastedImages([png], 'hola')).toEqual([]);
  });
  it('ignora los archivos que no son imagen y sin archivos no hace nada', () => {
    expect(pastedImages([archivo('v.mov', 'video/quicktime')], '')).toEqual([]);
    expect(pastedImages([], '')).toEqual([]);
    expect(pastedImages([png, archivo('v.mov', 'video/quicktime')], '')).toEqual([png]);
  });
});

describe('hasFiles', () => {
  it('detecta arrastres de archivos y no de texto', () => {
    expect(hasFiles(['text/plain', 'Files'])).toBe(true);
    expect(hasFiles(['text/plain'])).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { uploadImages } from './uploadImages.ts';

const archivo = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('uploadImages', () => {
  it('sube las imágenes válidas en orden y devuelve sus rutas', async () => {
    const subir = vi.fn(async (_b: Blob, tipo: string) => ({ path: `/imgs/${tipo.replace('/', '.')}`, name: 'x', size: 10 }));
    const r = await uploadImages([archivo('a.png', 'image/png'), archivo('b.jpg', 'image/jpeg')], subir);
    expect(r.subidas.map((s) => s.path)).toEqual(['/imgs/image.png', '/imgs/image.jpeg']);
    expect(r.motivos).toEqual([]);
    expect(subir.mock.calls.map((c) => c[1])).toEqual(['image/png', 'image/jpeg']);
  });

  it('no sube lo que no es una imagen ni lo vacío y da el motivo, sin impedir las demás', async () => {
    const subir = vi.fn(async () => ({ path: '/imgs/ok.png', name: 'ok.png', size: 10 }));
    const r = await uploadImages([archivo('notas.txt', 'text/plain'), archivo('vacia.png', 'image/png', 0), archivo('ok.png', 'image/png')], subir);
    expect(subir).toHaveBeenCalledTimes(1);
    expect(r.subidas).toHaveLength(1);
    expect(r.motivos).toHaveLength(2);
    expect(r.motivos[0]).toContain('«notas.txt» no es una imagen');
    expect(r.motivos[1]).toContain('«vacia.png» está vacío');
  });

  it('un fallo al subir se cuenta con el nombre del archivo y el resto sigue', async () => {
    const subir = vi
      .fn<(b: Blob, t: string) => Promise<{ path: string; name: string; size: number }>>()
      .mockRejectedValueOnce(new Error('No hay espacio'))
      .mockResolvedValueOnce({ path: '/imgs/b.png', name: 'b.png', size: 10 });
    const r = await uploadImages([archivo('a.png', 'image/png'), archivo('b.png', 'image/png')], subir);
    expect(r.subidas.map((s) => s.path)).toEqual(['/imgs/b.png']);
    expect(r.motivos).toEqual(['«a.png»: No hay espacio']);
  });
});

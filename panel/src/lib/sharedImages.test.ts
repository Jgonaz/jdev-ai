import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../shared/follow.ts';
import { EMPTY_SHARED_IMAGES, MAX_SHARED_IMAGES, collectSharedImages, imageName } from './sharedImages.ts';

const user = (text: string): AgentEvent => ({ type: 'user', text, at: null });
const msg = (text: string): AgentEvent => ({ type: 'message', text, at: null });
const img = (path: string): AgentEvent => ({ type: 'image', path, at: null });

describe('collectSharedImages', () => {
  it('separa las de la persona (pegadas y rutas de sus mensajes) de las del agente (rutas de sus mensajes)', () => {
    const r = collectSharedImages(EMPTY_SHARED_IMAGES, [
      user('[Image #1] mira esto'),
      img('/tmp/claude/images/1.png'),
      user('y esta otra ~/Descargas/captura.jpg'),
      msg('Aquí la captura:\n— 📸 /tmp/scratch/panel.png  la barra lateral'),
      { type: 'tool', id: 't', tool: 'Read', verb: 'Lee', target: '/tmp/scratch/leida.png', at: null },
    ]);
    expect(r).toEqual({ mine: ['/tmp/claude/images/1.png', '~/Descargas/captura.jpg'], agent: ['/tmp/scratch/panel.png'] });
  });

  it('una ruta cuenta una vez, para quien la compartió primero, y no cuentan los nombres sueltos ni las rutas abreviadas', () => {
    const r = collectSharedImages(EMPTY_SHARED_IMAGES, [img('/tmp/a.png'), msg('Veo /tmp/a.png y logo.png; mira /tmp/b.png, no /tmp/…/images/N.png'), msg('otra vez /tmp/b.png')]);
    expect(r).toEqual({ mine: ['/tmp/a.png'], agent: ['/tmp/b.png'] });
  });

  it('acumula entre lecturas y devuelve lo mismo si no hay nada nuevo', () => {
    const a = collectSharedImages(EMPTY_SHARED_IMAGES, [img('/tmp/a.png')]);
    expect(collectSharedImages(a, [msg('sin imágenes')])).toBe(a);
    expect(collectSharedImages(a, [img('/tmp/c.png')]).mine).toEqual(['/tmp/a.png', '/tmp/c.png']);
  });

  it(`se queda con las ${MAX_SHARED_IMAGES} más recientes de cada apartado`, () => {
    const muchas = Array.from({ length: MAX_SHARED_IMAGES + 5 }, (_, i) => img(`/tmp/${i}.png`));
    const r = collectSharedImages(EMPTY_SHARED_IMAGES, muchas);
    expect(r.mine).toHaveLength(MAX_SHARED_IMAGES);
    expect(r.mine[0]).toBe('/tmp/5.png');
  });
});

describe('imageName', () => {
  it('devuelve el nombre del archivo', () => {
    expect(imageName('/tmp/x/captura 1.png')).toBe('captura 1.png');
    expect(imageName('a.png')).toBe('a.png');
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_STRIP, canonicalList, canonicalPath, inferCwd, neighbour, normalizePath, pushImage, pushImages, pushResolved, replaceResolved, splitPath, stripHas } from './imageStrip.ts';

describe('pushImage', () => {
  it('pone la imagen nueva la primera', () => {
    expect(pushImage(['/a.png'], '/b.png')).toEqual(['/b.png', '/a.png']);
  });
  it('no repite ni reordena: devuelve la misma lista', () => {
    const lista = ['/b.png', '/a.png'] as const;
    expect(pushImage(lista, '/a.png')).toBe(lista);
  });
  it('conserva solo las 20 más recientes', () => {
    let lista: readonly string[] = [];
    for (let i = 0; i < MAX_STRIP + 5; i++) lista = pushImage(lista, `/img-${i}.png`);
    expect(lista).toHaveLength(MAX_STRIP);
    expect(lista[0]).toBe(`/img-${MAX_STRIP + 4}.png`);
    expect(lista.at(-1)).toBe('/img-5.png');
  });
});

describe('pushImages', () => {
  it('añade de la más antigua a la más reciente, de modo que la última queda la primera', () => {
    expect(pushImages([], ['/1.png', '/2.png', '/3.png'])).toEqual(['/3.png', '/2.png', '/1.png']);
  });
  it('respeta lo que ya había y quita duplicados', () => {
    expect(pushImages(['/2.png', '/1.png'], ['/1.png', '/3.png', '/2.png'])).toEqual(['/3.png', '/2.png', '/1.png']);
  });
  it('aplica el máximo', () => {
    const muchas = Array.from({ length: 30 }, (_, i) => `/${i}.png`);
    expect(pushImages([], muchas)).toHaveLength(MAX_STRIP);
    expect(pushImages([], muchas)[0]).toBe('/29.png');
  });
});

describe('neighbour', () => {
  const lista = ['/c.png', '/b.png', '/a.png'];
  it('avanza y retrocede con vuelta', () => {
    expect(neighbour(lista, '/c.png', 1)).toBe('/b.png');
    expect(neighbour(lista, '/a.png', 1)).toBe('/c.png');
    expect(neighbour(lista, '/c.png', -1)).toBe('/a.png');
  });
  it('sin selección empieza por un extremo y con la lista vacía no hay vecina', () => {
    expect(neighbour(lista, null, 1)).toBe('/c.png');
    expect(neighbour(lista, '/otra.png', -1)).toBe('/a.png');
    expect(neighbour([], null, 1)).toBeNull();
  });
});

describe('splitPath', () => {
  it('separa nombre y carpeta', () => {
    expect(splitPath('/tmp/jdev-qa/fitnessia/02.png')).toEqual({ name: '02.png', dir: '/tmp/jdev-qa/fitnessia' });
    expect(splitPath('docs/img/logo.png')).toEqual({ name: 'logo.png', dir: 'docs/img' });
    expect(splitPath('logo.png')).toEqual({ name: 'logo.png', dir: '' });
    expect(splitPath('/logo.png')).toEqual({ name: 'logo.png', dir: '/' });
  });
});

describe('normalizePath y canonicalPath', () => {
  it('normaliza sin tocar el disco', () => {
    expect(normalizePath('/a//b/./c/../d.png')).toBe('/a/b/d.png');
    expect(normalizePath('./a/b.png')).toBe('a/b.png');
    expect(normalizePath('../a/../../b.png')).toBe('../../b.png');
    expect(normalizePath('/../a.png')).toBe('/a.png');
  });
  it('une la relativa al directorio de la terminal si se conoce', () => {
    expect(canonicalPath('./shots/a.png', '/p/demo')).toBe('/p/demo/shots/a.png');
    expect(canonicalPath('shots/a.png', null)).toBe('shots/a.png');
    expect(canonicalPath('/x//a.png', '/p/demo')).toBe('/x/a.png');
  });
});

describe('inferCwd', () => {
  it('deduce el directorio de la terminal de la ruta relativa y la real', () => {
    expect(inferCwd('./docs/img/logo.png', '/h/projects/demo/docs/img/logo.png')).toBe('/h/projects/demo');
    expect(inferCwd('logo.png', '/logo.png')).toBe('/');
  });
  it('no deduce nada si no encaja (enlace simbólico, «..», absoluta)', () => {
    expect(inferCwd('logo.png', '/otro/nombre.png')).toBeNull();
    expect(inferCwd('../logo.png', '/a/logo.png')).toBeNull();
    expect(inferCwd('/a/logo.png', '/a/logo.png')).toBeNull();
  });
});

describe('canonicalList y replaceResolved', () => {
  it('deduplica la misma imagen escrita de dos formas', () => {
    expect(canonicalList(['/p/a.png', './a.png', '/p//a.png'], '/p')).toEqual(['/p/a.png']);
    const l = ['/p/a.png', '/p/b.png'] as const;
    expect(canonicalList(l, '/p')).toBe(l);
  });
  it('sustituye la ruta por la real o descarta el duplicado', () => {
    expect(replaceResolved(['b.png', 'a.png'], 'a.png', '/p/a.png')).toEqual(['b.png', '/p/a.png']);
    expect(replaceResolved(['a.png', '/p/a.png'], 'a.png', '/p/a.png')).toEqual(['/p/a.png']);
    const l = ['/p/a.png'] as const;
    expect(replaceResolved(l, 'x.png', '/p/x.png')).toBe(l);
  });
});

describe('pushResolved', () => {
  it('no añade una relativa cuya forma absoluta ya está en la tira', () => {
    expect(pushResolved(['/p/a.png'], ['shots/x.png', 'a.png', './a.png'].map(normalizePath), '/p')).toEqual(['shots/x.png', '/p/a.png']);
  });
  it('sin directorio conocido se comporta como pushImages', () => {
    expect(pushResolved(['/p/a.png'], ['a.png', 'b.png'], null)).toEqual(['b.png', 'a.png', '/p/a.png']);
  });
  it('las absolutas se deduplican con su forma normalizada', () => {
    expect(pushResolved(['/p/a.png'], ['/p/a.png'], '/p')).toEqual(['/p/a.png']);
  });
});

describe('stripHas', () => {
  it('reconoce una ruta ya presente, también una relativa con el directorio de la terminal', () => {
    expect(stripHas(['/work/a.png'], '/work/a.png', null)).toBe(true);
    expect(stripHas(['/work/a.png'], 'a.png', '/work')).toBe(true);
    expect(stripHas(['shots/a.png'], '/work/shots/a.png', '/work')).toBe(true);
    expect(stripHas(['/work/a.png'], 'a.png', null)).toBe(false);
    expect(stripHas([], '/work/a.png', '/work')).toBe(false);
  });
});

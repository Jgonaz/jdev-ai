// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, decodeEntities, isLocalPath, linkKind } from './Markdown.tsx';

function render(source: string, imageHref?: (src: string) => string | null): HTMLElement {
  const html = renderToStaticMarkup(createElement(Markdown, { source, imageHref }));
  const div = document.createElement('div');
  // Solo para inspeccionar la salida en la prueba; el componente nunca usa innerHTML.
  div.innerHTML = html;
  return div;
}

describe('Markdown', () => {
  it('muestra el HTML incrustado como texto literal, en bloque y en línea', () => {
    const el = render('<script>alert(1)</script>\n\nHola <b onclick="x()">negrita</b> fin');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
    expect(el.textContent).toContain('<b onclick="x()">negrita</b>');
  });

  it('abre los enlaces externos en una pestaña nueva y no enlaza otros esquemas', () => {
    const el = render('[web](https://example.com) y [mal](javascript:alert(1)) y [rel](../todo/BL-1.md) y <https://auto.dev>');
    const enlaces = [...el.querySelectorAll('a')];
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'https://auto.dev']);
    for (const a of enlaces) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(el.textContent).toContain('mal');
    expect(el.querySelector('[href^="javascript"]')).toBeNull();
  });

  it('pinta las listas de tareas con casillas de solo lectura', () => {
    const el = render('- [x] hecho\n- [ ] pendiente\n- normal');
    const casillas = [...el.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(casillas).toHaveLength(2);
    expect(casillas[0]!.hasAttribute('checked')).toBe(true);
    expect(casillas[1]!.hasAttribute('checked')).toBe(false);
    expect(casillas.every((c) => c.hasAttribute('disabled'))).toBe(true);
    expect(el.querySelectorAll('li')).toHaveLength(3);
    expect(el.textContent).toContain('pendiente');
  });

  it('pinta títulos, código, citas, énfasis, tablas y saltos', () => {
    const el = render('## Contexto\n\nTexto con **negrita**, *cursiva*, ~~tachado~~ y `a<b>`.  \nOtra línea\n\n> cita\n\n```ts\nconst x = 1 < 2;\n```\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n1. uno\n2. dos');
    expect(el.querySelector('h4')?.textContent).toBe('Contexto');
    expect(el.querySelector('strong')?.textContent).toBe('negrita');
    expect(el.querySelector('em')?.textContent).toBe('cursiva');
    expect(el.querySelector('del')?.textContent).toBe('tachado');
    expect(el.querySelector('p code')?.textContent).toBe('a<b>');
    expect(el.querySelector('br')).not.toBeNull();
    expect(el.querySelector('blockquote')?.textContent).toContain('cita');
    expect(el.querySelector('pre code')?.textContent).toBe('const x = 1 < 2;');
    expect(el.querySelector('hr')).not.toBeNull();
    expect([...el.querySelectorAll('td')].map((t) => t.textContent)).toEqual(['1', '2']);
    expect(el.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('muestra las imágenes como texto, con enlace solo si es una ruta local que se puede abrir', () => {
    const el = render('![captura](img/a.png) ![remota](https://x.dev/b.png)', (src) => `/api/image?path=${encodeURIComponent(`/p/${src}`)}`);
    expect(el.querySelector('img')).toBeNull();
    const enlaces = [...el.querySelectorAll('a')];
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]!.getAttribute('href')).toBe('/api/image?path=%2Fp%2Fimg%2Fa.png');
    expect(el.textContent).toContain('captura');
    expect(el.textContent).toContain('https://x.dev/b.png');
  });

  it('respeta los escapes y decodifica las entidades habituales como texto', () => {
    const el = render('\\*no es cursiva\\* &amp; &lt;b&gt;');
    expect(el.querySelector('em')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('*no es cursiva* & <b>');
  });
});

describe('utilidades', () => {
  it('clasifica enlaces y rutas', () => {
    expect(linkKind('https://a.b')).toBe('external');
    expect(linkKind('mailto:a@b.c')).toBe('external');
    expect(linkKind('javascript:x')).toBe('other');
    expect(linkKind('../a.md')).toBe('other');
    expect(isLocalPath('img/a.png')).toBe(true);
    expect(isLocalPath('/tmp/a.png')).toBe(true);
    expect(isLocalPath('data:image/png;base64,x')).toBe(false);
    expect(isLocalPath('//cdn/x.png')).toBe(false);
  });

  it('decodifica entidades numéricas y deja las desconocidas', () => {
    expect(decodeEntities('&#65;&#x42;&foo;')).toBe('AB&foo;');
  });
});

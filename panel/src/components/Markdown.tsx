import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';

// Visor de Markdown seguro: marked solo analiza (lexer) y cada token se pinta
// como un elemento de React. El HTML incrustado se muestra como texto literal;
// nunca se usa dangerouslySetInnerHTML.

type Props = {
  source: string;
  /** URL con la que abrir una imagen local (ruta relativa o absoluta), o null si no se puede. */
  imageHref?: (src: string) => string | null;
  className?: string;
  /** Pinta un texto con sus coincidencias marcadas (búsqueda). Se llama con cada nodo de texto ya decodificado. */
  highlight?: (texto: string) => ReactNode;
};

type Ctx = { imageHref?: (src: string) => string | null; highlight?: (texto: string) => ReactNode };

// Un texto tal cual, o marcado si hay una búsqueda en curso.
const txt = (s: string, ctx: Ctx): ReactNode => (ctx.highlight ? ctx.highlight(s) : s);

// marked no decodifica entidades en el lexer; se decodifican las habituales para mostrarlas como texto.
const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (todo, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

/** Tipo de enlace: externo (http, https, mailto) o cualquier otro (no navegable desde el panel). */
export function linkKind(href: string): 'external' | 'other' {
  return /^(https?:\/\/|mailto:)/i.test(href.trim()) ? 'external' : 'other';
}

/** Ruta local de imagen (no URL con esquema ni protocolo relativo). */
export const isLocalPath = (href: string): boolean => href.trim() !== '' && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href.trim());

function inline(tokens: readonly Token[] | undefined, ctx: Ctx): ReactNode[] {
  return (tokens ?? []).map((t, i) => <Fragment key={i}>{inlineToken(t, ctx)}</Fragment>);
}

function inlineToken(t: Token, ctx: Ctx): ReactNode {
  switch (t.type) {
    case 'text': {
      const tt = t as Tokens.Text;
      return tt.tokens && tt.tokens.length > 0 ? inline(tt.tokens, ctx) : txt(decodeEntities(tt.text), ctx);
    }
    case 'escape':
      return txt(decodeEntities((t as Tokens.Escape).text), ctx);
    case 'strong':
      return <strong>{inline((t as Tokens.Strong).tokens, ctx)}</strong>;
    case 'em':
      return <em>{inline((t as Tokens.Em).tokens, ctx)}</em>;
    case 'del':
      return <del>{inline((t as Tokens.Del).tokens, ctx)}</del>;
    case 'codespan':
      return <code>{txt(decodeEntities((t as Tokens.Codespan).text), ctx)}</code>;
    case 'br':
      return <br />;
    case 'link': {
      const l = t as Tokens.Link;
      const contenido = inline(l.tokens, ctx);
      if (linkKind(l.href) === 'external') {
        return (
          <a href={l.href.trim()} target="_blank" rel="noopener noreferrer" title={l.title ?? undefined}>
            {contenido}
          </a>
        );
      }
      // Rutas relativas, anclas y esquemas no permitidos (javascript:…): texto con la ruta como pista.
      return (
        <span className="md__link-text" title={l.href}>
          {contenido}
        </span>
      );
    }
    case 'image': {
      const im = t as Tokens.Image;
      const url = isLocalPath(im.href) ? (ctx.imageHref?.(im.href.trim()) ?? null) : null;
      const etiqueta = im.text.trim() !== '' ? decodeEntities(im.text) : 'imagen';
      return (
        <span className="md__image">
          [{etiqueta}:{' '}
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              <code>{im.href}</code>
            </a>
          ) : (
            <code>{im.href}</code>
          )}
          ]
        </span>
      );
    }
    case 'html':
      // HTML incrustado: se enseña tal cual, como texto.
      return <span className="md__html">{txt((t as Tokens.HTML).text, ctx)}</span>;
    case 'checkbox':
      return null;
    default:
      return 'text' in t && typeof t.text === 'string' ? txt(t.text, ctx) : t.raw;
  }
}

function block(tokens: readonly Token[], ctx: Ctx): ReactNode[] {
  return tokens.map((t, i) => <Fragment key={i}>{blockToken(t, ctx)}</Fragment>);
}

function blockToken(t: Token, ctx: Ctx): ReactNode {
  switch (t.type) {
    case 'space':
    case 'def':
      return null;
    case 'heading': {
      const h = t as Tokens.Heading;
      const Tag = (['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const)[Math.min(6, Math.max(1, h.depth)) - 1]!;
      return <Tag className="md__h">{inline(h.tokens, ctx)}</Tag>;
    }
    case 'paragraph':
      return <p>{inline((t as Tokens.Paragraph).tokens, ctx)}</p>;
    case 'text': {
      const tt = t as Tokens.Text;
      return <p>{tt.tokens ? inline(tt.tokens, ctx) : txt(decodeEntities(tt.text), ctx)}</p>;
    }
    case 'code': {
      const c = t as Tokens.Code;
      return (
        <pre className="md__pre">
          <code>{txt(c.text, ctx)}</code>
        </pre>
      );
    }
    case 'blockquote':
      return <blockquote>{block((t as Tokens.Blockquote).tokens, ctx)}</blockquote>;
    case 'hr':
      return <hr />;
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map((it, i) => <li key={i} className={it.task ? 'md__task' : undefined}>{listItem(it, l.loose, ctx)}</li>);
      return l.ordered ? <ol start={typeof l.start === 'number' && l.start !== 1 ? l.start : undefined}>{items}</ol> : <ul className="md__ul">{items}</ul>;
    }
    case 'table': {
      const tb = t as Tokens.Table;
      const alinear = (a: Tokens.TableCell['align']) => (a ? { textAlign: a } : undefined);
      return (
        <div className="md__table-wrap">
          <table className="md__table">
            <thead>
              <tr>
                {tb.header.map((c, i) => (
                  <th key={i} style={alinear(c.align)}>
                    {inline(c.tokens, ctx)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((fila, i) => (
                <tr key={i}>
                  {fila.map((c, j) => (
                    <td key={j} style={alinear(c.align)}>
                      {inline(c.tokens, ctx)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'html':
      return <pre className="md__pre md__html">{txt((t as Tokens.HTML).text, ctx)}</pre>;
    default:
      return <p>{inlineToken(t, ctx)}</p>;
  }
}

function listItem(it: Tokens.ListItem, loose: boolean, ctx: Ctx): ReactNode {
  const contenido = it.tokens.filter((t) => t.type !== 'checkbox');
  // En listas compactas el texto va sin <p>; en las sueltas, como bloques.
  const cuerpo = loose
    ? block(contenido, ctx)
    : contenido.map((t, i) => <Fragment key={i}>{t.type === 'text' ? inlineToken(t, ctx) : blockToken(t, ctx)}</Fragment>);
  if (!it.task) return cuerpo;
  return (
    <>
      <input type="checkbox" checked={it.checked === true} disabled readOnly aria-label={it.checked ? 'Hecho' : 'Pendiente'} />{' '}
      {cuerpo}
    </>
  );
}

/** Tokens de un texto Markdown (GFM). */
export const lex = (source: string): Token[] => marked.lexer(source, { gfm: true });

export function Markdown({ source, imageHref, className, highlight }: Props) {
  const tokens = useMemo(() => lex(source), [source]);
  return <div className={className ? `md ${className}` : 'md'}>{block(tokens, { imageHref, highlight })}</div>;
}

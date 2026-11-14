// Cambio de idioma sin recargar, como en jgonaz.dev: descarga la otra versión de la landing (`/` o `/en/`), recorre
// las dos páginas a la vez y cambia cada texto con una transición letra a letra (efecto «Mezcla»; fundido en los
// textos largos). Las dos versiones salen del mismo componente, así que su estructura coincide nodo a nodo.
//
// Los bloques que pintan scripts (panel simulado y mapa de actividad) llevan `data-i18n-swap`: se funden, se
// sustituyen enteros y sus scripts se vuelven a montar (`islands.ts`). Si algo no cuadra o falla la descarga, se
// navega a la otra página como siempre.

import { mountAll, unmountAll } from './islands';

const VARIANTS = ['rise', 'fall', 'flip', 'blur', 'spin'] as const;
// Reparto aleatorio de retrasos entre letras («A destiempo» del prototipo)
const SPREAD_MS = 220;
const LETTERS_OUT_MS = SPREAD_MS + 260;
const LETTERS_IN_MS = SPREAD_MS + 380;
const FADE_MS = 220;
const SWAP_OUT_MS = 240;
const SWAP_IN_MS = 320;
// Más letras que esto serían demasiados nodos animados a la vez: se funde
const MAX_LETTERS = 120;
// Solo se anima lo que está en pantalla (con este margen); el resto cambia al instante
const VIEWPORT_MARGIN_PX = 100;
// Partes de la página que se recorren. El resto del <body> puede variar (la barra de Astro en desarrollo).
const ROOTS = ['header.masthead', 'main', 'footer.footer'];
const HEAD = ['title', 'meta[name="description"]', 'link[rel="canonical"]', 'meta[property^="og:"]'];

const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// Hash determinista del prototipo: misma variante y retraso por letra en cada cambio
function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function seedOf(text: string) {
  let seed = 7;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) | 0;
  return seed;
}

function onScreen(el: Element | null) {
  if (!el) return false;
  const { top, bottom, width, height } = el.getBoundingClientRect();
  // Un elemento oculto mide 0×0 aunque su posición caiga dentro
  if (width === 0 && height === 0) return false;
  return bottom > -VIEWPORT_MARGIN_PX && top < window.innerHeight + VIEWPORT_MARGIN_PX;
}

// ---------------------------------------------------------------------- Textos

/** Pinta `text` letra a letra en `host` con la fase indicada; las líneas solo se parten entre palabras. */
function paintLetters(host: HTMLElement, text: string, phase: 'out' | 'in', seed: number) {
  host.replaceChildren();
  let index = 0;
  text.split(' ').forEach((word, w) => {
    if (w > 0) host.append(' ');
    const wordEl = document.createElement('span');
    wordEl.className = 'at-word';
    for (const char of word) {
      const i = index++;
      const variant = VARIANTS[Math.min(Math.floor(hash(seed + 97, i) * VARIANTS.length), VARIANTS.length - 1)];
      const letter = document.createElement('span');
      letter.className = `at-letter at-${phase}-${variant}`;
      letter.style.animationDelay = `${Math.round(hash(seed, i) * SPREAD_MS)}ms`;
      letter.textContent = char;
      wordEl.append(letter);
    }
    host.append(wordEl);
  });
}

/**
 * Cambia el texto de `node` por `next`. En reposo el nodo es texto plano; mientras dura la transición se sustituye
 * por un envoltorio con el texto nuevo completo para los lectores de pantalla y la parte animada oculta para ellos.
 */
async function animateText(node: Text, next: string) {
  const prev = node.data;
  const parent = node.parentElement;
  if (calm.matches || !prev.trim() || parent?.closest('svg') || !onScreen(parent)) {
    node.data = next;
    return;
  }
  const letters = Math.max(prev.length, next.length) <= MAX_LETTERS && !/\n/.test(prev + next);
  const wrap = document.createElement('span');
  const sr = document.createElement('span');
  sr.className = 'at-sr';
  sr.textContent = next;
  const shown = document.createElement('span');
  shown.setAttribute('aria-hidden', 'true');
  wrap.append(sr, shown);
  node.replaceWith(wrap);

  if (letters) {
    const seed = seedOf(next);
    paintLetters(shown, prev, 'out', seed);
    await wait(LETTERS_OUT_MS);
    paintLetters(shown, next, 'in', seed);
    await wait(LETTERS_IN_MS);
  } else {
    shown.className = 'at-fade-out';
    shown.textContent = prev;
    await wait(FADE_MS);
    shown.className = 'at-fade-in';
    shown.textContent = next;
    await wait(FADE_MS);
  }
  node.data = next;
  wrap.replaceWith(node);
}

// ---------------------------------------------------------------------- Bloques que se sustituyen enteros

/** Funde `el`, lo sustituye por `next` (o solo su contenido si `children`) y lo vuelve a mostrar. */
async function swap(el: Element, next: Element, children: boolean) {
  const fresh = document.importNode(next, true);
  // Los <script> que Astro deja dentro ya se ejecutaron con la página
  for (const script of fresh.querySelectorAll('script')) script.remove();
  const animate = !calm.matches && onScreen(el);
  if (animate) await el.animate({ opacity: [1, 0] }, { duration: SWAP_OUT_MS, easing: 'ease-in', fill: 'forwards' }).finished;
  let shown: Element = el;
  if (children) {
    el.replaceChildren(...fresh.childNodes);
    el.getAnimations().forEach((a) => a.cancel());
  } else {
    el.replaceWith(fresh);
    shown = fresh;
  }
  if (animate) shown.animate({ opacity: [0, 1] }, { duration: SWAP_IN_MS, easing: 'ease-out' });
}

// ---------------------------------------------------------------------- Recorrido

type Plan = { texts: [Text, string][]; swaps: [Element, Element, boolean][] };

const skip = (node: Node) =>
  node.nodeType === Node.COMMENT_NODE ||
  (node instanceof Element && (node.localName === 'script' || node.localName === 'noscript'));

function syncAttributes(el: Element, next: Element) {
  for (const { name } of [...el.attributes]) if (!next.hasAttribute(name)) el.removeAttribute(name);
  for (const { name, value } of [...next.attributes]) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Compara `el` (en la página) con `next` (de la otra versión) y anota qué hay que cambiar. */
function walk(el: Element, next: Element, plan: Plan) {
  if (el.hasAttribute('data-i18n-swap')) {
    plan.swaps.push([el, next, false]);
    return;
  }
  syncAttributes(el, next);
  const a = [...el.childNodes].filter((n) => !skip(n));
  const b = [...next.childNodes].filter((n) => !skip(n));
  const same =
    a.length === b.length &&
    a.every((n, i) => n.nodeType === b[i].nodeType && (!(n instanceof Element) || n.localName === (b[i] as Element).localName));
  // Estructura distinta (un texto con <code> en otra posición, por ejemplo): se sustituye el contenido entero
  if (!same) {
    plan.swaps.push([el, next, true]);
    return;
  }
  a.forEach((n, i) => {
    const m = b[i];
    if (n instanceof Text) {
      if (n.data !== (m as Text).data) plan.texts.push([n, (m as Text).data]);
    } else if (n instanceof Element) walk(n, m as Element, plan);
  });
}

// ---------------------------------------------------------------------- Cambio

const cache = new Map<string, Promise<Document>>();

function load(path: string) {
  let doc = cache.get(path);
  if (!doc) {
    doc = fetch(path, { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((html) => new DOMParser().parseFromString(html, 'text/html'));
    // Un fallo no se queda en caché: el siguiente intento vuelve a descargar
    doc.catch(() => cache.delete(path));
    cache.set(path, doc);
  }
  return doc;
}

async function apply(path: string) {
  const doc = await load(path);
  const pairs = ROOTS.map((sel) => [document.querySelector(sel), doc.querySelector(sel)] as const);
  if (pairs.some(([a, b]) => !a || !b)) throw new Error('Estructura distinta');

  const plan: Plan = { texts: [], swaps: [] };
  unmountAll();
  for (const [a, b] of pairs) walk(a!, b!, plan);

  document.documentElement.lang = doc.documentElement.lang;
  document.title = doc.title;
  for (const sel of HEAD) {
    const now = document.head.querySelectorAll(sel);
    const next = doc.head.querySelectorAll(sel);
    now.forEach((el, i) => next[i] && syncAttributes(el, next[i]));
  }
  history.replaceState(history.state, '', path + location.search + location.hash);

  const swaps = Promise.all(plan.swaps.map(([el, next, children]) => swap(el, next, children)));
  const texts = Promise.all(plan.texts.map(([node, next]) => animateText(node, next)));
  // Los scripts vuelven en cuanto sus bloques están en su sitio, sin esperar a las letras
  await swaps.finally(mountAll);
  await texts;
}

// Gana el último idioma elegido: los clics durante una transición se aplican al terminar
let wanted = location.pathname;
let busy = false;

async function switchTo(path: string) {
  wanted = path;
  if (busy) return;
  busy = true;
  try {
    while (wanted !== location.pathname) await apply(wanted);
  } catch {
    location.assign(wanted);
  } finally {
    busy = false;
  }
}

// Versiones de la landing, sacadas de sus <link rel="alternate">: cualquier otro enlace navega con normalidad
const versions = new Set(
  [...document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')].map((l) => new URL(l.href).pathname),
);

/** Enlace a la otra versión de la landing (selector ES/EN o enlace del pie). */
function langLink(target: EventTarget | null) {
  const link = (target as Element | null)?.closest?.('a[hreflang]');
  if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return null;
  const url = new URL(link.href);
  return url.origin === location.origin && versions.has(url.pathname) ? { link, path: url.pathname } : null;
}

document.addEventListener('click', (event) => {
  // Clics con modificadores (nueva pestaña, etc.) siguen el enlace nativo
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const hit = langLink(event.target);
  if (!hit) return;
  event.preventDefault();
  if (hit.path === wanted) return;
  // El subrayado del selector se desliza ya, sin esperar a la descarga
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.lang a')) {
    if (new URL(a.href).pathname === hit.path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  switchTo(hit.path);
});

// Precarga al pasar el puntero o enfocar el enlace: al pulsar, la otra versión ya suele estar descargada
const preload = (event: Event) => {
  const hit = langLink(event.target);
  if (hit && hit.path !== location.pathname) load(hit.path).catch(() => {});
};
document.addEventListener('pointerover', preload);
document.addEventListener('focusin', preload);

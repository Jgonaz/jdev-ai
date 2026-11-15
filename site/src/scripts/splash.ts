// Intro de la landing: la pantalla de arranque del panel de escritorio (panel/desktop/ui/index.html).
// Solo actúa si el script en línea del <head> ha marcado <html class="intro">. Dura poco, se salta con un clic o
// una tecla y no vuelve a salir en la misma sesión del navegador.

const root = document.documentElement;
const splash = document.querySelector<HTMLElement>('.splash');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Con movimiento reducido no hay barra que ver avanzar: basta con un vistazo.
const SHOW_MS = calm ? 600 : 1400;
const FADE_MS = calm ? 0 : 450;

if (splash && root.classList.contains('intro')) {
  try {
    sessionStorage.setItem('jdev-intro', '1');
  } catch {}
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    root.classList.add('intro--out');
    window.setTimeout(() => root.classList.remove('intro', 'intro--out'), FADE_MS);
    window.removeEventListener('keydown', close);
    splash.removeEventListener('pointerdown', close);
  };
  const timer = window.setTimeout(close, SHOW_MS);
  window.addEventListener('keydown', close);
  splash.addEventListener('pointerdown', close);
}

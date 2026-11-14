// Registro de los bloques interactivos de la landing (panel simulado, su marco y el mapa de actividad). Cada uno se
// arranca con una señal de cancelación: al cambiar de idioma sin recargar se desmontan (fuera listeners globales,
// observers y bucles), se sustituye su HTML por el del otro idioma y se vuelven a montar sobre el nuevo.

type Init = (el: HTMLElement, signal: AbortSignal) => void;

const inits = new Map<string, Init>();
const live = new Map<HTMLElement, AbortController>();

function mountIn(root: ParentNode, selector: string, init: Init) {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (live.has(el)) continue;
    const controller = new AbortController();
    live.set(el, controller);
    init(el, controller.signal);
  }
}

/** Registra un bloque y lo monta en todos los elementos que ya hay en la página. */
export function register(selector: string, init: Init) {
  inits.set(selector, init);
  mountIn(document, selector, init);
}

/** Monta los bloques registrados que aún no estén en marcha. */
export function mountAll() {
  for (const [selector, init] of inits) mountIn(document, selector, init);
}

/** Desmonta todos los bloques en marcha. */
export function unmountAll() {
  for (const controller of live.values()) controller.abort();
  live.clear();
}

import type { Terminal } from '@xterm/xterm';
import { expandHome, scanBufferImagePaths, scanImagePathsInRows } from '../../lib/imageLinks.ts';
import { INITIAL_QUIET_MS, MAX_NEW_PER_SCAN, NewImageDetector, SCAN_DEBOUNCE_MS, scanRange } from '../../lib/newImages.ts';
import type { ImageMeta } from '../../lib/imageZoom.ts';

/** Mientras la persona teclea, la línea del cursor es suya (eco de lo que escribe o pega), no del agente. */
const INPUT_QUIET_MS = 1500;
/** Tras girar la rueda, tmux repinta historial antiguo: no es contenido nuevo. */
const WHEEL_QUIET_MS = 2000;

type Options = {
  /** Ajuste «Abrir el visor al aparecer una imagen nueva». */
  isEnabled: () => boolean;
  /** La terminal está a la vista (no hay otra pantalla ni un diálogo encima). */
  isShown: () => boolean;
  getHome: () => string | null;
  /** ¿Está ya la imagen en la tira de esta terminal? */
  isKnown: (path: string) => boolean;
  /** HEAD al servidor; rechaza si no es una imagen permitida. */
  probe: (path: string) => Promise<ImageMeta>;
  /** Imágenes nuevas y comprobadas, de la más antigua a la más reciente. */
  onFound: (paths: string[]) => void;
  now?: () => number;
};

export type AutoOpener = {
  /** La conexión se ha (re)abierto: el contenido que llega es antiguo y se ignora. */
  connected: () => void;
  /** El ajuste se ha activado con la terminal ya en marcha: lo que hay en pantalla es antiguo. */
  rebase: () => void;
  /** La persona ha escrito (o pegado) algo. */
  noteInput: () => void;
  /** La persona ha girado la rueda sobre la terminal. */
  noteWheel: () => void;
  dispose: () => void;
};

/**
 * Detecta rutas de imagen nuevas en lo que escribe una terminal para abrir el
 * visor solo. Revisa tras una pausa de escritura (debounce) las filas que han
 * cambiado, no el historial entero; ignora el contenido inicial, lo que
 * reimprimen los redibujados y lo que ya está en la tira.
 */
export function createAutoOpener(term: Terminal, opciones: Options): AutoOpener {
  const { isEnabled, isShown, getHome, isKnown, probe, onFound, now = Date.now } = opciones;
  const detector = new NewImageDetector();
  let quiet = true;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lineas = 0;
  let ultimaEntrada = 0;
  let ultimaRueda = 0;
  let activo = true;

  const absolutas = (rutas: string[]) => rutas.map((p) => expandHome(p, getHome()));

  const baseline = () => {
    detector.baseline(absolutas([...scanBufferImagePaths(term.buffer.normal, term.cols), ...scanBufferImagePaths(term.buffer.active, term.cols)]));
    lineas = 0;
  };

  const comprobar = async (candidatas: string[]) => {
    const validas: string[] = [];
    for (const ruta of candidatas) {
      try {
        const meta = await probe(ruta);
        if (!activo) return;
        if (!meta.path || detector.claimResolved(ruta, meta.path, now(), isKnown)) validas.push(ruta);
      } catch {
        // No es una imagen permitida (o no existe): no se abre nada. La ruta queda como vista.
      }
    }
    if (activo && validas.length > 0) onFound(validas);
  };

  const revisar = () => {
    debounce = null;
    if (quiet || !isEnabled()) {
      lineas = 0;
      return;
    }
    const buf = term.buffer.active;
    const { from, to } = scanRange(buf.length, term.rows, lineas);
    lineas = 0;
    const t = now();
    const tecleando = t - ultimaEntrada < INPUT_QUIET_MS;
    const rutas = absolutas(scanImagePathsInRows(buf, from, to, term.cols, tecleando ? buf.baseY + buf.cursorY : undefined));
    const nuevas = detector.detect(rutas, t, isKnown);
    // Lo que aparece al girar la rueda queda registrado como visto, pero no se anuncia.
    if (nuevas.length === 0 || t - ultimaRueda < WHEEL_QUIET_MS || !isShown()) return;
    void comprobar(nuevas.slice(-MAX_NEW_PER_SCAN));
  };

  const programar = () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(revisar, SCAN_DEBOUNCE_MS);
  };

  const dWrite = term.onWriteParsed(() => {
    if (quiet || !isEnabled()) return;
    programar();
  });
  const dLine = term.onLineFeed(() => {
    lineas++;
  });

  return {
    connected() {
      quiet = true;
      if (quietTimer !== null) clearTimeout(quietTimer);
      if (debounce !== null) clearTimeout(debounce);
      debounce = null;
      quietTimer = setTimeout(() => {
        quietTimer = null;
        quiet = false;
        baseline();
      }, INITIAL_QUIET_MS);
    },
    rebase() {
      if (!quiet) baseline();
    },
    noteInput() {
      ultimaEntrada = now();
    },
    noteWheel() {
      ultimaRueda = now();
    },
    dispose() {
      activo = false;
      if (quietTimer !== null) clearTimeout(quietTimer);
      if (debounce !== null) clearTimeout(debounce);
      dWrite.dispose();
      dLine.dispose();
    },
  };
}

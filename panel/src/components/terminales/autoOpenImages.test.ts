import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import type { BufferLike } from '../../lib/imageLinks.ts';
import type { ImageMeta } from '../../lib/imageZoom.ts';
import { INITIAL_QUIET_MS, SCAN_DEBOUNCE_MS } from '../../lib/newImages.ts';
import { createAutoOpener } from './autoOpenImages.ts';

const COLS = 80;
const ROWS = 10;

// Terminal falsa: un búfer de filas de texto y los dos eventos que usa el detector.
function fakeTerm() {
  const filas: string[] = [];
  const escritura = new Set<() => void>();
  const salto = new Set<() => void>();
  const buffer: BufferLike & { baseY: number; cursorY: number } = {
    get length() {
      return filas.length;
    },
    baseY: 0,
    cursorY: 0,
    getLine: (y) => {
      const f = filas[y];
      if (f === undefined) return undefined;
      const celdas = [...f.padEnd(COLS)];
      return { isWrapped: false, length: COLS, getCell: (x) => (celdas[x] ? { getChars: () => celdas[x]!, getWidth: () => 1 } : undefined) };
    },
  };
  const term = {
    cols: COLS,
    rows: ROWS,
    buffer: { normal: buffer, active: buffer },
    onWriteParsed: (cb: () => void) => (escritura.add(cb), { dispose: () => escritura.delete(cb) }),
    onLineFeed: (cb: () => void) => (salto.add(cb), { dispose: () => salto.delete(cb) }),
  };
  return {
    term: term as unknown as Terminal,
    /** Escribe líneas nuevas al final, como haría el agente. */
    escribir(...lineas: string[]) {
      for (const l of lineas) {
        filas.push(l);
        buffer.cursorY = filas.length - 1;
        salto.forEach((cb) => cb());
      }
      escritura.forEach((cb) => cb());
    },
  };
}

const meta = (path: string | null = null): ImageMeta => ({ size: 10, width: 1, height: 1, path });

describe('createAutoOpener', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function montar(opciones: { enabled?: boolean; known?: Set<string>; probe?: (p: string) => Promise<ImageMeta> } = {}) {
    const f = fakeTerm();
    const encontradas: string[][] = [];
    const estado = { enabled: opciones.enabled ?? true, shown: true };
    const probe = vi.fn(opciones.probe ?? ((p: string) => Promise.resolve(meta(p))));
    const abridor = createAutoOpener(f.term, {
      isEnabled: () => estado.enabled,
      isShown: () => estado.shown,
      getHome: () => '/home/u',
      isKnown: (p) => opciones.known?.has(p) ?? false,
      probe,
      onFound: (rutas) => encontradas.push(rutas),
      now: () => Date.now(),
    });
    return { ...f, abridor, encontradas, estado, probe };
  }
  const pasar = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('ignora el búfer inicial y abre una ruta nueva escrita después', async () => {
    const t = montar();
    t.escribir('/tmp/vieja.png');
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    expect(t.encontradas).toEqual([]);
    t.escribir('Captura: /tmp/nueva.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([['/tmp/nueva.png']]);
    expect(t.probe).toHaveBeenCalledTimes(1);
  });

  it('no abre nada mientras llega el repintado inicial', async () => {
    const t = montar();
    t.abridor.connected();
    t.escribir('/tmp/repintada.png');
    await pasar(INITIAL_QUIET_MS - 100);
    expect(t.probe).not.toHaveBeenCalled();
    await pasar(500);
    // Al terminar la espera, lo que había queda como contenido antiguo.
    t.escribir('texto');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
  });

  it('un redibujado que reimprime la misma ruta no vuelve a abrir el visor', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.escribir('/tmp/nueva.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    t.escribir('/tmp/nueva.png', 'otra línea');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toHaveLength(1);
    expect(t.probe).toHaveBeenCalledTimes(1);
  });

  it('con el ajuste desactivado no comprueba ni abre nada', async () => {
    const t = montar({ enabled: false });
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.escribir('/tmp/nueva.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.probe).not.toHaveBeenCalled();
    expect(t.encontradas).toEqual([]);
  });

  it('al activar el ajuste lo que ya hay en pantalla se toma como antiguo', async () => {
    const t = montar({ enabled: false });
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.escribir('/tmp/previa.png');
    t.estado.enabled = true;
    t.abridor.rebase();
    t.escribir('texto');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
    t.escribir('/tmp/despues.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([['/tmp/despues.png']]);
  });

  it('no abre lo que ya está en la tira ni lo que el servidor rechaza', async () => {
    const t = montar({
      known: new Set(['/tmp/en-tira.png']),
      probe: (p) => (p.includes('prohibida') ? Promise.reject(new Error('403')) : Promise.resolve(meta(p))),
    });
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.escribir('/tmp/en-tira.png', '/etc/prohibida.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
    expect(t.probe).toHaveBeenCalledTimes(1);
    // La rechazada no se vuelve a comprobar en cada redibujado.
    t.escribir('/etc/prohibida.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.probe).toHaveBeenCalledTimes(1);
  });

  it('con varias rutas nuevas entrega todas en orden (la última es la que se abre)', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.escribir('Imágenes para revisar:', '▸ /tmp/a.png  Primera', '▸ /tmp/b.png  Segunda');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([['/tmp/a.png', '/tmp/b.png']]);
  });

  it('descarta la ruta que la persona está escribiendo en la línea del cursor', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.abridor.noteInput();
    t.escribir('> mira /tmp/escrita.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
  });

  it('lo que aparece al girar la rueda (historial de tmux) no se anuncia', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.abridor.noteWheel();
    t.escribir('/tmp/historial.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
  });

  it('con la terminal tapada (diálogo u otra pantalla) no abre el visor', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.estado.shown = false;
    t.escribir('/tmp/oculta.png');
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
  });

  it('tras reconectar vuelve a ignorar el contenido inicial', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.abridor.connected();
    t.escribir('/tmp/repintada.png');
    await pasar(INITIAL_QUIET_MS + SCAN_DEBOUNCE_MS + 10);
    expect(t.encontradas).toEqual([]);
  });

  it('dispose cancela las revisiones pendientes', async () => {
    const t = montar();
    t.abridor.connected();
    await pasar(INITIAL_QUIET_MS + 10);
    t.escribir('/tmp/nueva.png');
    t.abridor.dispose();
    await pasar(SCAN_DEBOUNCE_MS + 10);
    expect(t.probe).not.toHaveBeenCalled();
  });
});

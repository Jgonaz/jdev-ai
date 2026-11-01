import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { wsUrl } from '../../api.ts';
import { CURSOR_STYLES, readXtermTheme } from '../../lib/xtermTheme.ts';
import { terminalMayTakeFocus } from '../../lib/focus.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { useSettings } from '../../state/SettingsContext.tsx';

type Conexion = 'conectando' | 'abierta' | 'reconectando' | 'cerrada' | 'inexistente';

const CODIGO_NO_ENCONTRADA = 4404;
const BACKOFF_MIN = 500;
const BACKOFF_MAX = 8000;

type Props = {
  name: string;
  /** Esta terminal es la activa: recibe el foco del teclado. */
  active: boolean;
  /** El diálogo u otra capa está encima: no se roba el foco. */
  suspended: boolean;
  onFocus: () => void;
};

/** Una terminal xterm.js conectada por WebSocket a una sesión de tmux del servidor. */
export function TerminalBody({ name, active, suspended, onFocus }: Props) {
  const { settings, appearanceKey } = useSettings();
  const { focusTick, takeFocusRequest } = useWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const reconectar = useRef<() => void>(() => undefined);
  const ajustes = useRef(settings);
  ajustes.current = settings;
  const alFoco = useRef(onFocus);
  alFoco.current = onFocus;
  const [conexion, setConexion] = useState<Conexion>('conectando');

  useEffect(() => {
    const contenedor = host.current;
    if (!contenedor) return;
    const s = ajustes.current;
    const t = new Terminal({
      fontFamily: s.fonts.terminal,
      fontSize: s.sizes.terminal,
      cursorStyle: CURSOR_STYLES[s.terminal.cursor],
      cursorBlink: true,
      scrollback: s.terminal.scrollback,
      theme: readXtermTheme(),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    t.open(contenedor);
    term.current = t;
    fit.current = f;

    const ajustar = () => {
      // Con la pantalla oculta (Ajustes) el contenedor mide 0: no hay nada que ajustar.
      if (contenedor.clientWidth === 0 || contenedor.clientHeight === 0) return;
      try {
        f.fit();
      } catch {
        // xterm aún no ha medido la fuente; el siguiente ResizeObserver lo reintenta.
      }
    };
    ajustar();

    const codificador = new TextEncoder();
    let ws: WebSocket | null = null;
    let detenido = false;
    let intento = 0;
    let temporizador: number | null = null;
    let habiaConectado = false;

    const conectar = () => {
      if (detenido) return;
      ajustar();
      const url = wsUrl(`/ws/term/${encodeURIComponent(name)}?cols=${t.cols}&rows=${t.rows}`);
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      ws = socket;
      socket.onopen = () => {
        intento = 0;
        // Al reconectar, tmux repinta la pantalla: se parte de una terminal limpia.
        if (habiaConectado) t.reset();
        habiaConectado = true;
        setConexion('abierta');
        socket.send(JSON.stringify({ type: 'resize', cols: t.cols, rows: t.rows }));
      };
      socket.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
        t.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
      };
      socket.onclose = (ev) => {
        if (detenido || ws !== socket) return;
        if (ev.code === CODIGO_NO_ENCONTRADA) {
          setConexion('inexistente');
        } else if (ev.code === 1000) {
          setConexion('cerrada');
        } else {
          setConexion('reconectando');
          const espera = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** intento++);
          temporizador = window.setTimeout(conectar, espera);
        }
      };
      socket.onerror = () => socket.close();
    };
    reconectar.current = () => {
      if (temporizador !== null) window.clearTimeout(temporizador);
      intento = 0;
      setConexion('conectando');
      conectar();
    };
    conectar();

    // La entrada va siempre en binario: el servidor reserva los mensajes de texto
    // que empiezan por «{» para el control (resize).
    const dData = t.onData((d) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(codificador.encode(d));
    });
    const dBinary = t.onBinary((d) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0)));
    });
    const dResize = t.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    let cuadro = 0;
    const observador = new ResizeObserver(() => {
      window.cancelAnimationFrame(cuadro);
      cuadro = window.requestAnimationFrame(ajustar);
    });
    observador.observe(contenedor);

    // Copiar al seleccionar: al soltar el ratón, para no copiar a medio arrastrar.
    const alSoltar = () => {
      if (ajustes.current.terminal.copyOnSelect && t.hasSelection()) {
        navigator.clipboard?.writeText(t.getSelection()).catch(() => undefined);
      }
    };
    contenedor.addEventListener('mouseup', alSoltar);
    const alEnfocar = () => alFoco.current();
    contenedor.addEventListener('focusin', alEnfocar);

    // Las fuentes web llegan después del primer ajuste: se remide al cargarlas.
    void document.fonts?.ready.then(() => {
      if (detenido) return;
      t.options.fontFamily = ajustes.current.fonts.terminal;
      ajustar();
    });

    return () => {
      detenido = true;
      if (temporizador !== null) window.clearTimeout(temporizador);
      window.cancelAnimationFrame(cuadro);
      observador.disconnect();
      contenedor.removeEventListener('mouseup', alSoltar);
      contenedor.removeEventListener('focusin', alEnfocar);
      dData.dispose();
      dBinary.dispose();
      dResize.dispose();
      ws?.close();
      t.dispose();
      term.current = null;
      fit.current = null;
    };
  }, [name]);

  // Cambios de ajustes y de tema se aplican sin recrear la terminal.
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = settings.fonts.terminal;
    t.options.fontSize = settings.sizes.terminal;
    t.options.cursorStyle = CURSOR_STYLES[settings.terminal.cursor];
    t.options.scrollback = settings.terminal.scrollback;
    t.options.theme = readXtermTheme();
    const h = host.current;
    if (h && h.clientWidth > 0) {
      try {
        fit.current?.fit();
      } catch {
        // Se reajustará con el siguiente cambio de tamaño.
      }
    }
  }, [appearanceKey, settings.fonts.terminal, settings.sizes.terminal, settings.terminal.cursor, settings.terminal.scrollback]);

  // Toma el foco si alguien lo pidió (clic en la pestaña, sesión nueva…) o si el foco no
  // está en otro control: así las flechas en las pestañas y el cierre de un diálogo
  // no se lo quitan a quien lo tenía.
  useEffect(() => {
    if (!active || suspended || conexion !== 'abierta') return;
    if (takeFocusRequest() || terminalMayTakeFocus(document.activeElement)) term.current?.focus();
  }, [active, suspended, conexion, focusTick, takeFocusRequest]);

  return (
    <div className="termbody">
      <div ref={host} className="termbody__host" />
      {conexion !== 'abierta' && (
        <div className="termbody__overlay" role="status">
          {conexion === 'conectando' && <span>Conectando con la sesión…</span>}
          {conexion === 'reconectando' && <span>Conexión perdida. Reintentando…</span>}
          {conexion === 'inexistente' && <span>La sesión ya no existe en tmux.</span>}
          {conexion === 'cerrada' && (
            <>
              <span>La terminal se ha cerrado.</span>
              <button type="button" className="btn btn--ghost" onClick={() => reconectar.current()}>
                Reconectar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

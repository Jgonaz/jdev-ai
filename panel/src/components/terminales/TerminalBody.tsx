import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { probeImage, wsUrl } from '../../api.ts';
import { CURSOR_STYLES, readXtermTheme } from '../../lib/xtermTheme.ts';
import { terminalMayTakeFocus } from '../../lib/focus.ts';
import { HOVER_DELAY_MS, rowBounds } from '../../lib/imageHover.ts';
import { expandHome, scanBufferImagePaths } from '../../lib/imageLinks.ts';
import { useImages } from '../../state/ImagesContext.tsx';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { useSettings } from '../../state/SettingsContext.tsx';
import { AttachNotices, DropZone } from './AttachNotices.tsx';
import { createAutoOpener } from './autoOpenImages.ts';
import type { AutoOpener } from './autoOpenImages.ts';
import { ImageHoverCard } from './ImageHoverCard.tsx';
import type { HoverInfo } from './ImageHoverCard.tsx';
import { createImageLinkProvider } from './imageLinkProvider.ts';
import { useImageAttach } from './useImageAttach.ts';

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
  const { home } = useSessions();
  const { addToStrip, openInViewer, openInTab, hasImage } = useImages();
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const reconectar = useRef<() => void>(() => undefined);
  const ajustes = useRef(settings);
  ajustes.current = settings;
  const alFoco = useRef(onFocus);
  alFoco.current = onFocus;
  const [conexion, setConexion] = useState<Conexion>('conectando');
  const { notices, dismiss, dragging, dropProps } = useImageAttach(host, term, active && !suspended);
  // Los enlaces de imagen se crean una vez por terminal y leen siempre lo último.
  const imagenes = useRef({ home, addToStrip, openInViewer, openInTab, hasImage });
  imagenes.current = { home, addToStrip, openInViewer, openInTab, hasImage };
  // Tarjeta flotante sobre el enlace de imagen bajo el puntero.
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // Apertura automática: visible para el efecto que crea la terminal, que no se recrea con los ajustes.
  const aVista = useRef(false);
  aVista.current = !suspended;
  const autoApertura = useRef<AutoOpener | null>(null);

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
      // El addon de Unicode 11 lo necesita para cambiar la versión activa.
      allowProposedApi: true,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon());
    // Anchos de Unicode 11: los emojis (como el 📸 que marca las imágenes) ocupan dos
    // columnas, igual que en tmux y en Claude Code; con la tabla por defecto se descuadran.
    t.loadAddon(new Unicode11Addon());
    t.unicode.activeVersion = '11';
    // Rutas de imagen: clic abre el visor (con las imágenes ya mostradas en esta terminal en la tira),
    // Ctrl+clic abre una pestaña nueva.
    let temporizadorHover: number | null = null;
    const ocultarHover = () => {
      if (temporizadorHover !== null) window.clearTimeout(temporizadorHover);
      temporizadorHover = null;
      setHover(null);
    };
    const mostrarHover = (ruta: string, e: MouseEvent) => {
      const raiz = root.current;
      const pantalla = contenedor.querySelector('.xterm-screen');
      if (!raiz || !pantalla) return;
      // Anclaje: x del puntero y límites de la fila del enlace, relativos al contenedor de la tarjeta.
      const caja = raiz.getBoundingClientRect();
      const p = pantalla.getBoundingClientRect();
      const fila = rowBounds(p.top, p.height, t.rows, e.clientY);
      const anchor = { left: e.clientX - caja.left, top: fila.top - caja.top, bottom: fila.bottom - caja.top };
      if (temporizadorHover !== null) window.clearTimeout(temporizadorHover);
      // Sin vista previa, el consejo de clic aparece al instante como antes.
      const espera = ajustes.current.terminal.hoverPreview ? HOVER_DELAY_MS : 0;
      if (espera === 0) setHover({ path: ruta, anchor });
      else temporizadorHover = window.setTimeout(() => setHover({ path: ruta, anchor }), espera);
    };
    const dLinks = t.registerLinkProvider(
      createImageLinkProvider(t, {
        onHover: mostrarHover,
        onLeave: ocultarHover,
        getHome: () => imagenes.current.home,
        onActivate: (ruta, nuevaPestana) => {
          const { home: casa, addToStrip: anadir, openInViewer: abrir, openInTab: pestana } = imagenes.current;
          if (nuevaPestana) {
            pestana(name, ruta);
            return;
          }
          const vistas = [...new Set([...scanBufferImagePaths(t.buffer.normal, t.cols), ...scanBufferImagePaths(t.buffer.active, t.cols)])];
          anadir(name, vistas.map((p) => expandHome(p, casa)));
          abrir(name, ruta);
        },
      }),
    );
    t.open(contenedor);
    const abridor = createAutoOpener(t, {
      isEnabled: () => ajustes.current.terminal.autoOpenImages,
      isShown: () => aVista.current,
      getHome: () => imagenes.current.home,
      isKnown: (ruta) => imagenes.current.hasImage(name, ruta),
      probe: (ruta) => probeImage(ruta, name),
      onFound: (rutas) => {
        const { addToStrip: anadir, openInViewer: abrir } = imagenes.current;
        anadir(name, rutas);
        abrir(name, rutas[rutas.length - 1]!, { focus: false });
      },
    });
    autoApertura.current = abridor;
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
        abridor.connected();
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
      abridor.noteInput();
      ocultarHover();
      if (ws?.readyState === WebSocket.OPEN) ws.send(codificador.encode(d));
    });
    const dBinary = t.onBinary((d) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(Uint8Array.from(d, (c) => c.charCodeAt(0)));
    });
    const dScroll = t.onScroll(ocultarHover);
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
    const alRodar = () => {
      abridor.noteWheel();
      ocultarHover();
    };
    contenedor.addEventListener('wheel', alRodar, { passive: true });
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
      contenedor.removeEventListener('wheel', alRodar);
      if (temporizadorHover !== null) window.clearTimeout(temporizadorHover);
      abridor.dispose();
      autoApertura.current = null;
      dScroll.dispose();
      contenedor.removeEventListener('focusin', alEnfocar);
      dData.dispose();
      dBinary.dispose();
      dResize.dispose();
      dLinks.dispose();
      ws?.close();
      t.dispose();
      term.current = null;
      fit.current = null;
    };
  }, [name]);

  // Esc cierra la tarjeta flotante aunque el foco no esté en la terminal.
  useEffect(() => {
    if (!hover) return;
    const alPulsar = (e: KeyboardEvent) => e.key === 'Escape' && setHover(null);
    window.addEventListener('keydown', alPulsar, true);
    return () => window.removeEventListener('keydown', alPulsar, true);
  }, [hover]);

  // Con la apertura automática recién activada, lo que ya hay en pantalla es antiguo.
  useEffect(() => {
    if (settings.terminal.autoOpenImages) autoApertura.current?.rebase();
  }, [settings.terminal.autoOpenImages]);

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
    <div ref={root} className="termbody" {...dropProps}>
      <div ref={host} className="termbody__host" />
      {hover && <ImageHoverCard key={hover.path} info={hover} session={name} preview={settings.terminal.hoverPreview} container={root.current} />}
      {dragging && <DropZone />}
      <AttachNotices notices={notices} onDismiss={dismiss} onView={(ruta) => openInViewer(name, ruta)} />
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

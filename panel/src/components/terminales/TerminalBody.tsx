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
import { translateTerminalKey } from '../../lib/terminalKeys.ts';
import { decodeOsc52 } from '../../lib/osc52.ts';
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
import { ScrollBar } from './ScrollBar.tsx';
import { useImageAttach } from './useImageAttach.ts';
import { useTmuxScroll } from './useTmuxScroll.ts';

type Conexion = 'conectando' | 'abierta' | 'reconectando' | 'cerrada' | 'inexistente';

const CODIGO_NO_ENCONTRADA = 4404;
/** Intervalo mínimo entre avisos de tamaño a tmux mientras se redimensiona. */
const RESIZE_MS = 80;
const BACKOFF_MIN = 500;
const BACKOFF_MAX = 8000;

type Props = {
  name: string;
  /** Esta terminal es la activa: recibe el foco del teclado. */
  active: boolean;
  /** El diálogo u otra capa está encima: no se roba el foco. */
  suspended: boolean;
  /** La pestaña se ve como chat: la terminal sigue conectada pero oculta (no se reajusta mientras mide 0). */
  hidden?: boolean;
  onFocus: () => void;
};

/** Una terminal xterm.js conectada por WebSocket a una sesión de tmux del servidor. */
export function TerminalBody({ name, active, suspended, hidden = false, onFocus }: Props) {
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
  // Barra de scroll del historial de tmux. El efecto de la terminal la avisa por esta referencia.
  const scroll = useTmuxScroll(name, !suspended);
  const avisoScroll = useRef(scroll);
  avisoScroll.current = scroll;

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
    // Lo que tmux copia (selección con el ratón) llega por OSC 52: va al portapapeles del sistema.
    // Sin contexto seguro (panel por http fuera de localhost) no hay API de portapapeles.
    const dPortapapeles = t.parser.registerOscHandler(52, (datos) => {
      const texto = decodeOsc52(datos);
      if (texto !== null) navigator.clipboard?.writeText(texto).catch(() => undefined);
      return true;
    });
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
    // La salida de la terminal puede alargar el historial: se avisa (con espera) a la barra.
    const dSalida = t.onWriteParsed(() => avisoScroll.current.noteOutput());
    // Teclas que xterm.js no traduce como se espera: Ctrl+Retroceso/Supr borran palabras y
    // Mayús+RePág/AvPág (que xterm se queda para su viewport, vacío con tmux) van al historial de tmux.
    t.attachCustomKeyEventHandler((e) => {
      const tr = translateTerminalKey(e);
      if (!tr) return true;
      e.preventDefault();
      abridor.noteInput();
      ocultarHover();
      if (ws?.readyState === WebSocket.OPEN) ws.send(codificador.encode(tr.send));
      if (tr.scroll) avisoScroll.current.bump();
      return false;
    });
    // Al arrastrar un tirador el tamaño cambia en cada fotograma: a tmux se le avisa como mucho
    // cada RESIZE_MS, con el último tamaño al final, para no inundarlo (cada aviso repinta).
    let ultimoAviso = 0;
    let tamanoPendiente: { cols: number; rows: number } | null = null;
    let temporizadorAviso: number | null = null;
    const avisarTamano = () => {
      temporizadorAviso = null;
      const p = tamanoPendiente;
      tamanoPendiente = null;
      if (!p) return;
      ultimoAviso = Date.now();
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: p.cols, rows: p.rows }));
    };
    const dResize = t.onResize(({ cols, rows }) => {
      tamanoPendiente = { cols, rows };
      if (temporizadorAviso !== null) return;
      temporizadorAviso = window.setTimeout(avisarTamano, Math.max(0, RESIZE_MS - (Date.now() - ultimoAviso)));
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
      avisoScroll.current.bump();
    };
    // En captura: con el ratón activo (tmux) xterm.js atiende la rueda y corta su propagación.
    contenedor.addEventListener('wheel', alRodar, { passive: true, capture: true });
    const alEnfocar = () => alFoco.current();
    contenedor.addEventListener('focusin', alEnfocar);

    // Las fuentes web llegan después del primer ajuste y xterm no se entera: mide
    // la celda con la fuente de reserva y calcula de más las filas (la parte de abajo
    // queda cortada hasta reabrir la terminal). `fonts.ready` no basta, porque la
    // fuente de la terminal aún no se ha pedido cuando se resuelve; se pide
    // explícitamente y se vuelve a medir al cargarla y en cada carga de fuentes.
    // Asignar el mismo valor no hace nada en xterm, así que se cambia y se restaura.
    const remedir = () => {
      if (detenido) return;
      const familia = ajustes.current.fonts.terminal;
      t.options.fontFamily = `${familia}, monospace`;
      t.options.fontFamily = familia;
      ajustar();
    };
    const fuentes = document.fonts;
    fuentes?.load(`${ajustes.current.sizes.terminal}px ${ajustes.current.fonts.terminal}`).then(remedir, () => undefined);
    fuentes?.addEventListener?.('loadingdone', remedir);

    return () => {
      detenido = true;
      if (temporizador !== null) window.clearTimeout(temporizador);
      window.cancelAnimationFrame(cuadro);
      if (temporizadorAviso !== null) window.clearTimeout(temporizadorAviso);
      observador.disconnect();
      fuentes?.removeEventListener?.('loadingdone', remedir);
      contenedor.removeEventListener('mouseup', alSoltar);
      contenedor.removeEventListener('wheel', alRodar, { capture: true });
      if (temporizadorHover !== null) window.clearTimeout(temporizadorHover);
      abridor.dispose();
      autoApertura.current = null;
      dScroll.dispose();
      dSalida.dispose();
      contenedor.removeEventListener('focusin', alEnfocar);
      dData.dispose();
      dBinary.dispose();
      dResize.dispose();
      dLinks.dispose();
      dPortapapeles.dispose();
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
    <div ref={root} className="termbody" hidden={hidden} {...dropProps}>
      <div ref={host} id={`term-${name}`} className="termbody__host" />
      <ScrollBar state={scroll.state} controls={`term-${name}`} onOrder={scroll.send} onHover={scroll.setHovering} onDragging={scroll.setDragging} />
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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ApiError, imageUrl, probeImage } from '../../api.ts';
import { neighbour, splitPath } from '../../lib/imageStrip.ts';
import { clampScale, describeMeta, fitScale, percent, scrollAfterZoom, stepScale, wheelScale, AREA_PADDING, MAX_SCALE, MIN_SCALE } from '../../lib/imageZoom.ts';
import type { ImageMeta, Size } from '../../lib/imageZoom.ts';
import { useImages } from '../../state/ImagesContext.tsx';
import type { ViewerTarget } from '../../state/ImagesContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { IconClose, IconCopy, IconExternal, IconImage, IconZoomIn, IconZoomOut } from '../Icons.tsx';

type Carga = { tipo: 'cargando' } | { tipo: 'ok'; meta: ImageMeta } | { tipo: 'error'; mensaje: string };
type Modo = 'fit' | number;

/**
 * Visor lateral de imágenes. Ocupa el lugar del panel de Contexto mientras está
 * abierto (en anchos estrechos, superpuesto igual que él). La tira de abajo
 * reúne las imágenes de la terminal desde la que se abrió.
 */
export function ImageViewer({ target, style }: { target: ViewerTarget; style?: CSSProperties }) {
  const { session, path } = target;
  const { strips, openInViewer, closeViewer, reportResolved } = useImages();
  const { contextOverlay, requestTerminalFocus } = useWorkspace();
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  const [natural, setNatural] = useState<Size | null>(null);
  const [area, setArea] = useState<Size | null>(null);
  const [modo, setModo] = useState<Modo>('fit');
  const [puedeArrastrar, setPuedeArrastrar] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  // Ruta real que devolvió el servidor: identifica la imagen en la tira aunque se abriera con una ruta relativa.
  const [resuelta, setResuelta] = useState<string | null>(null);
  const [rotas, setRotas] = useState<ReadonlySet<string>>(new Set());
  const areaRef = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  // Foco con el que estaba la persona al abrir: Esc se lo devuelve.
  const previo = useRef<Element | null>(document.activeElement);

  const actual = resuelta ?? path;
  const { name, dir: carpeta } = splitPath(actual);
  // Una carpeta relativa («.», «docs») no dice dónde está la imagen: se muestra cuando el servidor la resuelve.
  const dir = actual.startsWith('/') ? carpeta : '';
  const imagenes = strips[session] ?? [actual];
  const url = imageUrl(path, session);

  // Carga: HEAD para cabecera y errores del servidor; la imagen se pide al pintarla.
  const escalaPrevia = useRef(0);
  useEffect(() => {
    const ctl = new AbortController();
    setCarga({ tipo: 'cargando' });
    setNatural(null);
    setResuelta(null);
    setModo('fit');
    setCopiado(false);
    escalaPrevia.current = 0;
    areaRef.current?.scrollTo(0, 0);
    probeImage(path, session, ctl.signal)
      .then((meta) => {
        setCarga({ tipo: 'ok', meta });
        if (meta.path) {
          setResuelta(meta.path);
          reportResolved(session, path, meta.path);
        }
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setCarga({ tipo: 'error', mensaje: e instanceof ApiError || e instanceof Error ? e.message : 'No se puede mostrar la imagen.' });
      });
    return () => ctl.abort();
  }, [path, session, reportResolved]);

  // Tamaño útil del área (sin el relleno) para calcular «Ajustar».
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const medir = () => setArea({ width: Math.max(0, el.clientWidth - 2 * AREA_PADDING), height: Math.max(0, el.clientHeight - 2 * AREA_PADDING) });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Al abrir, el foco pasa al visor para que Esc lo cierre; la apertura automática lo deja en la terminal.
  useEffect(() => {
    if (target.focus !== false) areaRef.current?.focus({ preventScroll: true });
    // Solo al montar: cambiar de imagen no mueve el foco.
  }, []);

  const tamano = natural ?? (carga.tipo === 'ok' && carga.meta.width && carga.meta.height ? { width: carga.meta.width, height: carga.meta.height } : null);
  const ajuste = tamano && area ? fitScale(tamano, area) : 1;
  const escala = modo === 'fit' ? ajuste : modo;
  const escalaRef = useRef(escala);
  escalaRef.current = escala;

  // Al cambiar el zoom se mantiene el centro de lo que se está viendo.
  useLayoutEffect(() => {
    const el = areaRef.current;
    const previa = escalaPrevia.current;
    // Sin tamaño conocido la imagen aún no se muestra a escala: no hay nada que conservar.
    escalaPrevia.current = tamano ? escala : 0;
    if (el && tamano && previa > 0 && previa !== escala) {
      el.scrollLeft = scrollAfterZoom(el.scrollLeft, el.clientWidth, tamano.width * previa, tamano.width * escala, AREA_PADDING);
      el.scrollTop = scrollAfterZoom(el.scrollTop, el.clientHeight, tamano.height * previa, tamano.height * escala, AREA_PADDING);
    }
    if (el) setPuedeArrastrar(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  }, [escala, area, tamano?.width, tamano?.height]);

  // Ctrl (o Cmd) + rueda: zoom. Debe ser un oyente nativo no pasivo para poder impedir el zoom del navegador.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const alRodar = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setModo(wheelScale(escalaRef.current, e.deltaY));
    };
    el.addEventListener('wheel', alRodar, { passive: false });
    return () => el.removeEventListener('wheel', alRodar);
  }, []);

  // La selección con flechas arrastra el foco a la miniatura elegida.
  useEffect(() => {
    const sel = lista.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!sel) return;
    sel.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    if (lista.current?.contains(document.activeElement)) sel.focus({ preventScroll: true });
  }, [actual]);

  const cerrar = () => {
    const anterior = previo.current;
    if (anterior instanceof HTMLElement && anterior.isConnected) anterior.focus();
    else requestTerminalFocus();
    closeViewer();
  };

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(actual);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sin permiso para el portapapeles: la ruta sigue visible en la cabecera.
    }
  };

  const alPulsarPuntero = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.button !== 0 || !puedeArrastrar) return;
    el.setPointerCapture(e.pointerId);
    arrastre.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setArrastrando(true);
  };
  const alMoverPuntero = (e: ReactPointerEvent<HTMLDivElement>) => {
    const a = arrastre.current;
    if (!a) return;
    e.currentTarget.scrollLeft = a.left - (e.clientX - a.x);
    e.currentTarget.scrollTop = a.top - (e.clientY - a.y);
  };
  const alSoltarPuntero = () => {
    arrastre.current = null;
    setArrastrando(false);
  };

  const alPulsarTecla = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
    }
  };

  const alPulsarLista = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    let siguiente: string | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') siguiente = neighbour(imagenes, actual, 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') siguiente = neighbour(imagenes, actual, -1);
    else if (e.key === 'Home') siguiente = imagenes[0] ?? null;
    else if (e.key === 'End') siguiente = imagenes[imagenes.length - 1] ?? null;
    if (siguiente === null) return;
    e.preventDefault();
    if (siguiente !== actual) openInViewer(session, siguiente);
  };

  const error = carga.tipo === 'error';
  const meta = error ? dir : [dir, carga.tipo === 'ok' ? describeMeta(carga.meta, natural) : 'Cargando…'].filter(Boolean).join(' · ');

  return (
    <aside className={`viewer${contextOverlay ? ' viewer--overlay' : ''}`} aria-label="Visor de imágenes" style={style} onKeyDown={alPulsarTecla}>
      <div className="viewer__head">
        <IconImage className="viewer__icon" />
        <div className="viewer__titles">
          <span className="viewer__name" title={actual}>
            {name}
          </span>
          <span className="viewer__meta" title={actual}>
            {meta}
          </span>
        </div>
        <button type="button" className="icon-btn icon-btn--box" aria-label="Cerrar visor" title="Cerrar visor (Esc)" onClick={cerrar}>
          <IconClose />
        </button>
      </div>

      <div className="viewer__toolbar" role="toolbar" aria-label="Controles de la imagen">
        <button type="button" className="viewer__tool" aria-pressed={modo === 'fit'} disabled={error} onClick={() => setModo('fit')}>
          Ajustar
        </button>
        <button type="button" className="viewer__tool" aria-pressed={modo === 1} disabled={error} onClick={() => setModo(1)}>
          100 %
        </button>
        <button
          type="button"
          className="icon-btn viewer__icon-tool"
          aria-label="Alejar"
          title="Alejar"
          disabled={error || escala <= MIN_SCALE}
          onClick={() => setModo(clampScale(stepScale(escala, -1)))}
        >
          <IconZoomOut size={15} />
        </button>
        <span className="viewer__percent" aria-live="polite">
          {percent(escala)}
        </span>
        <button
          type="button"
          className="icon-btn viewer__icon-tool"
          aria-label="Acercar"
          title="Acercar"
          disabled={error || escala >= MAX_SCALE}
          onClick={() => setModo(clampScale(stepScale(escala, 1)))}
        >
          <IconZoomIn size={15} />
        </button>
        <span className="viewer__spacer" />
        <button type="button" className="icon-btn viewer__icon-tool" aria-label="Copiar ruta" title={copiado ? 'Ruta copiada' : 'Copiar ruta'} onClick={() => void copiar()}>
          <IconCopy size={15} />
        </button>
        <button
          type="button"
          className="icon-btn viewer__icon-tool"
          aria-label="Abrir en una pestaña nueva"
          title="Abrir en una pestaña nueva"
          disabled={error}
          onClick={() => window.open(url, '_blank', 'noopener')}
        >
          <IconExternal size={15} />
        </button>
        <span className="sr-only" role="status">
          {copiado ? 'Ruta copiada' : ''}
        </span>
      </div>

      <div
        ref={areaRef}
        className={`viewer__area${puedeArrastrar ? ' viewer__area--pan' : ''}${arrastrando ? ' viewer__area--panning' : ''}`}
        tabIndex={0}
        role="group"
        aria-label={`Imagen ${name}`}
        onPointerDown={alPulsarPuntero}
        onPointerMove={alMoverPuntero}
        onPointerUp={alSoltarPuntero}
        onPointerCancel={alSoltarPuntero}
      >
        {carga.tipo === 'error' ? (
          <div className="viewer__error" role="alert">
            <IconImage size={28} />
            <span className="viewer__error-title">No se puede mostrar la imagen</span>
            <span className="viewer__error-text">{carga.mensaje}</span>
          </div>
        ) : carga.tipo === 'ok' ? (
          <img
            key={url}
            className="viewer__img"
            src={url}
            alt={name}
            draggable={false}
            style={tamano ? { width: tamano.width * escala, height: tamano.height * escala } : { visibility: 'hidden' }}
            onLoad={(e) => {
              const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
              if (width > 0 && height > 0) setNatural({ width, height });
            }}
            onError={() => setCarga({ tipo: 'error', mensaje: 'No se pudo cargar la imagen.' })}
          />
        ) : (
          <span className="viewer__loading" role="status">
            Cargando…
          </span>
        )}
      </div>

      <div className="viewer__strip">
        <span className="viewer__strip-title">imágenes de esta terminal ({imagenes.length})</span>
        <div ref={lista} className="viewer__thumbs" role="listbox" aria-label="Imágenes de esta terminal" onKeyDown={alPulsarLista}>
          {imagenes.map((p) => {
            const seleccionada = p === actual;
            return (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={seleccionada}
                aria-label={splitPath(p).name}
                title={p}
                tabIndex={seleccionada ? 0 : -1}
                className="viewer__thumb"
                onClick={() => !seleccionada && openInViewer(session, p)}
              >
                <span className="viewer__thumb-in">
                  {rotas.has(p) ? (
                    <IconImage size={18} />
                  ) : (
                    <img src={imageUrl(p, session)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setRotas((r) => new Set(r).add(p))} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

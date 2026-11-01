import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, imageUrl, probeImage } from '../../api.ts';
import { placeCard, thumbBox } from '../../lib/imageHover.ts';
import type { Anchor, CardPlacement } from '../../lib/imageHover.ts';
import { splitPath } from '../../lib/imageStrip.ts';
import { describeMeta } from '../../lib/imageZoom.ts';
import type { ImageMeta, Size } from '../../lib/imageZoom.ts';
import { createProbeCache } from '../../lib/probeCache.ts';
import { IconImage } from '../Icons.tsx';
import { IMAGE_LINK_TIP } from './imageLinkProvider.ts';

export type HoverInfo = { path: string; anchor: Anchor };

type Carga = { tipo: 'cargando' } | { tipo: 'ok'; meta: ImageMeta } | { tipo: 'error'; mensaje: string };

// Un HEAD por ruta mientras se pasa el ratón de un lado a otro; caduca por si la captura se sobrescribe.
const sondas = createProbeCache<ImageMeta>();

type Props = {
  info: HoverInfo;
  session: string;
  /** Con la vista previa desactivada la tarjeta solo lleva el consejo de clic. */
  preview: boolean;
  /** Elemento respecto al que se posiciona y cuyos bordes limitan la tarjeta. */
  container: HTMLElement | null;
};

/**
 * Tarjeta flotante junto al enlace de imagen: miniatura, nombre, dimensiones y
 * el consejo de clic. No recibe el puntero ni el foco, para no estorbar la
 * selección de texto de la terminal.
 */
export function ImageHoverCard({ info, session, preview, container }: Props) {
  const { path } = info;
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  const [natural, setNatural] = useState<Size | null>(null);
  const [imgRota, setImgRota] = useState(false);
  const [pos, setPos] = useState<CardPlacement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const anchor = useRef(info.anchor);
  anchor.current = info.anchor;

  useEffect(() => {
    setNatural(null);
    setImgRota(false);
    if (!preview) return;
    let vigente = true;
    setCarga({ tipo: 'cargando' });
    sondas
      .get(`${session}\0${path}`, () => probeImage(path, session))
      .then((meta) => vigente && setCarga({ tipo: 'ok', meta }))
      .catch((e: unknown) => vigente && setCarga({ tipo: 'error', mensaje: e instanceof ApiError || e instanceof Error ? e.message : 'No se puede mostrar la imagen.' }));
    return () => {
      vigente = false;
    };
  }, [path, session, preview]);

  // La tarjeta se mide (su tamaño cambia al llegar los datos y la imagen) y se coloca sin salirse del contenedor.
  const colocar = () => {
    const el = card.current;
    if (!el || !container) return;
    const next = placeCard(anchor.current, { width: el.offsetWidth, height: el.offsetHeight }, { width: container.clientWidth, height: container.clientHeight });
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.side === next.side ? p : next));
  };
  useLayoutEffect(colocar, [info.anchor, carga, natural, imgRota, container]);
  useEffect(() => {
    const el = card.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(colocar);
    obs.observe(el);
    return () => obs.disconnect();
    // `colocar` solo lee refs y el contenedor.
  }, [container]);

  const { name } = splitPath(path);
  const error = carga.tipo === 'error';
  const meta = carga.tipo === 'ok' ? carga.meta : null;
  const caja = thumbBox(natural ?? (meta?.width && meta.height ? { width: meta.width, height: meta.height } : null));
  const datos = meta ? describeMeta(meta, natural) : '';

  return (
    <div
      ref={card}
      role="tooltip"
      className={`imgcard${pos ? ` imgcard--${pos.side}` : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {preview && (
        <>
          {error ? (
            <div className="imgcard__error" role="status">
              <IconImage size={18} />
              <span>{carga.mensaje}</span>
            </div>
          ) : (
            <div className="imgcard__thumb" style={{ width: caja.width, height: caja.height }}>
              {meta && !imgRota ? (
                <img
                  src={imageUrl(path, session)}
                  alt=""
                  draggable={false}
                  onLoad={(e) => {
                    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
                    if (width > 0 && height > 0) setNatural({ width, height });
                  }}
                  onError={() => setImgRota(true)}
                />
              ) : imgRota ? (
                <span className="imgcard__note">No se pudo cargar la imagen.</span>
              ) : (
                <span className="imgcard__note">Cargando…</span>
              )}
            </div>
          )}
          <div className="imgcard__name">{name}</div>
          {datos && <div className="imgcard__meta">{datos}</div>}
        </>
      )}
      <div className="imgcard__hint">{IMAGE_LINK_TIP}</div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../../api.ts';
import { formatBytes } from '../../lib/imageZoom.ts';
import { IconAlert, IconClose, IconImage } from '../Icons.tsx';
import type { Notice } from './useImageAttach.ts';

const HIDE_MS = 6000;

/** Superposición «Suelta para adjuntar la imagen» mientras se arrastra un archivo sobre la terminal. */
export function DropZone() {
  return (
    <div className="dropzone" aria-hidden="true">
      <IconImage size={40} strokeWidth={1.6} />
      <span className="dropzone__title">Suelta para adjuntar la imagen</span>
      <span className="dropzone__text">Se guarda en tu carpeta de imágenes del panel y su ruta se escribe en el prompt, para que el agente la lea.</span>
      <span className="dropzone__types">png, jpg, gif o webp · hasta 20 MB</span>
    </div>
  );
}

type Props = {
  notices: Notice[];
  onDismiss: (id: number) => void;
  /** «Ver» abre la imagen adjuntada en el visor. */
  onView: (path: string) => void;
};

export function AttachNotices({ notices, onDismiss, onView }: Props) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((n) =>
        n.kind === 'ok' ? (
          <OkNotice key={n.id} items={n.items} onClose={() => onDismiss(n.id)} onView={onView} />
        ) : (
          <div key={n.id} className="notice notice--error" role="alert">
            <IconAlert size={18} className="notice__alert-icon" />
            <span className="notice__body">
              <span className="notice__title">No se ha adjuntado</span>
              {n.message.split('\n').map((linea, i) => (
                <span key={i} className="notice__reason">
                  {linea}
                </span>
              ))}
            </span>
            <button type="button" className="icon-btn icon-btn--box" aria-label="Cerrar aviso" onClick={() => onDismiss(n.id)}>
              <IconClose size={14} />
            </button>
          </div>
        ),
      )}
    </div>
  );
}

function OkNotice({ items, onClose, onView }: { items: Extract<Notice, { kind: 'ok' }>['items']; onClose: () => void; onView: (path: string) => void }) {
  // Se oculta solo a los 6 s, salvo mientras el puntero o el foco estén en el aviso.
  const [pausado, setPausado] = useState(false);
  const cerrar = useRef(onClose);
  cerrar.current = onClose;
  useEffect(() => {
    if (pausado) return;
    const t = window.setTimeout(() => cerrar.current(), HIDE_MS);
    return () => window.clearTimeout(t);
  }, [pausado]);

  const primera = items[0]!;
  const resto = items.length - 1;
  return (
    <div
      className="notice"
      role="status"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <span className="notice__thumb" aria-hidden="true">
        <img src={imageUrl(primera.path)} alt="" draggable={false} />
      </span>
      <span className="notice__body">
        <span className="notice__title">{items.length === 1 ? 'Imagen adjuntada' : `${items.length} imágenes adjuntadas`}</span>
        <span className="notice__detail">
          {primera.name} · {formatBytes(primera.size)}
          {resto > 0 ? ` y ${resto} más` : ''}
        </span>
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm notice__view"
        onClick={() => {
          onView(primera.path);
          onClose();
        }}
      >
        Ver
      </button>
      <button type="button" className="icon-btn icon-btn--box" aria-label="Cerrar aviso" onClick={onClose}>
        <IconClose size={14} />
      </button>
    </div>
  );
}

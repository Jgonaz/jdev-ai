import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { imageUrl } from '../../api.ts';
import { imageName } from '../../lib/sharedImages.ts';
import type { SharedImages } from '../../lib/sharedImages.ts';
import { Collapsible } from '../Collapsible.tsx';
import { IconChevron, IconImage, IconMaximize, IconMinimize } from '../Icons.tsx';
import { Modal } from '../Modal.tsx';

type Item = { path: string; by: 'mine' | 'agent' };

const AVISO_SIN_ARCHIVO = 'Esta imagen ya no está en disco o no está en una carpeta que el panel pueda leer. Se compartió en la conversación, pero no se puede mostrar.';

/** Miniatura que pulsar; si la imagen no carga, un recuadro con su nombre en su lugar. */
function Thumb({ item, session, missing, onMissing, onOpen }: { item: Item; session: string; missing: boolean; onMissing: () => void; onOpen: () => void }) {
  const nombre = imageName(item.path);
  return (
    <li>
      <button
        type="button"
        className={`imgs__thumb${missing ? ' imgs__thumb--missing' : ''}`}
        title={item.path}
        aria-label={`${nombre}${missing ? ', ya no está en disco' : ''}: abrir`}
        onClick={onOpen}
      >
        {missing ? (
          <span className="imgs__ph" aria-hidden="true">
            <IconImage size={18} />
            <span className="imgs__phname">{nombre}</span>
          </span>
        ) : (
          <img src={imageUrl(item.path, session)} alt="" loading="lazy" decoding="async" onError={onMissing} />
        )}
      </button>
    </li>
  );
}

function Section({ title, items, session, missing, onMissing, onOpen }: { title: string; items: Item[]; session: string; missing: ReadonlySet<string>; onMissing: (p: string) => void; onOpen: (p: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="imgs__sec">
      <p className="imgs__h">
        {title} <span className="imgs__n">{items.length}</span>
      </p>
      <ul className="imgs__grid">
        {items.map((it) => (
          <Thumb key={it.path} item={it} session={session} missing={missing.has(it.path)} onMissing={() => onMissing(it.path)} onOpen={() => onOpen(it.path)} />
        ))}
      </ul>
    </div>
  );
}

/** Ancho mínimo del modal y lo que añaden su relleno y sus bordes al de la imagen. */
const MIN_MODAL = 480;
const MARCO_MODAL = 46;

/**
 * La imagen abierta en su tamaño real (con desplazamiento si no cabe), con flechas (y ← →) para pasar por todas y un
 * botón para ampliar el modal a toda la ventana; si no existe, el aviso.
 */
function ImageModal({ items, index, session, missing, onMissing, onMove, onClose }: { items: Item[]; index: number; session: string; missing: ReadonlySet<string>; onMissing: (p: string) => void; onMove: (i: number) => void; onClose: () => void }) {
  const [ampliado, setAmpliado] = useState(false);
  const [natural, setNatural] = useState<{ path: string; width: number } | null>(null);
  const item = items[index]!;
  const nombre = imageName(item.path);
  const varias = items.length > 1;
  const mueve = (d: number) => onMove((index + d + items.length) % items.length);
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!varias || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    mueve(e.key === 'ArrowRight' ? 1 : -1);
  };
  // El modal se ajusta al ancho real de la imagen; el CSS lo limita al de la ventana. Ampliado, ocupa la ventana entera.
  const ancho = natural?.path === item.path ? natural.width : 0;
  const width = ampliado ? 100_000 : Math.max(MIN_MODAL, ancho + MARCO_MODAL);
  const etiqueta = ampliado ? 'Reducir' : 'Ampliar a toda la ventana';
  return (
    <Modal
      title={nombre}
      onClose={onClose}
      width={width}
      className={ampliado ? 'modal--full' : undefined}
      actions={
        <button type="button" className="icon-btn modal__close" aria-label={etiqueta} title={etiqueta} aria-pressed={ampliado} onClick={() => setAmpliado(!ampliado)}>
          {ampliado ? <IconMinimize /> : <IconMaximize />}
        </button>
      }
    >
      <div className="imgm" onKeyDown={teclas}>
        <div className="imgm__stage">
          <div className="imgm__scroll">
            {missing.has(item.path) ? (
              <div className="imgm__missing" role="alert">
                <IconImage size={28} />
                <p>{AVISO_SIN_ARCHIVO}</p>
              </div>
            ) : (
              <img
                key={item.path}
                className="imgm__img"
                src={imageUrl(item.path, session)}
                alt={nombre}
                onLoad={(e) => setNatural({ path: item.path, width: e.currentTarget.naturalWidth })}
                onError={() => onMissing(item.path)}
              />
            )}
          </div>
          {varias && (
            <button type="button" className="icon-btn imgm__nav imgm__nav--prev" aria-label="Imagen anterior" onClick={() => mueve(-1)}>
              <IconChevron size={18} />
            </button>
          )}
          {varias && (
            <button type="button" className="icon-btn imgm__nav imgm__nav--next" aria-label="Imagen siguiente" onClick={() => mueve(1)}>
              <IconChevron size={18} />
            </button>
          )}
        </div>
        <p className="imgm__meta">
          <span>{item.by === 'mine' ? 'Compartida por ti' : 'Compartida por el agente'}</span>
          {varias && (
            <span>
              {index + 1} de {items.length}
            </span>
          )}
        </p>
        <p className="imgm__path">{item.path}</p>
      </div>
    </Modal>
  );
}

/**
 * Desplegable «Imágenes» del panel derecho: las que han compartido la persona y el agente en la conversación de la
 * sesión, en dos cuadrículas (las más recientes primero). Solo aparece si hay alguna. Las que ya no existen se ven
 * como recuadro con su nombre, para saber que existieron.
 */
export function SharedImagesSection({ images, session, open, onToggle }: { images: SharedImages; session: string; open: boolean; onToggle: (open: boolean) => void }) {
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const [abierta, setAbierta] = useState<string | null>(null);
  const marcaFalta = useCallback((p: string) => setMissing((m) => (m.has(p) ? m : new Set(m).add(p))), []);
  const mias: Item[] = [...images.mine].reverse().map((path) => ({ path, by: 'mine' }));
  const delAgente: Item[] = [...images.agent].reverse().map((path) => ({ path, by: 'agent' }));
  const todas = [...mias, ...delAgente];
  if (todas.length === 0) return null;
  const indice = abierta === null ? -1 : todas.findIndex((it) => it.path === abierta);
  return (
    <div className="context__imgs">
      <Collapsible title="Imágenes" summary={String(todas.length)} label={`Imágenes (${todas.length})`} open={open} onToggle={onToggle}>
        <Section title="Compartidas por ti" items={mias} session={session} missing={missing} onMissing={marcaFalta} onOpen={setAbierta} />
        <Section title="Compartidas por el agente" items={delAgente} session={session} missing={missing} onMissing={marcaFalta} onOpen={setAbierta} />
      </Collapsible>
      {indice >= 0 && (
        <ImageModal items={todas} index={indice} session={session} missing={missing} onMissing={marcaFalta} onMove={(i) => setAbierta(todas[i]!.path)} onClose={() => setAbierta(null)} />
      )}
    </div>
  );
}

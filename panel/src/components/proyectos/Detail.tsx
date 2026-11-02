import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ApiError, api, imageUrl, moveBacklogItem } from '../../api.ts';
import {
  STATE_LABELS,
  WARNING_TEXTS,
  allowedTargets,
  detailWithoutSummary,
  formatReadTime,
  headerText,
  resolveLocalPath,
  shortDate,
  visibleWarnings,
} from '../../lib/backlog.ts';
import { useFocusTrap } from '../../lib/useFocusTrap.ts';
import type { BacklogDetail, BacklogItem, BacklogState, ProjectInfo } from '../../types.ts';
import { IconAlert, IconClose, IconDots, IconTerminal } from '../Icons.tsx';
import { Markdown } from '../Markdown.tsx';
import { Tabs, tabPanelProps } from './Tabs.tsx';

type Notice = { kind: 'ok' | 'warn' | 'error'; text: string };

const DISCARD_REMINDER = 'Recuerda documentar el motivo del descarte en el elemento (rules/backlog.md); puedes pedírselo al agente.';

const LEGACY_MOVE = 'Los elementos con formato antiguo o cabecera no válida no se pueden mover desde el panel: migra antes la cabecera al formato de rules/backlog.md.';

/** Cabecera YAML con las claves de primer nivel coloreadas y el valor de status destacado. */
function HeaderYaml({ text }: { text: string }) {
  return (
    <pre className="ddet__yaml">
      <span className="ddet__yaml-sep">---</span>
      {'\n'}
      {text.split(/\r?\n/).map((l, i) => {
        const m = /^([A-Za-z_][\w-]*)(:)(.*)$/.exec(l);
        return (
          <span key={i}>
            {m ? (
              <>
                <span className="ddet__yaml-key">{m[1]}</span>
                {m[2]}
                {m[1] === 'status' ? <span className="ddet__yaml-status">{m[3]}</span> : m[3]}
              </>
            ) : (
              l
            )}
            {'\n'}
          </span>
        );
      })}
      <span className="ddet__yaml-sep">---</span>
    </pre>
  );
}

function MoveMenu(props: { from: BacklogState; disabled: boolean; busy: boolean; onMove: (to: BacklogState) => void; describedBy?: string }) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const idMenu = useId();
  const destinos = allowedTargets(props.from);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', fuera);
    raiz.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const alPulsar = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      // Solo cierra el menú, no el detalle.
      e.stopPropagation();
      setAbierto(false);
      raiz.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="menu" ref={raiz} onKeyDown={alPulsar}>
      <button
        type="button"
        className="ddet__more"
        aria-label="Más acciones: mover a otro estado"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        onClick={() => setAbierto((a) => !a)}
      >
        <IconDots />
      </button>
      {abierto && (
        <div id={idMenu} className="menu__list menu__list--up" role="menu" aria-label="Mover a…">
          <span className="menu__title" aria-hidden="true">
            Mover a…
          </span>
          {destinos.map((d) => (
            <button
              key={d}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={props.disabled || props.busy}
              aria-describedby={props.disabled ? props.describedBy : undefined}
              onClick={() => {
                setAbierto(false);
                props.onMove(d);
              }}
            >
              <span className="menu__state">{STATE_LABELS[d]}</span>
              <span className="menu__folder">{d}/</span>
            </button>
          ))}
          {props.disabled && <p className="menu__note">{LEGACY_MOVE}</p>}
        </div>
      )}
    </div>
  );
}

export function Detail(props: {
  project: ProjectInfo;
  itemId: string;
  /** Versión del elemento en la última lista, para avisar si ha cambiado en disco. */
  listItem: BacklogItem | undefined;
  /** Momento en que se cargó esa lista. */
  listStamp: number;
  /** Superpuesto al tablero (anchos estrechos y sin diálogo abierto): atrapa el foco. */
  overlay: boolean;
  style?: CSSProperties;
  onClose: () => void;
  onMoved: () => void;
  /** El elemento no existe (404): la pantalla quita el itemId de la URL. */
  onMissing: () => void;
  onWork: (item: BacklogDetail) => void;
}) {
  const { project, itemId, onMoved } = props;
  // En una ref: un callback nuevo de la pantalla no debe recargar el detalle.
  const alFaltar = useRef(props.onMissing);
  alFaltar.current = props.onMissing;
  const [detalle, setDetalle] = useState<BacklogDetail | null>(null);
  const [cargadoEn, setCargadoEn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<'lectura' | 'fuente'>('lectura');
  const [aviso, setAviso] = useState<Notice | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  const [descartado, setDescartado] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const raiz = useRef<HTMLElement>(null);
  // Escape lo gestiona la pantalla (respeta menús y diálogos) y el foco vuelve a
  // la tarjeta al cerrar; aquí solo se mantiene Tab dentro del detalle.
  useFocusTrap(raiz, props.onClose, undefined, { active: props.overlay, closeOnEscape: false, restoreFocus: false, moveFocus: false });
  const idBase = useId();
  const idLegacy = useId();
  const seq = useRef(0);

  const cargar = useCallback(
    (opciones?: { keepNotice?: boolean }) => {
      const n = ++seq.current;
      if (!opciones?.keepNotice) setAviso(null);
      setDescartado(false);
      api
        .backlogItem(project.id, itemId)
        .then((d) => {
          if (n !== seq.current) return;
          setDetalle(d);
          setCargadoEn(Date.now());
          setError(null);
        })
        .catch((e: unknown) => {
          if (n !== seq.current) return;
          setDetalle(null);
          const noExiste = e instanceof ApiError && e.status === 404;
          setError(noExiste ? 'El elemento no existe o ya no está en el backlog.' : e instanceof Error ? e.message : String(e));
          if (noExiste) alFaltar.current();
        });
    },
    [project.id, itemId],
  );

  useEffect(() => {
    setDetalle(null);
    setError(null);
    setPestana('lectura');
    cargar();
  }, [cargar]);

  // Al abrir otro elemento, el foco va a su título (para lectores de pantalla y teclado).
  const enfocado = useRef<string | null>(null);
  useEffect(() => {
    if (detalle && enfocado.current !== detalle.id) {
      enfocado.current = detalle.id;
      titulo.current?.focus({ preventScroll: true });
    }
  }, [detalle]);

  const mover = async (to: BacklogState) => {
    if (!detalle || moviendo) return;
    setMoviendo(true);
    setAviso(null);
    setDescartado(false);
    const r = await moveBacklogItem(project.id, detalle.id, to, detalle.etag);
    setMoviendo(false);
    if (r.ok) {
      setDetalle(r.item);
      setCargadoEn(Date.now());
      setAviso({ kind: 'ok', text: `Movido a ${STATE_LABELS[to]} (${r.item.path}).` });
      setDescartado(to === 'discarded');
      onMoved();
      return;
    }
    if (r.status === 409) {
      if (r.item) {
        setDetalle(r.item);
        setCargadoEn(Date.now());
      } else {
        cargar({ keepNotice: true });
      }
      setAviso({ kind: 'warn', text: r.item ? 'Ha cambiado mientras lo tenías abierto; te muestro la versión actual.' : r.error });
      onMoved();
      return;
    }
    setAviso({ kind: 'error', text: r.status === 0 ? `${r.error} No se ha movido nada.` : r.error });
  };

  // Una lista posterior al detalle con otra versión (o sin el elemento). El etag
  // incluye la carpeta, pero se compara también el estado por si acaso.
  const cambiado =
    detalle !== null &&
    props.listStamp > cargadoEn &&
    (props.listItem === undefined || props.listItem.etag !== detalle.etag || props.listItem.status !== detalle.status);
  const movidoFuera = cambiado && props.listItem !== undefined && props.listItem.status !== detalle?.status;
  const legacy = detalle?.warnings.includes('legacy') ?? false;
  const cabecera = detalle ? headerText(detalle.source) : null;
  const resto = detalle ? detailWithoutSummary(detalle.body) : '';
  // Las imágenes relativas se resuelven en la carpeta del documento.
  const dirDoc = detalle ? `${project.path}/${detalle.path.replace(/\/[^/]*$/, '')}` : '';
  const imageHref = (src: string) => {
    const abs = project.path ? resolveLocalPath(dirDoc, src) : null;
    return abs ? imageUrl(abs) : null;
  };

  return (
    <aside className="ddet" aria-label="Detalle del elemento" ref={raiz} style={props.style}>
      <div className="ddet__head">
        <div className="ddet__idrow">
          <span className="ddet__id">{detalle?.id ?? itemId}</span>
          <button type="button" className="icon-btn ddet__close" aria-label="Cerrar detalle" onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
        {detalle && (
          <>
            <h2 className="ddet__title" ref={titulo} tabIndex={-1}>
              {detalle.title}
            </h2>
            <ul className="ddet__chips" aria-label="Propiedades">
              <li className="ddet__chip">{STATE_LABELS[detalle.status]}</li>
              {detalle.type && <li className="ddet__chip">{detalle.type}</li>}
              {detalle.priority && <li className="ddet__chip">prioridad {detalle.priority}</li>}
              {detalle.created && <li className="ddet__chip ddet__chip--muted">creado {shortDate(detalle.created)}</li>}
              {legacy && <li className="ddet__chip ddet__chip--warn">formato antiguo</li>}
            </ul>
            <Tabs
              tabs={[
                { value: 'lectura', label: 'Lectura' },
                { value: 'fuente', label: 'Fuente .md' },
              ]}
              value={pestana}
              onChange={setPestana}
              label="Vista del elemento"
              idBase={idBase}
              className="ddet__tabs"
            />
          </>
        )}
      </div>

      <div className="ddet__live" aria-live="polite">
        {aviso && !(cambiado && aviso.kind === 'ok') && (
          <p className={`ddet__notice ddet__notice--${aviso.kind}`} role={aviso.kind === 'error' ? 'alert' : undefined}>
            {aviso.kind !== 'ok' && <IconAlert size={14} />}
            {aviso.text}
          </p>
        )}
        {descartado && detalle?.status === 'discarded' && !cambiado && <p className="ddet__notice ddet__notice--info">{DISCARD_REMINDER}</p>}
        {cambiado && (!aviso || aviso.kind === 'ok') && (
          <p className="ddet__notice ddet__notice--warn">
            <IconAlert size={14} />
            {movidoFuera && props.listItem
              ? `Se ha movido a ${STATE_LABELS[props.listItem.status]} desde fuera.`
              : props.listItem
                ? 'El archivo ha cambiado en disco.'
                : 'El archivo ya no está donde estaba.'}{' '}
            <button type="button" className="link-btn" onClick={() => cargar()}>
              Ver la versión actual
            </button>
          </p>
        )}
      </div>

      {error && (
        <div className="ddet__body">
          <p className="ddet__error" role="alert">
            {error}
          </p>
        </div>
      )}
      {!detalle && !error && (
        <div className="ddet__body">
          <p className="ddet__loading">Cargando…</p>
        </div>
      )}

      {detalle && (
        <>
          <div className="ddet__body" {...tabPanelProps(idBase, pestana)} tabIndex={0}>
            {visibleWarnings(detalle.warnings).length > 0 && (
              <ul className="ddet__warnings">
                {visibleWarnings(detalle.warnings).map((w) => (
                  <li key={w} className="ddet__warning">
                    <IconAlert size={14} />
                    <span>{WARNING_TEXTS[w]}</span>
                  </li>
                ))}
              </ul>
            )}
            {pestana === 'fuente' ? (
              <pre className="ddet__source" aria-label={`Fuente de ${detalle.path}`}>
                {detalle.source}
              </pre>
            ) : (
              <>
                {detalle.summary && (
                  <section className="ddet__summary" aria-labelledby={`${idBase}-resumen`}>
                    <div className="ddet__summary-head">
                      <h3 id={`${idBase}-resumen`} className="ddet__h ddet__h--accent">
                        resumen
                      </h3>
                      <span className="ddet__read">{formatReadTime(detalle.readSeconds)}</span>
                    </div>
                    <Markdown source={detalle.summary} className="md--summary" imageHref={imageHref} />
                  </section>
                )}
                {cabecera !== null && (
                  <section className="ddet__section" aria-labelledby={`${idBase}-cabecera`}>
                    <h3 id={`${idBase}-cabecera`} className="ddet__h">
                      cabecera
                    </h3>
                    <HeaderYaml text={cabecera} />
                  </section>
                )}
                {resto !== '' && (
                  <details className="ddet__full" open>
                    <summary className="ddet__h">detalle completo</summary>
                    <Markdown source={resto} className="md--detail" imageHref={imageHref} />
                  </details>
                )}
                <p className="ddet__path">{detalle.path}</p>
              </>
            )}
          </div>

          <div className="ddet__actions">
            {legacy && (
              <p id={idLegacy} className="ddet__legacy-note">
                {LEGACY_MOVE}
              </p>
            )}
            {detalle.status === 'backlog' && (
              <button
                type="button"
                className="btn btn--lg ddet__promote"
                disabled={legacy || moviendo}
                aria-describedby={legacy ? idLegacy : undefined}
                onClick={() => void mover('todo')}
              >
                {moviendo ? 'Moviendo…' : 'Pasar a por hacer →'}
              </button>
            )}
            <button type="button" className="btn btn--accent btn--lg ddet__work" onClick={() => props.onWork(detalle)}>
              <IconTerminal size={14} />
              Trabajar en esto
            </button>
            <MoveMenu from={detalle.status} disabled={legacy} busy={moviendo} onMove={(to) => void mover(to)} describedBy={idLegacy} />
          </div>
        </>
      )}
    </aside>
  );
}

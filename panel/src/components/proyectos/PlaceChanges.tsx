import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { buildTree, firstFilePath, totalLines } from '../../lib/fileTree.ts';
import type { PlaceRef } from '../../lib/route.ts';
import { useFileDiff, usePlaceChanges } from '../../lib/usePlaceChanges.ts';
import type { PlaceInfo, ProjectInfo, SessionInfo, WorktreeInfo } from '../../types.ts';
import { IconBranch, IconChevron, IconCircleCheck, IconPlus, IconRefresh } from '../Icons.tsx';
import { DiffView } from './DiffView.tsx';
import { FileTree, fmt } from './FileTree.tsx';
import { SessionLinks } from './WorktreeStrip.tsx';

/**
 * Cambios de un lugar (checkout principal o worktree) de `#/cambios/<proyecto>/<lugar>[/<archivo>]`:
 * la barra del lugar (rama, comparación, sesiones, nueva sesión, totales) y, debajo,
 * un árbol de los archivos cambiados y el diff del elegido. El archivo abierto va en la
 * dirección. Sin archivo se muestra el primero del árbol sin tocar la dirección; si el de
 * la dirección ya no está entre los cambios, se avisa, se quita de la dirección y se muestra el primero.
 */
export function PlaceChanges(props: {
  project: ProjectInfo;
  place: PlaceRef;
  /** Datos del lugar de la lista de lugares; null mientras no han llegado. */
  info: PlaceInfo | WorktreeInfo | null;
  /** Rama principal, de la lista de lugares. */
  base: string | null;
  /** Archivo de la dirección. */
  file: string | null;
  sessions: readonly SessionInfo[];
  /** La persona elige un archivo (añade una entrada al historial). */
  onSelectFile: (path: string) => void;
  /** Se quita de la dirección un archivo que ya no está entre los cambios, sin añadir una entrada al historial. */
  onDropFile: () => void;
  onOpenSession: (name: string) => void;
  onNewSession: () => void;
  /** «Actualizar»: además de la lista del lugar, se refrescan los recuentos de las pestañas y de la barra lateral. */
  onRefresh?: () => void;
  /** Id de la pestaña que describe este panel. */
  tabId: string;
}) {
  const { project, place, info, file, onDropFile } = props;
  const { data, error, reload } = usePlaceChanges(project.id, place);
  const files = data?.files ?? null;
  const primero = useMemo(() => (files ? firstFilePath(buildTree(files)) : null), [files]);
  const totales = useMemo(() => totalLines(files ?? []), [files]);
  const enLista = file !== null && (files?.some((f) => f.path === file) ?? false);
  // Se muestra el de la dirección si sigue entre los cambios y, si no, el primero.
  const abierto = files === null ? null : enLista ? file : primero;
  const entry = (abierto !== null && files?.find((f) => f.path === abierto)) || null;
  const diff = useFileDiff(project.id, place, entry, data?.mergeBase ?? null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [arbolAbierto, setArbolAbierto] = useState(false);

  // Un archivo de la dirección que ya no está entre los cambios se quita de ella, con aviso.
  useEffect(() => {
    if (files === null || file === null || enLista) return;
    setAviso(file);
    onDropFile();
  }, [files, file, enLista, onDropFile]);

  const principal = place.kind === 'main';
  const base = principal ? (data?.upstream ?? props.base ?? 'la rama principal') : (props.base ?? data?.base ?? 'la rama principal');
  const rama = info ? (info.branch ?? '(sin rama)') : '…';
  const mergeShort = data?.mergeBase.slice(0, 7) ?? '';
  const upstream = info && 'upstream' in info ? info.upstream : (data?.upstream ?? null);

  // Con qué se compara, junto a la rama.
  let comparacion: ReactNode = null;
  if (principal) {
    if (info) {
      comparacion = upstream ? (
        <span className="wchg__since">
          {info.ahead !== null && info.ahead > 0 ? `↑${info.ahead} sin subir frente a ${upstream}` : `todo subido a ${upstream}`}
          {info.behind !== null && info.behind > 0 && (
            <>
              {' · '}
              <span aria-hidden="true">↓{info.behind}</span>
              <span className="sr-only">{info.behind} por bajar</span>
            </>
          )}
        </span>
      ) : (
        <span className="wchg__since">sin rama remota</span>
      );
    }
  } else if (data) {
    comparacion = (
      <span className="wchg__since">
        frente a {base} desde {mergeShort}
        {info && info.ahead !== null && info.behind !== null && (
          <span title={`${info.ahead} commits por delante y ${info.behind} por detrás de ${base}`}>
            {' '}
            <span aria-hidden="true">↑{info.ahead} ↓{info.behind}</span>
            <span className="sr-only">{info.ahead} por delante y {info.behind} por detrás de {base}</span>
          </span>
        )}
      </span>
    );
  }

  let cuerpo: ReactNode;
  if (!data) {
    cuerpo = error ? (
      <div className="wchg__state">
        <div className="wchg__statebox" role="alert">
          <strong className="wchg__errtitle">No se pudieron calcular los cambios</strong>
          <span>{error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={reload}>
            Reintentar
          </button>
        </div>
      </div>
    ) : (
      <div className="wchg__loading">
        <div className="wchg__skeleton" aria-hidden="true">
          {[70, 85, 60, 75, 50].map((w, i) => (
            <span key={i} style={{ width: `${w}%`, marginLeft: i === 1 || i === 2 || i === 4 ? 14 : 0 }} />
          ))}
        </div>
        <p role="status">Calculando los cambios frente a {base}…</p>
      </div>
    );
  } else if (data.files.length === 0) {
    cuerpo = (
      <div className="wchg__state">
        <div className="wchg__statebox">
          <IconCircleCheck size={28} />
          <strong>Sin cambios</strong>
          <span>
            {principal ? (
              data.upstream ? (
                <>Todo está subido a {data.upstream} y no hay cambios sin commit.</>
              ) : (
                <>No hay cambios sin commit ni archivos nuevos.</>
              )
            ) : (
              <>
                La rama <code>{rama}</code> aún no tiene commits propios ni cambios sin commit.
              </>
            )}
          </span>
        </div>
      </div>
    );
  } else {
    cuerpo = (
      <>
        <button
          type="button"
          className="wchg__treebar"
          aria-expanded={arbolAbierto}
          aria-controls="wchg-tree"
          onClick={() => setArbolAbierto((a) => !a)}
        >
          <IconChevron size={12} className={`wchg__chev${arbolAbierto ? ' wchg__chev--open' : ''}`} />
          <span className="wchg__treefile">{abierto ?? ''}</span>
          <span className="wchg__treecount">Archivos ({fmt(data.total)})</span>
        </button>
        <div id="wchg-tree" className="wchg__tree" data-open={arbolAbierto}>
          <FileTree
            files={data.files}
            selected={abierto}
            total={data.total}
            truncated={data.truncated}
            onSelect={(p) => {
              setArbolAbierto(false);
              setAviso(null);
              props.onSelectFile(p);
            }}
          />
        </div>
        <div className="wchg__main">
          {aviso !== null && (
            <div className="wchg__notice" role="status">
              <span>
                <code>{aviso}</code> ya no tiene cambios: se muestra el primer archivo de la lista.
              </span>
              <button type="button" className="link-btn" onClick={() => setAviso(null)}>
                Cerrar
              </button>
            </div>
          )}
          {entry && (
            <DiffView
              key={`${place.kind}:${place.kind === 'wt' ? place.name : ''}`}
              file={entry}
              diff={diff.data}
              loading={diff.loading}
              error={diff.error}
              onRetry={diff.retry}
              baseLabel={base}
              mergeShort={mergeShort}
              afterLabel={principal ? 'Después · checkout principal' : 'Después · worktree'}
              terminalHint={
                entry.status === 'U'
                  ? `git diff --no-index /dev/null ${entry.path}`
                  : principal
                    ? `git diff ${mergeShort}`
                    : `git diff ${base}...`
              }
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className="wchg" role="tabpanel" aria-labelledby={props.tabId}>
      <div className="wchg__bar">
        <IconBranch size={14} />
        <span className="wchg__branch">{rama}</span>
        {comparacion}
        {info?.dirty && <span className="wt__dirty">cambios sin commit</span>}
        {info && <SessionLinks names={info.sessions} sessions={props.sessions} onOpen={props.onOpenSession} />}
        <button type="button" className="btn btn--sm wchg__new" onClick={props.onNewSession}>
          <IconPlus size={13} />
          Nueva sesión aquí
        </button>
        <span className="wchg__tools">
          {data && (
            <>
              <span className="wchg__count">{fmt(data.total)} {data.total === 1 ? 'archivo' : 'archivos'}</span>
              <span className="wchg__lines">
                <span className="ftree__add">+{fmt(totales.added)}</span> <span className="ftree__del">−{fmt(totales.deleted)}</span>
              </span>
            </>
          )}
          <button type="button" className="btn btn--ghost btn--sm wchg__refresh"
            onClick={() => {
              reload();
              props.onRefresh?.();
            }}
          >
            <IconRefresh size={13} />
            Actualizar
          </button>
        </span>
      </div>
      {principal && data && data.upstream === null && (
        <p className="wchg__note">
          Sin rama remota no se puede saber qué falta por subir: solo se muestran los cambios sin commit y los archivos nuevos.
        </p>
      )}
      {data && error && (
        <p className="ptab__error" role="alert">
          No se pudo actualizar la lista: {error}
        </p>
      )}
      <div className="wchg__box">{cuerpo}</div>
    </div>
  );
}

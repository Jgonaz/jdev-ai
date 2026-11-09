import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { parsePatch, toSplitRows } from '../../lib/diff.ts';
import type { DiffLine, Hunk, SplitSide } from '../../lib/diff.ts';
import { loadDiffMode, saveDiffMode } from '../../lib/diffMode.ts';
import type { DiffMode } from '../../lib/diffMode.ts';
import { useElementWidth } from '../../lib/useElementWidth.ts';
import type { ChangedFile, FileDiff } from '../../types.ts';
import { IconFileLarge, IconImage, IconSplit, IconUnified } from '../Icons.tsx';
import { FileStat, STATUS_LABEL } from './FileTree.tsx';

/** Ancho mínimo (px) del panel del diff para mostrar dos columnas; por debajo, siempre unificado. */
export const MIN_SPLIT_WIDTH = 640;

const SIGNO = { add: '+', del: '−', ctx: ' ' } as const;

function NoEol() {
  return <span className="diff__noeol"> (sin salto de línea al final)</span>;
}

function UnifiedBody(props: { hunks: readonly Hunk[]; digitos: number }) {
  return (
    <div className="diffu" role="table" aria-label="Diff unificado" style={{ '--digitos': props.digitos } as CSSProperties}>
      <div className="diffu__inner">
        {props.hunks.map((h, i) => (
          <div key={i} role="rowgroup" className="diffu__hunk">
            <div role="row" className="diff__hunkrow">
              <span role="cell">{h.header}</span>
            </div>
            {h.lines.map((l: DiffLine, j) => (
              <div key={j} role="row" className="diffu__row" data-kind={l.kind}>
                <span role="cell" className="diff__num">{l.oldNo ?? ''}</span>
                <span role="cell" className="diff__num">{l.newNo ?? ''}</span>
                <span role="cell" className="diff__sign">{SIGNO[l.kind]}</span>
                <span role="cell" className="diffu__code">
                  {l.text}
                  {l.noEol && <NoEol />}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitCells(props: { side: SplitSide | null; right: boolean }) {
  const { side, right } = props;
  const lado = right ? ' diffs__cell--right' : '';
  if (!side) {
    return (
      <>
        <span role="cell" className={`diff__num diff__num--gap${lado}`} />
        <span role="cell" className="diffs__code diffs__code--gap" />
      </>
    );
  }
  return (
    <>
      <span role="cell" className={`diff__num${lado}`} data-kind={side.kind}>{side.no}</span>
      <span role="cell" className="diffs__code" data-kind={side.kind}>
        <span className="diff__sign">{SIGNO[side.kind]}</span>
        {side.text}
        {side.noEol && <NoEol />}
      </span>
    </>
  );
}

function SplitBody(props: { hunks: readonly Hunk[]; digitos: number; before: string; after: string }) {
  const filas = useMemo(() => toSplitRows(props.hunks), [props.hunks]);
  return (
    <div className="diffs" role="table" aria-label="Diff lado a lado" style={{ '--digitos': props.digitos } as CSSProperties}>
      <div role="row" className="diffs__head">
        <span role="columnheader">{props.before}</span>
        <span role="columnheader" className="diffs__head--right">{props.after}</span>
      </div>
      {filas.map((f, i) =>
        f.type === 'hunk' ? (
          <div key={i} role="row" className="diff__hunkrow">
            <span role="cell">{f.header}</span>
          </div>
        ) : (
          <div key={i} role="row" className="diffs__row">
            <SplitCells side={f.left} right={false} />
            <SplitCells side={f.right} right />
          </div>
        ),
      )}
    </div>
  );
}

function Notice(props: { icon: 'bin' | 'large' | 'none'; title: string; children: ReactNode }) {
  return (
    <div className="diff__empty">
      <div className="diff__emptybox">
        {props.icon === 'bin' && <IconImage size={28} />}
        {props.icon === 'large' && <IconFileLarge size={28} />}
        <strong>{props.title}</strong>
        <span>{props.children}</span>
      </div>
    </div>
  );
}

/**
 * Diff de un archivo del worktree: cabecera con su ruta, estado y líneas, y el
 * parche lado a lado (por defecto) o unificado. La elección se recuerda en este
 * navegador; si el panel es más estrecho que MIN_SPLIT_WIDTH no caben dos columnas,
 * así que se muestra unificado y el conmutador se oculta.
 */
export function DiffView(props: {
  file: ChangedFile;
  diff: FileDiff | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Con qué se compara (la rama remota o la rama principal) y commit de partida de la comparación. */
  baseLabel: string;
  mergeShort: string;
  /** Cabecera de la columna nueva («Después · worktree»). */
  afterLabel: string;
  /** Comando para ver el diff en una terminal, si es demasiado grande. */
  terminalHint: string;
}) {
  const { file, diff } = props;
  const [modo, setModo] = useState<DiffMode>(() => loadDiffMode());
  const panel = useRef<HTMLElement>(null);
  const ancho = useElementWidth(panel);
  const estrecho = ancho > 0 && ancho < MIN_SPLIT_WIDTH;
  const efectivo: DiffMode = estrecho ? 'unified' : modo;
  const elegir = (m: DiffMode) => {
    setModo(m);
    saveDiffMode(m);
  };

  const hunks = useMemo(() => (diff?.patch ? parsePatch(diff.patch) : []), [diff?.patch]);
  const digitos = useMemo(() => {
    let max = 0;
    for (const h of hunks) for (const l of h.lines) max = Math.max(max, l.oldNo ?? 0, l.newNo ?? 0);
    return Math.max(3, String(max).length);
  }, [hunks]);

  const barra = file.path.lastIndexOf('/');
  const dir = barra >= 0 ? file.path.slice(0, barra + 1) : '';
  const nombre = barra >= 0 ? file.path.slice(barra + 1) : file.path;

  let cuerpo: ReactNode;
  if (props.error) {
    cuerpo = (
      <div className="diff__empty">
        <div className="diff__emptybox" role="alert">
          <strong className="diff__errtitle">No se pudo calcular el diff</strong>
          <span>{props.error}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={props.onRetry}>
            Reintentar
          </button>
        </div>
      </div>
    );
  } else if (props.loading || !diff) {
    cuerpo = <p className="diff__loading" role="status">Cargando el diff…</p>;
  } else if (diff.binary) {
    cuerpo = <Notice icon="bin" title="Archivo binario">Git no puede mostrar un diff de texto de este archivo.</Notice>;
  } else if (diff.tooLarge) {
    cuerpo = (
      <Notice icon="large" title="Diff demasiado grande">
        Ocupa más de 512 KB y no se muestra aquí. Puedes verlo en una terminal con <code>{props.terminalHint}</code>.
      </Notice>
    );
  } else if (hunks.length === 0) {
    cuerpo =
      file.status === 'R' && file.oldPath ? (
        <Notice icon="none" title="Renombrado sin cambios">
          Movido desde <code>{file.oldPath}</code> sin cambios en su contenido.
        </Notice>
      ) : (
        <Notice icon="none" title="Sin líneas que mostrar">
          {file.status === 'U' || file.status === 'A' ? 'El archivo está vacío.' : 'El contenido no cambia; puede haber cambiado solo el modo del archivo.'}
        </Notice>
      );
  } else if (efectivo === 'split') {
    cuerpo = (
      <SplitBody
        hunks={hunks}
        digitos={digitos}
        before={`Antes · ${props.baseLabel} ${props.mergeShort}${file.oldPath ? ` · ${file.oldPath}` : ''}`}
        after={props.afterLabel}
      />
    );
  } else {
    cuerpo = <UnifiedBody hunks={hunks} digitos={digitos} />;
  }

  return (
    <section ref={panel} className="diffpanel" aria-label="Diff del archivo">
      <div className="diffpanel__head">
        <span className="diffpanel__path">
          {dir}
          <strong>{nombre}</strong>
        </span>
        {file.oldPath && <span className="diffpanel__old">desde {file.oldPath}</span>}
        <span className="diffpanel__badge" data-status={file.status}>
          {file.status} · {STATUS_LABEL[file.status]}
        </span>
        <span className="diffpanel__stat">
          <FileStat added={file.added} deleted={file.deleted} binary={file.binary} />
        </span>
        {!estrecho && (
          <div role="group" aria-label="Formato del diff" className="diffsw">
            <button type="button" className="diffsw__btn" aria-pressed={modo === 'split'} onClick={() => elegir('split')}>
              <IconSplit size={14} />
              Lado a lado
            </button>
            <button type="button" className="diffsw__btn" aria-pressed={modo === 'unified'} onClick={() => elegir('unified')}>
              <IconUnified size={14} />
              Unificado
            </button>
          </div>
        )}
      </div>
      <div className="diffpanel__body">{cuerpo}</div>
    </section>
  );
}

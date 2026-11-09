import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ancestorDirs, buildTree, dirPaths, flattenTree } from '../../lib/fileTree.ts';
import type { ChangedFile, ChangeStatus } from '../../types.ts';
import { IconChevron, IconCollapseAll, IconFile, IconFolder } from '../Icons.tsx';

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  A: 'Añadido',
  M: 'Modificado',
  D: 'Borrado',
  R: 'Renombrado',
  T: 'Cambio de tipo',
  U: 'Sin seguimiento',
};

export const fmt = (n: number): string => n.toLocaleString('es-ES');

/** «+3 −1» de un archivo; vacío si no se pudieron contar y «bin» en binarios. */
export function FileStat(props: { added: number | null; deleted: number | null; binary: boolean }) {
  if (props.binary) return <span className="ftree__stat"><span className="ftree__bin">bin</span></span>;
  return (
    <span className="ftree__stat">
      {props.added !== null && <span className="ftree__add">+{fmt(props.added)}</span>}
      {props.deleted !== null && <span className="ftree__del">−{fmt(props.deleted)}</span>}
    </span>
  );
}

/**
 * Árbol de archivos cambiados (patrón ARIA «tree»): flechas arriba y abajo para
 * moverse, derecha e izquierda para desplegar, plegar o ir al hijo y al padre,
 * Inicio y Fin para ir al primero y al último, Enter o Espacio para abrir un
 * archivo o plegar una carpeta.
 */
export function FileTree(props: {
  files: readonly ChangedFile[];
  selected: string | null;
  onSelect: (path: string) => void;
  /** Archivos cambiados en total, si la lista se cortó. */
  total: number;
  truncated: boolean;
}) {
  const { files, selected, onSelect } = props;
  const tree = useMemo(() => buildTree(files), [files]);
  const [plegadas, setPlegadas] = useState<ReadonlySet<string>>(new Set());
  const [foco, setFoco] = useState<string | null>(null);
  const lista = useRef<HTMLUListElement>(null);
  const filas = useMemo(() => flattenTree(tree, plegadas), [tree, plegadas]);

  // Un archivo que se abre desde la dirección queda a la vista aunque se hubiera plegado su carpeta.
  // Solo al cambiar de archivo: recargar la lista no debe desplegar lo que la persona plegó.
  const arbol = useRef(tree);
  arbol.current = tree;
  useEffect(() => {
    if (selected === null) return;
    const dirs = ancestorDirs(arbol.current, selected);
    setPlegadas((p) => (dirs.some((d) => p.has(d)) ? new Set([...p].filter((d) => !dirs.includes(d))) : p));
  }, [selected]);

  const clave = (i: number) => {
    const n = filas[i]!.node;
    return `${n.kind}:${n.path}`;
  };
  const indiceSeleccionado = filas.findIndex((r) => r.node.kind === 'file' && r.node.path === selected);
  const indiceFoco = foco === null ? -1 : filas.findIndex((_, i) => clave(i) === foco);
  // Una sola parada de tabulador: la fila con el foco, o la seleccionada, o la primera.
  const parada = indiceFoco >= 0 ? indiceFoco : indiceSeleccionado >= 0 ? indiceSeleccionado : 0;

  const alternar = (ruta: string) =>
    setPlegadas((p) => {
      const n = new Set(p);
      if (!n.delete(ruta)) n.add(ruta);
      return n;
    });
  const ir = (i: number) => {
    const j = Math.max(0, Math.min(filas.length - 1, i));
    (lista.current?.children[j] as HTMLElement | undefined)?.focus();
  };

  const teclado = (e: KeyboardEvent<HTMLUListElement>) => {
    if (filas.length === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const li = (e.target as HTMLElement).closest('li');
    const i = li ? Array.prototype.indexOf.call(lista.current?.children ?? [], li) : parada;
    if (i < 0) return;
    const { node, depth } = filas[i]!;
    const dir = node.kind === 'dir';
    const abierta = dir && !plegadas.has(node.path);
    let hecho = true;
    switch (e.key) {
      case 'ArrowDown':
        ir(i + 1);
        break;
      case 'ArrowUp':
        ir(i - 1);
        break;
      case 'Home':
        ir(0);
        break;
      case 'End':
        ir(filas.length - 1);
        break;
      case 'ArrowRight':
        if (dir && !abierta) alternar(node.path);
        else if (abierta) ir(i + 1);
        break;
      case 'ArrowLeft':
        if (abierta) alternar(node.path);
        else if (depth > 0) {
          let p = i - 1;
          while (p > 0 && filas[p]!.depth >= depth) p--;
          ir(p);
        }
        break;
      case 'Enter':
      case ' ':
        if (dir) alternar(node.path);
        else onSelect(node.path);
        break;
      default:
        hecho = false;
    }
    if (hecho) e.preventDefault();
  };

  return (
    <div className="ftree">
      <div className="ftree__head">
        <span className="ftree__title">Archivos cambiados</span>
        <button
          type="button"
          className="icon-btn ftree__collapse"
          aria-label="Plegar todas las carpetas"
          title="Plegar todas las carpetas"
          onClick={() => setPlegadas(new Set(dirPaths(tree)))}
        >
          <IconCollapseAll size={14} />
        </button>
      </div>
      <ul ref={lista} role="tree" aria-label="Archivos cambiados" className="ftree__list" onKeyDown={teclado}>
        {filas.map(({ node, depth }, i) => {
          const k = clave(i);
          const base = { 'data-key': k, role: 'treeitem', 'aria-level': depth + 1, tabIndex: i === parada ? 0 : -1, onFocus: () => setFoco(k) } as const;
          const sangria = { paddingLeft: `calc(${8 + depth * 14}px)` };
          if (node.kind === 'dir') {
            const abierta = !plegadas.has(node.path);
            return (
              <li
                key={k}
                {...base}
                aria-expanded={abierta}
                aria-selected={false}
                className="ftree__row ftree__row--dir"
                style={sangria}
                title={`${node.path} · +${fmt(node.added)} −${fmt(node.deleted)}`}
                onClick={() => alternar(node.path)}
              >
                <IconChevron size={12} className={`ftree__chev${abierta ? ' ftree__chev--open' : ''}`} />
                <IconFolder size={15} className="ftree__icon" />
                <span className="ftree__name">{node.name}</span>
              </li>
            );
          }
          const f = node.file;
          return (
            <li
              key={k}
              {...base}
              aria-selected={f.path === selected}
              className="ftree__row ftree__row--file"
              data-status={f.status}
              style={sangria}
              title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
              onClick={() => onSelect(f.path)}
            >
              <span className="ftree__gap" aria-hidden="true" />
              <IconFile size={14} className="ftree__icon" />
              <span className="ftree__name">{node.name}</span>
              <FileStat added={f.added} deleted={f.deleted} binary={f.binary} />
              <span className="ftree__st" aria-hidden="true">{f.status}</span>
              <span className="sr-only">{STATUS_LABEL[f.status]}</span>
            </li>
          );
        })}
      </ul>
      {props.truncated && (
        <p className="ftree__more" role="status">
          Se muestran {fmt(files.length)} de {fmt(props.total)} archivos.
        </p>
      )}
    </div>
  );
}

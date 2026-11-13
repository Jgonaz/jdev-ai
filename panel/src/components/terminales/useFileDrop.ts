import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { hasFiles } from '../../lib/attachments.ts';

/**
 * Soltar archivos sobre un elemento (la terminal, la caja del chat). Solo reacciona a archivos: el
 * texto arrastrado sigue como siempre. `dragging` es verdadero mientras un archivo está encima.
 * El contador de entradas evita que pasar por un hijo del elemento apague el estado.
 */
export function useFileDrop(alSoltar: (archivos: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer.types)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer.types)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer.types)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer.types)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      alSoltar(Array.from(e.dataTransfer.files));
    },
  };

  return { dragging, dropProps };
}

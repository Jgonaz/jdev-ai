import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { uploadImage } from '../../api.ts';
import type { UploadedImage } from '../../api.ts';
import { hasFiles, pastedImages, validateUpload } from '../../lib/attachments.ts';

type NoticeBody = { kind: 'ok'; items: UploadedImage[] } | { kind: 'error'; message: string };
export type Notice = NoticeBody & { id: number };

/**
 * Adjuntar imágenes a una terminal: pegar (con la imagen en el portapapeles y sin
 * texto) o soltar archivos sobre ella. La imagen se sube, su ruta se escribe en
 * la entrada de la terminal sin Enter y se avisa de lo ocurrido. Los avisos de
 * error se descartan cuando la terminal deja de estar a la vista (otra terminal
 * activa o otra pantalla): ya no son de lo que se está haciendo.
 */
export function useImageAttach(host: RefObject<HTMLDivElement | null>, term: RefObject<Terminal | null>, shown: boolean) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(1);
  const depth = useRef(0);

  const dismiss = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);
  const push = useCallback((aviso: NoticeBody) => {
    // Un aviso nuevo sustituye al anterior del mismo tipo para no apilar avisos viejos.
    setNotices((n) => [...n.filter((x) => x.kind !== aviso.kind), { ...aviso, id: nextId.current++ }]);
  }, []);

  useEffect(() => {
    if (!shown) setNotices((n) => (n.some((x) => x.kind === 'error') ? n.filter((x) => x.kind !== 'error') : n));
  }, [shown]);

  const attach = useCallback(
    async (archivos: File[]) => {
      const validos: { archivo: File; tipo: string }[] = [];
      const motivos: string[] = [];
      for (const archivo of archivos) {
        const r = validateUpload(archivo);
        if (r.ok) validos.push({ archivo, tipo: r.type });
        else motivos.push(r.reason);
      }
      const subidas: UploadedImage[] = [];
      for (const { archivo, tipo } of validos) {
        try {
          subidas.push(await uploadImage(archivo, tipo));
        } catch (e) {
          const detalle = e instanceof Error ? e.message : 'No se pudo subir la imagen.';
          motivos.push(`«${archivo.name || 'La imagen'}»: ${detalle}`);
        }
      }
      const t = term.current;
      if (subidas.length > 0 && t) {
        // paste() respeta el pegado entre corchetes; el espacio final deja escribir a continuación.
        t.paste(`${subidas.map((s) => s.path).join(' ')} `);
        t.focus();
        push({ kind: 'ok', items: subidas });
      }
      if (motivos.length > 0) push({ kind: 'error', message: motivos.join('\n') });
    },
    [term, push],
  );
  const attachRef = useRef(attach);
  attachRef.current = attach;

  // Pegar: en captura, antes de que xterm lea el portapapeles, y solo si hay imagen y ningún texto.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const alPegar = (e: ClipboardEvent) => {
      const datos = e.clipboardData;
      if (!datos) return;
      const archivos = pastedImages(Array.from(datos.files), datos.getData('text/plain'));
      if (archivos.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void attachRef.current(archivos);
    };
    el.addEventListener('paste', alPegar, true);
    return () => el.removeEventListener('paste', alPegar, true);
  }, [host]);

  // Arrastrar: solo reacciona a archivos; el texto arrastrado sigue como siempre.
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
      void attach(Array.from(e.dataTransfer.files));
    },
  };

  return { notices, dismiss, dragging, dropProps };
}

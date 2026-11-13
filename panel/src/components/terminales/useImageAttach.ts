import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { UploadedImage } from '../../api.ts';
import { pastedImages } from '../../lib/attachments.ts';
import { uploadImages } from '../../lib/uploadImages.ts';
import { useFileDrop } from './useFileDrop.ts';

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
  const nextId = useRef(1);

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
      const { subidas, motivos } = await uploadImages(archivos);
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

  const { dragging, dropProps } = useFileDrop(attach);

  return { notices, dismiss, dragging, dropProps };
}

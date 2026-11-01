import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { expandHome, imageLinksAt } from '../../lib/imageLinks.ts';

export const IMAGE_LINK_TIP = 'Clic: abrir en el visor · Ctrl+clic: pestaña nueva';

type Options = {
  /** HOME del servidor, para las rutas «~/…»; se lee al detectar el enlace. */
  getHome: () => string | null;
  /** Clic en el enlace (`newTab` con Ctrl o Cmd). */
  onActivate: (path: string, newTab: boolean) => void;
  /** El puntero entra en un enlace: la tarjeta flotante (consejo y miniatura) la pinta el componente. */
  onHover: (path: string, event: MouseEvent) => void;
  /** El puntero sale del enlace o este desaparece. */
  onLeave: () => void;
};

/**
 * Proveedor de enlaces de xterm.js para rutas de imagen. Las URL quedan para el
 * addon web-links porque `findImagePaths` las descarta.
 */
export function createImageLinkProvider(term: Terminal, { getHome, onActivate, onHover, onLeave }: Options): ILinkProvider {
  return {
    provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
      const encontradas = imageLinksAt(term.buffer.active, y - 1, term.cols).filter((f) => f.range.start.y <= y && f.range.end.y >= y);
      if (encontradas.length === 0) {
        callback(undefined);
        return;
      }
      callback(
        encontradas.map((f): ILink => {
          const ruta = expandHome(f.path, getHome());
          return {
            range: f.range,
            text: f.path,
            decorations: { pointerCursor: true, underline: true },
            activate: (e) => {
              onLeave();
              onActivate(ruta, e.ctrlKey || e.metaKey);
            },
            hover: (e) => onHover(ruta, e),
            leave: onLeave,
            dispose: onLeave,
          };
        }),
      );
    },
  };
}

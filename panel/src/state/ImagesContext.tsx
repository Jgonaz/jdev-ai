import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { imageUrl } from '../api.ts';
import { canonicalList, canonicalPath, inferCwd, normalizePath, pushResolved, replaceResolved, stripHas } from '../lib/imageStrip.ts';

/** `focus: false` (apertura automática) abre el visor sin quitarle el foco a la terminal. */
export type ViewerTarget = { session: string; path: string; focus?: boolean };

type ImagesValue = {
  /** Imagen que muestra el visor lateral, o null si está cerrado. */
  viewer: ViewerTarget | null;
  /** Imágenes de cada terminal (la más reciente primero), solo en memoria. */
  strips: Record<string, readonly string[]>;
  /** Abre el visor con esta imagen y la añade a la tira de la terminal. */
  openInViewer: (session: string, path: string, opciones?: { focus?: boolean }) => void;
  /** ¿Figura ya la imagen en la tira de la terminal? */
  hasImage: (session: string, path: string) => boolean;
  /** Abre la imagen en una pestaña nueva del navegador y la añade a la tira. */
  openInTab: (session: string, path: string) => void;
  /** Añade a la tira de la terminal las imágenes que aparecen en ella (de la más antigua a la más reciente). */
  addToStrip: (session: string, paths: readonly string[]) => void;
  closeViewer: () => void;
  /**
   * El servidor resolvió `original` (la ruta del visor) como `resuelta`: la tira
   * sustituye una por otra y quita los duplicados; con el directorio de la terminal
   * deducido también reconoce otras rutas relativas a la misma imagen.
   */
  reportResolved: (session: string, original: string, resuelta: string) => void;
  /** La terminal activa cambió: con el visor abierto muestra su última imagen, o lo cierra si no tiene ninguna. */
  followTerminal: (session: string | null) => void;
};

const Ctx = createContext<ImagesValue | null>(null);

export function ImagesProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [strips, setStrips] = useState<Record<string, readonly string[]>>({});
  // Último directorio de cada terminal deducido al resolver una ruta relativa. Solo se usa para no
  // repetir en la tira una imagen ya conocida; las rutas que se piden siguen siendo las originales.
  const cwds = useRef<Record<string, string>>({});
  const stripsRef = useRef(strips);
  stripsRef.current = strips;

  const addToStrip = useCallback((session: string, paths: readonly string[]) => {
    setStrips((s) => {
      const actual = s[session] ?? [];
      const nueva = pushResolved(actual, paths.map((p) => normalizePath(p)), cwds.current[session]);
      return nueva === actual ? s : { ...s, [session]: nueva };
    });
  }, []);
  const openInViewer = useCallback((session: string, path: string, opciones?: { focus?: boolean }) => {
    const ruta = normalizePath(path);
    setStrips((s) => {
      const actual = s[session] ?? [];
      const nueva = pushResolved(actual, [ruta], cwds.current[session]);
      return nueva === actual ? s : { ...s, [session]: nueva };
    });
    setViewer(opciones?.focus === false ? { session, path: ruta, focus: false } : { session, path: ruta });
  }, []);
  const hasImage = useCallback((session: string, path: string) => stripHas(stripsRef.current[session] ?? [], normalizePath(path), cwds.current[session]), []);
  const openInTab = useCallback((session: string, path: string) => {
    addToStrip(session, [path]);
    window.open(imageUrl(path, session), '_blank', 'noopener');
  }, [addToStrip]);
  const closeViewer = useCallback(() => setViewer(null), []);
  const reportResolved = useCallback((session: string, original: string, resuelta: string) => {
        const cwd = inferCwd(original, resuelta);
    if (cwd) cwds.current[session] = cwd;
    setStrips((s) => {
      const actual = s[session];
      if (!actual) return s;
      const base = cwd ? canonicalList(actual, cwd) : actual;
      const nueva = replaceResolved(base, canonicalPath(original, cwd), resuelta);
      return nueva === actual ? s : { ...s, [session]: nueva };
    });
  }, []);
  const followTerminal = useCallback((session: string | null) => {
    setViewer((v) => {
      if (!v) return v;
      if (session === null) return null;
      if (v.session === session) return v;
      const ultima = stripsRef.current[session]?.[0];
      return ultima === undefined ? null : { session, path: ultima };
    });
  }, []);

  const valor = useMemo<ImagesValue>(
    () => ({ viewer, strips, openInViewer, hasImage, openInTab, addToStrip, closeViewer, reportResolved, followTerminal }),
    [viewer, strips, openInViewer, hasImage, openInTab, addToStrip, closeViewer, reportResolved, followTerminal],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useImages(): ImagesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useImages fuera de ImagesProvider');
  return v;
}

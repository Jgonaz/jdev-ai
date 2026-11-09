import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.ts';
import type { ChangedFile, FileDiff, PlaceChanges } from '../types.ts';
import type { PlaceRef } from './route.ts';

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const lugarClave = (l: PlaceRef) => (l.kind === 'main' ? 'main' : `wt:${l.name}`);

/** El mismo lugar con la misma identidad entre renders mientras no cambie (los efectos dependen de él). */
function useLugar(lugar: PlaceRef): PlaceRef {
  const nombre = lugar.kind === 'wt' ? lugar.name : null;
  return useMemo<PlaceRef>(() => (nombre === null ? { kind: 'main' } : { kind: 'wt', name: nombre }), [nombre]);
}

type EstadoLista = { clave: string; data: PlaceChanges | null; error: string | null };

/**
 * Cambios del lugar mostrado (checkout principal o worktree). Se piden al abrirlo,
 * al volver a la ventana y con `reload` (el botón «Actualizar»). Las respuestas de
 * otro proyecto o lugar, o de una petición ya superada, se descartan. Si una
 * recarga falla, se conserva la última lista con el error.
 */
export function usePlaceChanges(
  projectId: string | null,
  lugar: PlaceRef,
): { data: PlaceChanges | null; error: string | null; loading: boolean; reload: () => void } {
  const clave = projectId ? `${projectId}\n${lugarClave(lugar)}` : null;
  const [estado, setEstado] = useState<EstadoLista | null>(null);
  const [version, setVersion] = useState(0);
  const lugarEstable = useLugar(lugar);

  const cargar = useCallback(
    (signal: AbortSignal) => {
      if (!projectId || clave === null) return;
      api
        .placeChanges(projectId, lugarEstable, signal)
        .then((data) => {
          if (!signal.aborted) setEstado({ clave, data, error: null });
        })
        .catch((e: unknown) => {
          if (signal.aborted) return;
          setEstado((w) => ({ clave, data: w && w.clave === clave ? w.data : null, error: mensaje(e) }));
        });
    },
    [projectId, lugarEstable, clave],
  );

  useEffect(() => {
    if (clave === null) return;
    const control = new AbortController();
    cargar(control.signal);
    return () => control.abort();
  }, [clave, cargar, version]);

  useEffect(() => {
    if (clave === null) return;
    const refrescar = () => {
      if (document.visibilityState === 'visible') setVersion((v) => v + 1);
    };
    window.addEventListener('focus', refrescar);
    document.addEventListener('visibilitychange', refrescar);
    return () => {
      window.removeEventListener('focus', refrescar);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [clave]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const vigente = estado !== null && estado.clave === clave ? estado : null;
  return { data: vigente?.data ?? null, error: vigente?.error ?? null, loading: clave !== null && vigente === null, reload };
}

type EstadoDiff = { clave: string; data: FileDiff | null; error: string | null };

/** Lo que cambia en una lista para un archivo: si es distinto, hay que volver a pedir su diff. */
export const fileSignature = (f: ChangedFile, mergeBase: string): string =>
  [mergeBase, f.status, f.oldPath ?? '', f.added ?? '', f.deleted ?? '', f.binary ? 'b' : ''].join('\u0000');

/**
 * Diff del archivo abierto. Se vuelve a pedir si cambia el archivo, el lugar o su
 * entrada en la lista de cambios (otra recarga con el mismo archivo y las mismas
 * cifras no lo pide). Descarta respuestas de un archivo anterior.
 */
export function useFileDiff(
  projectId: string | null,
  lugar: PlaceRef,
  file: ChangedFile | null,
  mergeBase: string | null,
): { data: FileDiff | null; error: string | null; loading: boolean; retry: () => void } {
  const firma = file && mergeBase ? fileSignature(file, mergeBase) : null;
  const clave = projectId && file && firma !== null ? `${projectId}\n${lugarClave(lugar)}\n${file.path}\n${firma}` : null;
  const ruta = file?.path ?? null;
  const [estado, setEstado] = useState<EstadoDiff | null>(null);
  const [intento, setIntento] = useState(0);
  const lugarEstable = useLugar(lugar);

  useEffect(() => {
    if (clave === null || !projectId || ruta === null) return;
    const control = new AbortController();
    // Un reintento tras un error empieza de cero; la recarga de un diff ya cargado lo conserva mientras llega el nuevo.
    setEstado((e) => (e && e.clave === clave && e.data ? { ...e, error: null } : null));
    api
      .placeDiff(projectId, lugarEstable, ruta, control.signal)
      .then((data) => {
        if (!control.signal.aborted) setEstado({ clave, data, error: null });
      })
      .catch((e: unknown) => {
        if (!control.signal.aborted) setEstado({ clave, data: null, error: mensaje(e) });
      });
    return () => control.abort();
  }, [clave, projectId, lugarEstable, ruta, intento]);

  const retry = useCallback(() => setIntento((i) => i + 1), []);
  const vigente = useMemo(() => (estado !== null && estado.clave === clave ? estado : null), [estado, clave]);
  return { data: vigente?.data ?? null, error: vigente?.error ?? null, loading: clave !== null && vigente === null, retry };
}

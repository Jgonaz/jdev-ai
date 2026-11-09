import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';

const POLL_MS = 30_000;

/**
 * Archivos cambiados por proyecto (checkout principal más worktrees), para la
 * barra lateral y el proyecto por defecto de Cambios. `data` es null hasta la
 * primera respuesta, y `failed` si esa primera no llegó. Se refresca al volver a
 * la ventana y cada 30 s, solo mientras la pantalla está montada.
 */
export function useChangesSummary(enabled = true): { data: Readonly<Record<string, number | null>> | null; failed: boolean; reload: () => void } {
  const [data, setData] = useState<Record<string, number | null> | null>(null);
  const [failed, setFailed] = useState(false);

  const cargar = useCallback((signal: AbortSignal) => {
    api
      .changesSummary(signal)
      .then((d) => {
        if (signal.aborted) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        // Un fallo no borra el último resumen conocido.
        if (!signal.aborted) setFailed(true);
      });
  }, []);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const control = new AbortController();
    cargar(control.signal);
    return () => control.abort();
  }, [enabled, cargar, version]);

  useEffect(() => {
    if (!enabled) return;
    const refrescar = () => {
      if (document.visibilityState === 'visible') setVersion((v) => v + 1);
    };
    const t = window.setInterval(refrescar, POLL_MS);
    window.addEventListener('focus', refrescar);
    document.addEventListener('visibilitychange', refrescar);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', refrescar);
      document.removeEventListener('visibilitychange', refrescar);
    };
  }, [enabled]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, failed, reload };
}

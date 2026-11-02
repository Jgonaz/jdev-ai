import { useCallback, useState } from 'react';
import type { CSSProperties } from 'react';
import { clampWidth, loadPanelWidth, savePanelWidth } from './panelWidth.ts';
import type { PanelLimits } from './panelWidth.ts';

export type PanelWidth = {
  /** Ancho actual: el recordado o, si no hay, el de por defecto. */
  width: number;
  /** El usuario ha cambiado el ancho (si no, mandan los estilos de siempre). */
  custom: boolean;
  /** Cambia el ancho sin recordarlo (mientras se arrastra). */
  preview: (w: number) => void;
  /** Cambia el ancho y lo recuerda. */
  commit: (w: number) => void;
  /** Vuelve al ancho por defecto y borra el recuerdo. */
  reset: () => void;
  /** Estilo del panel: la variable CSS con el ancho, solo si es personalizado. */
  style: (variable: `--${string}`, activo?: boolean) => CSSProperties | undefined;
};

/** Ancho de un panel lateral, recordado por `id` en localStorage. */
export function usePanelWidth(id: string, limits: PanelLimits): PanelWidth {
  const { min, max } = limits;
  const [actual, setActual] = useState<number | null>(() => loadPanelWidth(id, limits));
  const preview = useCallback((w: number) => setActual(clampWidth(w, min, max)), [min, max]);
  const commit = useCallback(
    (w: number) => {
      const v = clampWidth(w, min, max);
      setActual(v);
      savePanelWidth(id, v);
    },
    [id, min, max],
  );
  const reset = useCallback(() => {
    setActual(null);
    savePanelWidth(id, null);
  }, [id]);
  const style = useCallback(
    (variable: `--${string}`, activo = true): CSSProperties | undefined =>
      activo && actual !== null ? ({ [variable]: `${actual}px`, minWidth: min } as CSSProperties) : undefined,
    [actual, min],
  );
  return { width: actual ?? limits.default, custom: actual !== null, preview, commit, reset, style };
}

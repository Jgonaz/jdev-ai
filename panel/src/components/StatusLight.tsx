import type { VisualState } from '../types.ts';
import { STATE_LABELS } from '../lib/sessions.ts';

/**
 * Luz piloto de una sesión. El estado se distingue por forma además de por
 * color: punto con halo (te espera), anillo que gira (trabaja), anillo quieto
 * (reposo), raya (cerrada), punto lleno (viva) y cuadrado (terminada).
 * `title` da el nombre accesible cuando la luz va sola.
 */
export function StatusLight({ state, label = false }: { state: VisualState; label?: boolean }) {
  return (
    <span
      className={`light light--${state}`}
      role={label ? 'img' : undefined}
      aria-label={label ? STATE_LABELS[state] : undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}

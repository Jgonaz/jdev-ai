import type { VisualState } from '../types.ts';
import { STATE_LABELS } from '../lib/sessions.ts';
import { IconCheck, IconTerminal } from './Icons.tsx';

/**
 * Luz piloto de una sesión. El estado se distingue por forma además de por
 * color: punto con halo (te espera), anillo que gira (trabaja), anillo quieto
 * (reposo), check (hecha), punto lleno (viva) y cuadrado (terminada).
 * Una terminal sin agente no tiene estado: lleva un icono de terminal en lugar
 * de luz; si es la terminal de arranque de su proyecto (`running`), con un
 * indicador de «en marcha». `label` da el nombre accesible cuando la luz va sola.
 */
export function StatusLight({ state, label = false, running = false }: { state: VisualState; label?: boolean; running?: boolean }) {
  if (state === 'shell') {
    return (
      <span
        className={`light light--shell${running ? ' light--running' : ''}`}
        role={label ? 'img' : undefined}
        aria-label={label ? (running ? `${STATE_LABELS[state]} en marcha` : STATE_LABELS[state]) : undefined}
        aria-hidden={label ? undefined : true}
      >
        <IconTerminal size={10} strokeWidth={2.6} />
      </span>
    );
  }
  if (state === 'done') {
    return (
      <span
        className="light light--done"
        role={label ? 'img' : undefined}
        aria-label={label ? STATE_LABELS[state] : undefined}
        aria-hidden={label ? undefined : true}
      >
        <IconCheck size={11} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className={`light light--${state}`}
      role={label ? 'img' : undefined}
      aria-label={label ? STATE_LABELS[state] : undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}

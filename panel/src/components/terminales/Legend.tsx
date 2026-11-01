import { STATE_LABELS, visualState } from '../../lib/sessions.ts';
import type { SessionInfo, VisualState } from '../../types.ts';
import { StatusLight } from '../StatusLight.tsx';

const BASE: VisualState[] = ['waiting', 'working', 'idle', 'closed'];

// «Viva» y «terminada» solo aparecen si hay sesiones sin estado de turno (Codex, Copilot, OpenCode).
export function Legend({ sessions }: { sessions: readonly SessionInfo[] }) {
  const presentes = new Set(sessions.map(visualState));
  const estados = [...BASE, ...(['alive', 'ended'] as VisualState[]).filter((e) => presentes.has(e))];
  return (
    <div className="legend">
      <span className="legend__title">luces piloto</span>
      {estados.map((e) => (
        <div key={e} className="legend__row">
          <StatusLight state={e} />
          {STATE_LABELS[e]}
        </div>
      ))}
    </div>
  );
}

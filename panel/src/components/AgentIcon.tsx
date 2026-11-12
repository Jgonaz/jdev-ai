import { AGENT_LABELS } from '../lib/sessions.ts';

/**
 * Icono de un agente (Claude, Codex, Copilot, OpenCode o terminal sin agente).
 * Es decorativo salvo que se pida `label`: las filas y pestañas ya dicen el
 * agente por texto o en su tooltip. El color sale de los tokens `--agent-*`.
 */
export function AgentIcon({ agent, size = 14, label = false }: { agent: string; size?: number; label?: boolean }) {
  const nombre = AGENT_LABELS[agent] ?? agent;
  const clase = ['claude', 'codex', 'copilot', 'opencode', 'shell'].includes(agent) ? agent : 'shell';
  return (
    <svg
      className={`agent agent--${clase}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label ? nombre : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {clase === 'claude' && <path d="M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" />}
      {clase === 'codex' && (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="3.5" strokeWidth={1.5} />
          <circle cx="8" cy="8" r="2" strokeWidth={1.5} />
        </>
      )}
      {clase === 'copilot' && (
        <>
          <rect x="2.5" y="4" width="11" height="8.5" rx="3.5" strokeWidth={1.5} />
          <path d="M6 8v1M10 8v1" />
        </>
      )}
      {clase === 'opencode' && <path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" strokeWidth={1.5} />}
      {clase === 'shell' && <path d="M3 5l3 3-3 3M8.5 11H13" strokeWidth={1.5} />}
    </svg>
  );
}

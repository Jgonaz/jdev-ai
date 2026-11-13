import { progressPercent } from '../../lib/chat.ts';
import { AGENT_PRODUCTS, SHELL_AGENT, visualState } from '../../lib/sessions.ts';
import { contextView, workCounts } from '../../lib/statusline.ts';
import { useConversation } from '../../lib/useConversation.ts';
import type { SessionInfo } from '../../types.ts';
import { ActivityMap } from './ActivityMap.tsx';

/** Por qué no hay mapa: explica la causa en lugar de dejar el hueco vacío. */
function NoMap({ title, children }: { title: string; children: string }) {
  return (
    <div className="map__none">
      <svg width={72} height={72} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
        <circle cx={36} cy={36} r={30} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} strokeDasharray="3 5" />
        <circle cx={36} cy={36} r={11} fill="none" stroke="var(--fg-faint)" strokeWidth={1.5} />
        <line x1={12} y1={60} x2={60} y2={12} stroke="var(--fg-faint)" strokeWidth={1.5} />
      </svg>
      <h3 className="map__nonet">{title}</h3>
      <p className="map__nonep">{children}</p>
    </div>
  );
}

function LiveMap({ session, active }: { session: SessionInfo; active: boolean }) {
  const estado = visualState(session);
  // Comparte el sondeo con la vista chat de la misma sesión si está abierta.
  const conv = useConversation(session.name, active, estado === 'working');
  return (
    <>
      {!conv.synced && (
        <p className={`map__note${conv.error ? ' map__note--error' : ''}`} role="status">
          {conv.error ?? `Leyendo la conversación… ${progressPercent(conv.from, conv.size)} %`}
        </p>
      )}
      <ActivityMap
        events={conv.mapEvents}
        total={conv.mapTotal}
        epoch={conv.sessionId}
        synced={conv.synced}
        state={estado === 'working' ? 'working' : estado === 'waiting' ? 'waiting' : 'other'}
        percent={contextView(session)?.percent ?? null}
        model={session.usage?.model ?? ''}
        subagents={workCounts(session.activity).subagents}
        active={active}
      />
    </>
  );
}

/**
 * Contenido de la vista «Mapa» del panel derecho para la sesión de Claude `session` (la de la pestaña activa o, en una de
 * seguimiento, la que la lanzó). `active` es que la pantalla está a la vista y sin diálogo encima.
 */
export function MapPanel({ session, active }: { session: SessionInfo | null; active: boolean }) {
  if (!session) return <p className="context__empty">Abre una terminal de Claude para ver aquí el mapa de su actividad.</p>;
  if (session.agent !== 'claude') {
    const quien = session.agent === SHELL_AGENT ? 'Esta es una terminal sin agente.' : `Esta es una sesión de ${(AGENT_PRODUCTS as Record<string, string>)[session.agent] ?? session.agent}.`;
    return (
      <NoMap title="Sin mapa para esta sesión">{`El mapa solo está disponible para las sesiones de Claude lanzadas desde el panel. ${quien}`}</NoMap>
    );
  }
  if (!session.chat.available) {
    return <NoMap title="Mapa no disponible">{session.chat.reason ?? 'La conversación de esta sesión no está disponible.'}</NoMap>;
  }
  return <LiveMap key={session.name} session={session} active={active} />;
}

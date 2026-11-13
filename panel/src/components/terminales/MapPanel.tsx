import { progressPercent } from '../../lib/chat.ts';
import { visualState } from '../../lib/sessions.ts';
import { contextView, workCounts } from '../../lib/statusline.ts';
import { useConversation } from '../../lib/useConversation.ts';
import type { SessionInfo } from '../../types.ts';
import { ActivityMap } from './ActivityMap.tsx';

/**
 * Por qué una sesión no tiene mapa, en una línea, o null si lo tiene. Sirve también para que el panel sepa si «Sesión»
 * va a la vista (sin mapa) o en su desplegable.
 */
export function noMapReason(session: SessionInfo): string | null {
  if (session.agent !== 'claude') return 'Sin mapa: solo está disponible para las sesiones de Claude lanzadas desde el panel.';
  if (!session.chat.available) return `Mapa no disponible: ${session.chat.reason ?? 'la conversación de esta sesión no está disponible.'}`;
  return null;
}

function LiveMap({ session, active, listOpen, onListToggle }: { session: SessionInfo; active: boolean; listOpen: boolean; onListToggle: (open: boolean) => void }) {
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
        listOpen={listOpen}
        onListToggle={onListToggle}
      />
    </>
  );
}

/**
 * Mapa de actividad del panel derecho para la sesión de Claude `session` (la de la pestaña activa o, en una de
 * seguimiento, la que la lanzó), o la nota de una línea con el motivo si no hay mapa. `active` es que la pantalla está a
 * la vista y sin diálogo encima; la conversación se lee mientras lo esté, aunque «Actividad reciente» esté plegada.
 */
export function MapPanel({ session, active, activityOpen, onActivityToggle }: { session: SessionInfo; active: boolean; activityOpen: boolean; onActivityToggle: (open: boolean) => void }) {
  const motivo = noMapReason(session);
  if (motivo !== null) return <p className="context__nomap">{motivo}</p>;
  return <LiveMap key={session.name} session={session} active={active} listOpen={activityOpen} onListToggle={onActivityToggle} />;
}

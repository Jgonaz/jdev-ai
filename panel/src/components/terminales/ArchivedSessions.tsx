import { useId, useState } from 'react';
import { archivedHeading, archivedKey, loadArchivedCollapsed, saveArchivedCollapsed } from '../../lib/archive.ts';
import type { ArchivedEntry } from '../../lib/archive.ts';
import { recentPlace } from '../../lib/recent.ts';
import { STATE_LABELS } from '../../lib/sessions.ts';
import { recentTip, sessionTip } from '../../lib/sidebarTip.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { IconArchive, IconChevron, IconClock } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import type { useConversationMenu } from './ConversationMenu.tsx';
import { RowTooltip, useRowTip } from './RowTooltip.tsx';
import type { useSessionMenu } from './SessionMenu.tsx';

type SessionHandlers = Pick<ReturnType<typeof useSessionMenu>, 'onContextMenu' | 'onKeyDown'>;
type ConversationHandlers = Pick<ReturnType<typeof useConversationMenu>, 'onContextMenu' | 'onKeyDown'>;

function ArchivedRow({ entry, session, conversation }: { entry: ArchivedEntry; session: SessionHandlers; conversation: ConversationHandlers }) {
  const { openSession, openResume } = useWorkspace();
  const tip = useRowTip();
  if (entry.kind === 'session') {
    const { session: s, project, state, hiddenProject } = entry;
    return (
      <li>
        <button
          type="button"
          className={`slrow slrow--${state}`}
          aria-label={`Abrir ${s.title}, ${project.name}${hiddenProject ? ', proyecto oculto' : ''}, ${STATE_LABELS[state]}, archivada`}
          {...tip.props}
          onClick={() => openSession(s.name)}
          onContextMenu={(e) => session.onContextMenu(e, s)}
          onKeyDown={(e) => session.onKeyDown(e, s)}
        >
          <StatusLight state={state} />
          <span className="slrow__title">{s.title}</span>
          <Monogram project={project} size="sm" />
        </button>
        {tip.anchor && <RowTooltip anchor={tip.anchor} id={tip.id} build={(ahora) => sessionTip(s, project, ahora)} />}
      </li>
    );
  }
  const { recent: r, project } = entry;
  return (
    <li>
      <button
        type="button"
        className={`slrow slrow--conv${r.closed ? ' slrow--closed' : ''}`}
        aria-label={`Retomar en el panel: ${r.title}, ${project.name}, ${recentPlace(r)}, archivada`}
        {...tip.props}
        onClick={() => openResume(r)}
        onContextMenu={(e) => conversation.onContextMenu(e, r)}
        onKeyDown={(e) => conversation.onKeyDown(e, r)}
      >
        <IconClock size={13} className="rrow__icon slrow__icon" />
        <span className="slrow__title">{r.title}</span>
        <ArchivedAction />
        <Monogram project={project} size="sm" />
      </button>
      {tip.anchor && <RowTooltip anchor={tip.anchor} id={tip.id} build={(ahora) => recentTip(r, project, ahora)} />}
    </li>
  );
}

/** «Retomar» al pasar por una conversación, como en «Anteriores». */
function ArchivedAction() {
  return (
    <span className="rrow__action" aria-hidden="true">
      Retomar
    </span>
  );
}

/**
 * Apartado «Archivadas (N)» de la barra lateral, debajo de «En segundo plano»:
 * sesiones (con su luz de estado) y conversaciones que la persona apartó.
 * Plegable y recordado; oculto si está vacío. Plegado, una luz de «te espera»
 * avisa de que alguna sesión archivada la necesita.
 */
export function ArchivedSection({ entries, session, conversation }: { entries: ArchivedEntry[]; session: SessionHandlers; conversation: ConversationHandlers }) {
  const [plegado, setPlegado] = useState(() => loadArchivedCollapsed());
  const idTitulo = useId();
  const idLista = useId();
  if (entries.length === 0) return null;
  const alternar = () => {
    saveArchivedCollapsed(!plegado);
    setPlegado(!plegado);
  };
  const esperan = entries.filter((e) => e.kind === 'session' && e.state === 'waiting').length;
  return (
    <section className="slive slive--archived" aria-labelledby={idTitulo}>
      <h3 className="slive__heading" id={idTitulo}>
        <button type="button" className="slive__head" aria-expanded={!plegado} aria-controls={idLista} onClick={alternar}>
          <IconChevron size={11} className={`recent__chevron${plegado ? '' : ' recent__chevron--open'}`} />
          <IconArchive size={12} className="slive__icon" />
          <span>{archivedHeading(entries.length)}</span>
          {plegado && esperan > 0 && (
            <span className="slive__alert">
              <StatusLight state="waiting" />
              <span className="sr-only">{esperan === 1 ? '1 te espera' : `${esperan} te esperan`}</span>
            </span>
          )}
        </button>
      </h3>
      <ul className="slive__list" id={idLista} hidden={plegado}>
        {entries.map((e) => (
          <ArchivedRow key={archivedKey(e)} entry={e} session={session} conversation={conversation} />
        ))}
      </ul>
    </section>
  );
}

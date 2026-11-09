import { useId } from 'react';
import type { ChatInfo } from '../../types.ts';
import type { PaneView } from '../../lib/workspace.ts';
import { IconChat, IconSearch, IconTerminal } from '../Icons.tsx';

const SIN_MOTIVO = 'La vista chat no está disponible en esta sesión.';

/**
 * Conmutador Terminal / Chat de la cabecera de una terminal. «Chat» sigue siendo un botón
 * enfocable cuando no está disponible (`aria-disabled`): así el motivo se lee con el teclado
 * y con el lector de pantalla, no solo con el ratón.
 */
export function ViewSwitch({ view, onView, chat, full }: { view: PaneView; onView: (v: PaneView) => void; chat: ChatInfo; full: boolean }) {
  const idMotivo = useId();
  const sinChat = !chat.available;
  return (
    <div className={`viewsw${full ? ' viewsw--full' : ''}`} role="group" aria-label="Vista de la terminal">
      <button type="button" className="viewsw__btn" aria-pressed={view === 'terminal'} onClick={() => onView('terminal')}>
        <IconTerminal size={14} />
        Terminal
      </button>
      <button
        type="button"
        className="viewsw__btn"
        aria-pressed={view === 'chat'}
        aria-disabled={sinChat || undefined}
        aria-describedby={sinChat ? idMotivo : undefined}
        onClick={() => !sinChat && onView('chat')}
      >
        <IconChat size={14} />
        Chat
      </button>
      {sinChat && (
        <span id={idMotivo} role="tooltip" className="viewsw__tip">
          {chat.reason ?? SIN_MOTIVO}
        </span>
      )}
    </div>
  );
}

/** Botón de la lupa: abre y cierra la búsqueda en la conversación. */
export function SearchButton({ active, onClick, full }: { active: boolean; onClick: () => void; full: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--box chatsearch-btn${full ? ' chatsearch-btn--full' : ''}`}
      aria-label="Buscar en la conversación (Ctrl+F)"
      aria-pressed={active}
      onClick={onClick}
    >
      <IconSearch size={15} />
    </button>
  );
}

import { AGENTS } from '../../shared/settings-schema.ts';
import { AGENT_CHOICES, AGENT_PRODUCTS } from '../lib/sessions.ts';
import { useSettings } from '../state/SettingsContext.tsx';
import { Disclosure } from './Disclosure.tsx';
import { IconChevron, IconTerminal } from './Icons.tsx';

/**
 * Agente por defecto de las sesiones nuevas (el mismo ajuste que propone el
 * diálogo «Nueva sesión»), con un menú para cambiarlo desde cualquier pantalla.
 */
export function HeaderAgent() {
  const { settings, update } = useSettings();
  const actual = settings.newSession.agent;
  return (
    <Disclosure
      wrapClassName="hdrmenu"
      buttonClassName="hdrbtn"
      label={`Agente por defecto: ${AGENT_PRODUCTS[actual]}. Cambiar`}
      title={`Agente por defecto: ${AGENT_PRODUCTS[actual]}`}
      kind="menu"
      popLabel="Agente por defecto"
      popClassName="menu__list hdrmenu__list"
      button={
        <>
          <IconTerminal size={14} strokeWidth={2} />
          <span className="hdrbtn__name">{AGENT_PRODUCTS[actual]}</span>
          <IconChevron size={12} className="hdrbtn__caret" />
        </>
      }
    >
      {(cerrar) =>
        AGENTS.map((a) => (
          <button
            key={a}
            type="button"
            role="menuitemradio"
            aria-checked={a === actual}
            className="menu__item"
            onClick={() => {
              if (a !== actual) update({ newSession: { agent: a } });
              cerrar();
            }}
          >
            <span className="menu__state">{a === 'shell' ? AGENT_CHOICES[a] : AGENT_PRODUCTS[a]}</span>
            {a === actual && (
              <span aria-hidden="true" className="hdrmenu__check">
                ✓
              </span>
            )}
          </button>
        ))
      }
    </Disclosure>
  );
}

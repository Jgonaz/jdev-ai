import { greeting } from '../../lib/time.ts';
import { useSettings } from '../../state/SettingsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { IconPlus } from '../Icons.tsx';

// Arte ASCII del diseño (estado vacío).
const ASCII = '  ( -_-)  zZ\n  /|___|\\';

/** Vacío de la zona de terminales: sin sesiones o sin terminales abiertas. */
export function EmptyState({ haySesiones }: { haySesiones: boolean }) {
  const { settings } = useSettings();
  const { openDialog } = useWorkspace();
  const { ascii, greeting: saludo } = settings.personality;

  return (
    <div className="empty" data-grid={settings.personality.grid ? 'on' : 'off'}>
      {ascii && (
        <pre className="empty__ascii" aria-hidden="true">
          {ASCII}
        </pre>
      )}
      {saludo && <p className="empty__greeting">{greeting(new Date())}.</p>}
      <h2 className="empty__title">{haySesiones ? 'No hay ninguna terminal abierta' : 'Todavía no hay sesiones'}</h2>
      <p className="empty__text">
        {haySesiones
          ? 'Elige una sesión en la barra lateral o crea una nueva.'
          : 'Las sesiones viven en tmux y siguen vivas aunque cierres el panel. Crea la primera para empezar.'}
      </p>
      <button type="button" className="btn btn--accent btn--lg" onClick={openDialog}>
        <IconPlus size={14} />
        {haySesiones ? 'Nueva sesión' : 'Crear la primera sesión'}
      </button>
    </div>
  );
}

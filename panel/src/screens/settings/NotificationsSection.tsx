import { useState } from 'react';
import { CheckRow } from '../../components/controls.tsx';
import { playTick } from '../../lib/alerts.ts';
import { useSettings } from '../../state/SettingsContext.tsx';

type Permiso = NotificationPermission | 'unsupported';

function permisoActual(): Permiso {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function NotificationsSection() {
  const { settings, update } = useSettings();
  const n = settings.notifications;
  const [permiso, setPermiso] = useState<Permiso>(permisoActual);

  const pedirPermiso = async () => {
    if (typeof Notification === 'undefined') return;
    try {
      setPermiso(await Notification.requestPermission());
    } catch {
      setPermiso(permisoActual());
    }
  };

  const alCambiarSistema = (v: boolean) => {
    update({ notifications: { system: v } });
    // El permiso solo puede pedirse desde un gesto de la persona: este clic lo es.
    if (v && permiso === 'default') void pedirPermiso();
  };

  return (
    <section id="avisos" className="set-section" aria-labelledby="h-avisos">
      <div className="set-section__intro">
        <h2 id="h-avisos" className="set-h2">
          Avisos
        </h2>
        <p className="set-lead">Cuando una sesión te espera (permiso o pregunta) o termina.</p>
      </div>
      <div className="check-list">
        <CheckRow label="Notificación del sistema" checked={n.system} onChange={alCambiarSistema} />
        {n.system && (
          <p className="hint hint--indent" role="status">
            {permiso === 'granted' && 'Permiso concedido. Solo se notifica cuando el panel no tiene el foco.'}
            {permiso === 'denied' && 'El navegador bloquea las notificaciones de este sitio. Actívalas en su configuración para que lleguen.'}
            {permiso === 'unsupported' && 'Este navegador no admite notificaciones del sistema.'}
            {permiso === 'default' && (
              <>
                Falta el permiso del navegador.{' '}
                <button type="button" className="link-btn" onClick={() => void pedirPermiso()}>
                  Pedir permiso
                </button>
              </>
            )}
          </p>
        )}
        <CheckRow label="Contador en el título de la pestaña: «(1) jdev-ai»" checked={n.counter} onChange={(v) => update({ notifications: { counter: v } })} />
        <CheckRow
          label="Sonido corto («tic» de teletipo)"
          checked={n.sound}
          onChange={(v) => {
            update({ notifications: { sound: v } });
            if (v) playTick();
          }}
        />
        <CheckRow label="Avisar también cuando una sesión termina" checked={n.onFinish} onChange={(v) => update({ notifications: { onFinish: v } })} />
      </div>
    </section>
  );
}

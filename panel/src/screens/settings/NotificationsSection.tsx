import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { CheckRow } from '../../components/controls.tsx';
import { SOUND_OPTIONS, playSound, windowsSoundFile, windowsSoundId, windowsSoundLabel } from '../../lib/sounds.ts';
import type { SoundId } from '../../lib/sounds.ts';
import { useSettings } from '../../state/SettingsContext.tsx';

type Permiso = NotificationPermission | 'unsupported';

function permisoActual(): Permiso {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function NotificationsSection() {
  const { settings, update } = useSettings();
  const n = settings.notifications;
  const [permiso, setPermiso] = useState<Permiso>(permisoActual);
  // Sonidos de Windows (C:\Windows\Media): solo en WSL; fuera, la lista llega vacía.
  const [windows, setWindows] = useState<string[]>([]);
  useEffect(() => {
    if (!n.sound) return;
    let vivo = true;
    api
      .windowsSounds()
      .then((r) => vivo && setWindows(r.windows))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [n.sound]);

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
        <CheckRow label="Avisar también cuando una sesión termina" checked={n.onFinish} onChange={(v) => update({ notifications: { onFinish: v } })} />
        <CheckRow
          label="Sonido"
          checked={n.sound}
          onChange={(v) => {
            update({ notifications: { sound: v } });
            if (v) playSound(n.soundWaiting);
          }}
        />
        {n.sound && (
          <div className="sound-fields">
            <SoundField
              label="Cuando una sesión te espera"
              value={n.soundWaiting}
              windows={windows}
              onChange={(v) => update({ notifications: { soundWaiting: v } })}
            />
            {n.onFinish && (
              <SoundField
                label="Cuando una sesión termina"
                value={n.soundFinish}
                windows={windows}
                onChange={(v) => update({ notifications: { soundFinish: v } })}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Selector de sonido: los del panel y, en WSL, los de Windows. Suena al elegirlo y se puede volver a oír. */
function SoundField(props: { label: string; value: SoundId; windows: readonly string[]; onChange: (v: SoundId) => void }) {
  const id = useId();
  const actual = windowsSoundFile(props.value);
  // Un .wav elegido que ya no está en la carpeta se sigue mostrando para no perder el ajuste.
  const deWindows = actual !== null && !props.windows.includes(actual) ? [...props.windows, actual] : props.windows;
  // Aviso breve si un .wav de Windows no suena (ya no existe, es demasiado grande o no se puede leer).
  const [fallo, setFallo] = useState(false);
  const temporizador = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(temporizador.current), []);
  const reproducir = (v: SoundId) => {
    window.clearTimeout(temporizador.current);
    setFallo(false);
    playSound(v, () => {
      setFallo(true);
      window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => setFallo(false), 5000);
    });
  };
  return (
    <div className="sound-field">
      <div className="field">
        <label htmlFor={id}>{props.label}</label>
        <select
          id={id}
          className="input"
          value={props.value}
          onChange={(e) => {
            const v = e.target.value as SoundId;
            props.onChange(v);
            reproducir(v);
          }}
        >
          <optgroup label="Del panel">
            {SOUND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
          {deWindows.length > 0 && (
            <optgroup label="De Windows">
              {deWindows.map((archivo) => (
                <option key={archivo} value={windowsSoundId(archivo)}>
                  {windowsSoundLabel(archivo)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => reproducir(props.value)} aria-label={`Probar el sonido: ${props.label.toLowerCase()}`}>
        Probar
      </button>
      {fallo && (
        <span className="field__note sound-field__error" role="status">
          No se pudo reproducir este sonido.
        </span>
      )}
    </div>
  );
}

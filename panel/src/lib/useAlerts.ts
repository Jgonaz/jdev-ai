import { useEffect, useRef } from 'react';
import { useSessions } from '../state/SessionsContext.tsx';
import { useSettings } from '../state/SettingsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { VisualState } from '../types.ts';
import { detectAlerts, documentTitle, stateMap } from './alerts.ts';
import { playSound } from './sounds.ts';
import type { SoundId } from './sounds.ts';
import { waitingCount } from './sessions.ts';

/** Avisos: contador en el título, notificación del sistema y sonido. */
export function useAlerts(alAbrirSesion: () => void): void {
  const { sessions, loaded } = useSessions();
  const { settings } = useSettings();
  const { openSession } = useWorkspace();
  const previo = useRef<Map<string, VisualState> | null>(null);
  const ajustes = useRef(settings.notifications);
  ajustes.current = settings.notifications;

  const esperan = waitingCount(sessions);
  useEffect(() => {
    document.title = documentTitle(esperan, settings.notifications.counter);
  }, [esperan, settings.notifications.counter]);

  useEffect(() => {
    if (!loaded) return;
    const eventos = detectAlerts(previo.current, sessions);
    previo.current = stateMap(sessions);
    const cfg = ajustes.current;
    // Varios avisos a la vez suenan una sola vez: el de «te espera» manda.
    let sonido: SoundId | null = null;
    for (const ev of eventos) {
      if (ev.kind === 'finished' && !cfg.onFinish) continue;
      const s = sessions.find((x) => x.name === ev.name);
      if (!s) continue;
      if (cfg.sound && (sonido === null || ev.kind === 'waiting')) sonido = ev.kind === 'waiting' ? cfg.soundWaiting : cfg.soundFinish;
      const sinFoco = document.hidden || !document.hasFocus();
      if (cfg.system && sinFoco && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(ev.kind === 'waiting' ? 'Te espera una sesión' : 'Una sesión ha terminado', {
            body: `${s.title} · ${s.project}`,
            tag: `jdev-${s.name}`,
          });
          n.onclick = () => {
            window.focus();
            openSession(s.name);
            alAbrirSesion();
            n.close();
          };
        } catch {
          // Algunos navegadores solo permiten notificaciones desde un service worker.
        }
      }
    }
    if (sonido !== null) playSound(sonido);
  }, [sessions, loaded, openSession, alAbrirSesion]);
}

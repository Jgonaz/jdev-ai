import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { DEFAULT_SETTINGS } from '../../shared/settings-schema.ts';
import { applyPatch, mergePatches } from '../lib/settingsPatch.ts';
import type { Patch, SettingsPatch } from '../lib/settingsPatch.ts';
import { appearanceAttrs, applyAppearance } from '../lib/theme.ts';
import type { Settings } from '../types.ts';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type SettingsValue = {
  settings: Settings;
  loaded: boolean;
  loadError: string | null;
  saveState: SaveState;
  saveError: string | null;
  /** Clave que cambia cuando cambia el aspecto (tema, acento, fuentes): las terminales la usan para repintarse. */
  appearanceKey: string;
  update: (parche: SettingsPatch) => void;
  reset: () => void;
};

const Ctx = createContext<SettingsValue | null>(null);

const GUARDADO_MS = 500;

function useSystemLight(): boolean {
  const consulta = useMemo(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null),
    [],
  );
  const [claro, setClaro] = useState(consulta?.matches ?? false);
  useEffect(() => {
    if (!consulta) return;
    const alCambiar = (e: MediaQueryListEvent) => setClaro(e.matches);
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, [consulta]);
  return claro;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const sistemaClaro = useSystemLight();

  const pendiente = useRef<Patch | null>(null);
  const temporizador = useRef<number | null>(null);
  const guardando = useRef(false);
  const actual = useRef(settings);
  actual.current = settings;
  // Cambia con cada edición local: una recarga que empezó antes se descarta.
  const edicion = useRef(0);

  useEffect(() => {
    let cancelado = false;
    api
      .settings()
      .then((s) => {
        if (cancelado) return;
        setSettings(s);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoaded(true);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // No hay aviso de ajustes entre pestañas: al volver a la ventana se releen,
  // salvo con cambios propios por guardar, para que otra pestaña (p. ej. la
  // visibilidad de un proyecto) se refleje aquí.
  useEffect(() => {
    let enCurso = false;
    const alVolver = () => {
      if (document.visibilityState !== 'visible' || enCurso) return;
      if (pendiente.current !== null || guardando.current) return;
      enCurso = true;
      const n = edicion.current;
      api
        .settings()
        .then((s) => {
          if (n !== edicion.current || pendiente.current !== null || guardando.current) return;
          setSettings((previos) => (JSON.stringify(previos) === JSON.stringify(s) ? previos : s));
        })
        .catch(() => {
          // Sin conexión se siguen usando los ajustes que ya había.
        })
        .finally(() => {
          enCurso = false;
        });
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, []);

  // Se aplica antes de los efectos de los hijos para que las terminales lean ya las variables nuevas.
  useLayoutEffect(() => {
    applyAppearance(document.documentElement, settings, sistemaClaro);
  }, [settings, sistemaClaro]);

  const appearanceKey = useMemo(() => {
    const attrs = appearanceAttrs(settings, sistemaClaro);
    return [attrs['data-theme'], attrs['data-accent'], settings.fonts.terminal, settings.sizes.ui].join('|');
  }, [settings, sistemaClaro]);

  const volcar = useCallback(async () => {
    if (guardando.current || pendiente.current === null) return;
    const parche = pendiente.current;
    pendiente.current = null;
    guardando.current = true;
    setSaveState('saving');
    try {
      const guardado = await api.saveSettings(parche as SettingsPatch);
      setSaveError(null);
      if (pendiente.current === null) {
        // Sin cambios nuevos por el camino: lo que devuelve el servidor es la verdad.
        setSettings(guardado);
        setSaveState('saved');
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveState('error');
    } finally {
      guardando.current = false;
      if (pendiente.current !== null) {
        temporizador.current = window.setTimeout(() => void volcar(), GUARDADO_MS);
      }
    }
  }, []);

  const programar = useCallback(
    (parche: SettingsPatch) => {
      pendiente.current = mergePatches(pendiente.current ?? {}, parche as Patch);
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => {
        temporizador.current = null;
        void volcar();
      }, GUARDADO_MS);
    },
    [volcar],
  );

  const update = useCallback(
    (parche: SettingsPatch) => {
      edicion.current++;
      setSettings((s) => applyPatch(s, parche));
      setSaveState('saving');
      programar(parche);
    },
    [programar],
  );

  const reset = useCallback(() => {
    // Los overrides de proyecto se borran con null; el resto vuelve al valor por defecto.
    const proyectos: Record<string, null> = {};
    for (const id of Object.keys(actual.current.projects)) proyectos[id] = null;
    update({ ...structuredClone(DEFAULT_SETTINGS), projects: proyectos });
  }, [update]);

  // Al cerrar la pestaña se intenta volcar lo pendiente.
  useEffect(() => {
    const alSalir = () => {
      if (pendiente.current !== null) {
        void fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendiente.current),
          keepalive: true,
        });
      }
    };
    window.addEventListener('pagehide', alSalir);
    return () => window.removeEventListener('pagehide', alSalir);
  }, []);

  const valor = useMemo<SettingsValue>(
    () => ({ settings, loaded, loadError, saveState, saveError, appearanceKey, update, reset }),
    [settings, loaded, loadError, saveState, saveError, appearanceKey, update, reset],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings fuera de SettingsProvider');
  return v;
}

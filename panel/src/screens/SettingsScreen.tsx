import { useEffect, useRef, useState } from 'react';
import { ResizeHandle } from '../components/ResizeHandle.tsx';
import type { PanelLimits } from '../lib/panelWidth.ts';
import { usePanelWidth } from '../lib/usePanelWidth.ts';
import { useSettings } from '../state/SettingsContext.tsx';
import { Appearance } from './settings/Appearance.tsx';
import { AgentsSection } from './settings/AgentsSection.tsx';
import { NotificationsSection } from './settings/NotificationsSection.tsx';
import { ProjectsSection } from './settings/ProjectsSection.tsx';
import { ServerSection } from './settings/ServerSection.tsx';
import { ShortcutsSection } from './settings/ShortcutsSection.tsx';
import { TerminalSection } from './settings/TerminalSection.tsx';
import { Typography } from './settings/Typography.tsx';

const SECCIONES = [
  { id: 'apariencia', label: 'Apariencia' },
  { id: 'tipografia', label: 'Tipografía' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'proyectos', label: 'Proyectos' },
  { id: 'avisos', label: 'Avisos' },
  { id: 'agentes', label: 'Agentes' },
  { id: 'atajos', label: 'Atajos de teclado' },
  { id: 'servidor', label: 'Servidor local' },
] as const;

function SaveStatus() {
  const { saveState, saveError } = useSettings();
  return (
    <span className="save-status" role="status" aria-live="polite">
      Los cambios se guardan solos.
      {saveState === 'saving' && <span> Guardando…</span>}
      {saveState === 'saved' && <span> Guardado.</span>}
      {saveState === 'error' && <span className="save-status__error"> No se pudo guardar: {saveError}</span>}
    </span>
  );
}

const NAV_LIMITS: PanelLimits = { min: 180, max: 400, default: 230 };

export function SettingsScreen() {
  const anchoNav = usePanelWidth('ajustes-navegacion', NAV_LIMITS);
  const { reset, loaded } = useSettings();
  const [activa, setActiva] = useState<string>(SECCIONES[0].id);
  const [confirmar, setConfirmar] = useState(false);
  const principal = useRef<HTMLElement>(null);

  // La sección activa del menú sigue al desplazamiento.
  useEffect(() => {
    const main = principal.current;
    if (!main) return;
    const alDesplazar = () => {
      const limite = main.getBoundingClientRect().top + 120;
      let actual: string = SECCIONES[0].id;
      for (const s of SECCIONES) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= limite) actual = s.id;
      }
      if (main.scrollTop + main.clientHeight >= main.scrollHeight - 4) actual = SECCIONES[SECCIONES.length - 1]!.id;
      setActiva(actual);
    };
    main.addEventListener('scroll', alDesplazar, { passive: true });
    return () => main.removeEventListener('scroll', alDesplazar);
  }, []);

  const ir = (id: string) => {
    const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' });
    setActiva(id);
  };

  return (
    <div className="screen screen--settings">
      <nav className="setnav" aria-label="Secciones de ajustes" style={anchoNav.style('--setnav-w')}>
        <span className="label-mono setnav__title">~/ajustes</span>
        {SECCIONES.map((s) => (
          <button key={s.id} type="button" className="setnav__link" aria-current={activa === s.id ? 'true' : undefined} onClick={() => ir(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      <ResizeHandle side="left" limits={NAV_LIMITS} panel={anchoNav} label="Ancho de la navegación de ajustes" />
      <main className="setmain" ref={principal}>
        <div className="setmain__inner">
          {!loaded && <p className="hint">Cargando ajustes…</p>}
          <Appearance />
          <Typography />
          <TerminalSection />
          <ProjectsSection />
          <NotificationsSection />
          <AgentsSection />
          <ShortcutsSection />
          <ServerSection />
          <div className="set-footer">
            <SaveStatus />
            {confirmar ? (
              <span className="set-footer__confirm">
                <span>¿Restablecer todos los ajustes?</span>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmar(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => {
                    reset();
                    setConfirmar(false);
                  }}
                >
                  Restablecer
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn--ghost set-footer__reset" onClick={() => setConfirmar(true)}>
                Restablecer valores por defecto
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

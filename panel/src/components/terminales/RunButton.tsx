import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { api } from '../../api.ts';
import { runSessionOf } from '../../lib/sessions.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import type { ProjectInfo } from '../../types.ts';
import { IconPlay, IconStop } from '../Icons.tsx';

/** Cuánto se queda a la vista el aviso de un fallo. */
const ERROR_MS = 6000;

export const NO_RUN_HINT = 'Configura el comando de arranque en Ajustes › Proyectos';

/** Lleva a Ajustes y baja hasta «Proyectos» (la pantalla de Ajustes se monta tras el cambio de ruta). */
function irAProyectos() {
  window.setTimeout(() => document.getElementById('proyectos')?.scrollIntoView({ block: 'start' }), 120);
}

/**
 * ▶ / ■ de cada proyecto, junto al «+»: arranca su comando de arranque en una
 * terminal sin agente y la abre, o la para (Ctrl+C y terminar la sesión) mientras
 * siga viva. Sin comando es un enlace desactivado que lleva a Ajustes › Proyectos.
 */
export function RunButton({ project }: { project: ProjectInfo }) {
  const { sessions, upsert } = useSessions();
  const { openSession } = useWorkspace();
  const [ocupado, setOcupado] = useState<'arrancando' | 'parando' | null>(null);
  const [error, setError] = useState<{ texto: string; x: number; y: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const viva = runSessionOf(sessions, project.id);
  // `?? null`: un servidor anterior al botón no manda estos campos.
  const comando = viva?.run ?? project.runCommand ?? null;

  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), ERROR_MS);
    const cerrar = () => setError(null);
    window.addEventListener('pointerdown', cerrar, true);
    window.addEventListener('keydown', cerrar, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pointerdown', cerrar, true);
      window.removeEventListener('keydown', cerrar, true);
    };
  }, [error]);

  if (!viva && comando === null) {
    return (
      <a className="group__add group__run group__run--off" href="#/ajustes" aria-label={`Sin comando de arranque en ${project.name}. ${NO_RUN_HINT}`} title={NO_RUN_HINT} onClick={irAProyectos}>
        <IconPlay size={12} />
      </a>
    );
  }

  const alPulsar = async (e: MouseEvent) => {
    e.stopPropagation();
    if (ocupado) return;
    setError(null);
    setOcupado(viva ? 'parando' : 'arrancando');
    try {
      if (viva) {
        await api.stopProject(project.id);
      } else {
        const r = await api.startProject(project.id);
        upsert(r.session);
        openSession(r.session.name);
      }
    } catch (err) {
      const r = boton.current?.getBoundingClientRect();
      setError({ texto: err instanceof Error ? err.message : 'No se pudo completar la acción.', x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4 });
    } finally {
      setOcupado(null);
    }
  };

  const etiqueta = ocupado === 'arrancando' ? `Arrancando ${project.name}…` : ocupado === 'parando' ? `Parando ${project.name}…` : viva ? `Parar ${comando} en ${project.name}` : `Arrancar ${comando} en ${project.name}`;
  return (
    <>
      <button
        ref={boton}
        type="button"
        className={`group__add group__run${viva ? ' group__run--on' : ''}${ocupado ? ' group__run--busy' : ''}`}
        aria-label={etiqueta}
        aria-busy={ocupado ? true : undefined}
        title={etiqueta}
        disabled={ocupado !== null}
        onClick={(e) => void alPulsar(e)}
      >
        {ocupado ? <span className="group__spin" aria-hidden="true" /> : viva ? <IconStop size={11} /> : <IconPlay size={12} />}
      </button>
      {error && (
        <div className="ctxmenu__error" role="alert" style={{ left: error.x, top: error.y }}>
          {error.texto}
        </div>
      )}
    </>
  );
}

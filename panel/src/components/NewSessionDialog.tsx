import { useEffect, useId, useMemo, useState } from 'react';
import { ApiError, api } from '../api.ts';
import { AGENT_CHOICES, SHELL_AGENT } from '../lib/sessions.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import { useSettings } from '../state/SettingsContext.tsx';
import { useWorkspace } from '../state/WorkspaceContext.tsx';
import type { AgentId, LocationId, ProjectInfo, SessionRequest } from '../types.ts';
import { ownerSession } from '../lib/follow.ts';
import { IconTerminal } from './Icons.tsx';
import { Modal } from './Modal.tsx';
import { useRadioGroup } from './useRadioGroup.ts';

const AGENTES: AgentId[] = ['claude', 'codex', 'copilot', 'opencode', 'shell'];
const PREVIEW_MS = 250;

type Preview =
  | { estado: 'pendiente' }
  | { estado: 'incompleto'; texto: string }
  | { estado: 'ok'; comando: string }
  | { estado: 'error'; mensaje: string };

/** Proyecto que se propone al abrir: el de la terminal activa o el primero que no sea el harness. */
function proyectoInicial(projects: readonly ProjectInfo[], activo: string | undefined): string {
  if (activo && projects.some((p) => p.id === activo)) return activo;
  return (projects.find((p) => !p.harness) ?? projects[0])?.id ?? '';
}

export function NewSessionDialog({ onCreated }: { onCreated: () => void }) {
  const { settings } = useSettings();
  const { projects, sessions, upsert } = useSessions();
  const { workspace, closeDialog, openSession, newSessionInit: init } = useWorkspace();
  const idProyecto = useId();
  const idPrompt = useId();
  const idAgente = useId();
  const idLugar = useId();

  const activa = sessions.find((s) => s.name === ownerSession(workspace.active));
  // Los valores iniciales (desde Proyectos) mandan sobre la terminal activa y los ajustes.
  const sugerido = init?.project ?? activa?.project;
  const [proyecto, setProyecto] = useState(() => proyectoInicial(projects, sugerido));
  // Si los proyectos llegan después de abrir el diálogo, se propone el que corresponde.
  const proyectoId = projects.some((p) => p.id === proyecto) ? proyecto : proyectoInicial(projects, sugerido);
  // Con un prompt de partida (p. ej. «Trabajar en esto» del backlog) se necesita un agente: una terminal no lo admite.
  const [agente, setAgente] = useState<AgentId>(
    init?.agent ?? (settings.newSession.agent === SHELL_AGENT && init?.prompt ? 'claude' : settings.newSession.agent),
  );
  const [lugar, setLugar] = useState<LocationId>(
    init?.location ?? (settings.newSession.location === 'worktree-nuevo' ? 'new-worktree' : 'main'),
  );
  const [feature, setFeature] = useState('');
  const [existente, setExistente] = useState(init?.worktree ?? '');
  const [prompt, setPrompt] = useState(init?.prompt ?? '');
  const [junto, setJunto] = useState(true);
  const [preview, setPreview] = useState<Preview>({ estado: 'pendiente' });
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const actual = projects.find((p) => p.id === proyectoId);
  const admiteWorktree = actual !== undefined && !actual.harness;
  const worktrees = actual?.worktrees ?? [];
  // Una terminal sin agente no crea worktrees ni admite prompt: solo abre una shell en una carpeta.
  const esTerminal = agente === SHELL_AGENT;

  // Si el proyecto no admite worktrees (el harness), o una terminal pide uno nuevo, se vuelve al checkout principal.
  const lugarEfectivo: LocationId = admiteWorktree && !(esTerminal && lugar === 'new-worktree') ? lugar : 'main';
  const existenteEfectivo = worktrees.some((w) => w.name === existente) ? existente : (worktrees[0]?.name ?? '');

  const opcionesAgente = AGENTES.map((a) => ({ value: a }));
  const grupoAgente = useRadioGroup<AgentId>(opcionesAgente, agente, setAgente);
  const opcionesLugar: { value: LocationId; disabled?: boolean }[] = [{ value: 'main' }];
  if (admiteWorktree) {
    if (!esTerminal) opcionesLugar.push({ value: 'new-worktree' });
    opcionesLugar.push({ value: 'existing-worktree', disabled: worktrees.length === 0 });
  }
  const grupoLugar = useRadioGroup<LocationId>(opcionesLugar, lugarEfectivo, setLugar);

  const peticion = useMemo<SessionRequest | null>(() => {
    if (!actual) return null;
    const base: SessionRequest = { project: actual.id, agent: agente, location: lugarEfectivo };
    if (lugarEfectivo === 'new-worktree') base.feature = feature.trim();
    if (lugarEfectivo === 'existing-worktree') base.feature = existenteEfectivo;
    if (!esTerminal && prompt.trim() !== '') base.prompt = prompt;
    return base;
  }, [actual, agente, esTerminal, lugarEfectivo, feature, existenteEfectivo, prompt]);

  // Vista previa con debounce; la valida el servidor, que es quien conoce las reglas de bin/agent.
  useEffect(() => {
    if (!peticion) {
      setPreview({ estado: 'incompleto', texto: 'No hay proyectos disponibles.' });
      return;
    }
    if (peticion.location === 'new-worktree' && !peticion.feature) {
      setPreview({ estado: 'incompleto', texto: 'Escribe el nombre de la feature para ver el comando.' });
      return;
    }
    if (peticion.location === 'existing-worktree' && !peticion.feature) {
      setPreview({ estado: 'incompleto', texto: 'Este proyecto no tiene worktrees abiertos.' });
      return;
    }
    setPreview({ estado: 'pendiente' });
    const control = new AbortController();
    const t = window.setTimeout(() => {
      api
        .previewSession(peticion, control.signal)
        .then((r) => setPreview({ estado: 'ok', comando: r.command }))
        .catch((e: unknown) => {
          if (control.signal.aborted) return;
          setPreview({ estado: 'error', mensaje: e instanceof ApiError ? e.message : 'No se pudo calcular el comando.' });
        });
    }, PREVIEW_MS);
    return () => {
      window.clearTimeout(t);
      control.abort();
    };
  }, [peticion]);

  const puedeAbrir = peticion !== null && preview.estado === 'ok' && !enviando;

  const abrir = async () => {
    if (!peticion || !puedeAbrir) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const r = await api.createSession(peticion);
      upsert(r.session);
      const junta = junto && workspace.active !== null;
      openSession(r.session.name, junta ? { nextToActive: true, minLayout: 2 } : undefined);
      closeDialog();
      onCreated();
    } catch (e) {
      setErrorEnvio(e instanceof Error ? e.message : String(e));
      setEnviando(false);
    }
  };

  return (
    <Modal
      title="Nueva sesión"
      onClose={closeDialog}
      initialFocus="select"
      footer={
        <>
          <label className="check check--footer">
            <input type="checkbox" checked={junto} onChange={(e) => setJunto(e.target.checked)} />
            Abrir junto a la terminal activa
          </label>
          <button type="button" className="btn btn--ghost btn--lg footer-push" onClick={closeDialog}>
            Cancelar
          </button>
          <button type="button" className="btn btn--accent btn--lg" disabled={!puedeAbrir} onClick={() => void abrir()}>
            <IconTerminal size={14} />
            {enviando ? 'Abriendo…' : 'Abrir terminal'}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void abrir();
        }}
      >
        <div className="field">
          <label htmlFor={idProyecto}>Proyecto</label>
          <select id={idProyecto} className="input" value={proyectoId} onChange={(e) => setProyecto(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.harness ? `${p.name} (harness)` : p.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="fieldset">
          <legend id={idAgente} className="field__label">
            Agente
          </legend>
          <div className="agent-grid" aria-labelledby={idAgente} {...grupoAgente.groupProps}>
            {AGENTES.map((a) => (
              <button key={a} type="button" className={`choice${a === SHELL_AGENT ? ' choice--wide' : ''}`} {...grupoAgente.radioProps({ value: a })}>
                {AGENT_CHOICES[a]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="fieldset fieldset--gap8" aria-labelledby={idLugar} {...grupoLugar.groupProps}>
          <legend id={idLugar} className="field__label">
            Dónde trabaja
          </legend>
          <PlaceOption
            radio={grupoLugar.radioProps({ value: 'main' })}
            label="Checkout principal"
            hint={
              esTerminal
                ? 'Abre la shell en la carpeta del proyecto.'
                : actual?.branch
                  ? `Trabaja directamente sobre la rama ${actual.branch} del proyecto.`
                  : 'Trabaja directamente sobre la rama actual del proyecto.'
            }
          />
          {admiteWorktree && (
            <>
              {!esTerminal && (
                <PlaceOption
                  radio={grupoLugar.radioProps({ value: 'new-worktree' })}
                  label="Worktree nuevo"
                  hint="Crea la rama y su worktree aislado con bin/worktree."
                />
              )}
              {lugarEfectivo === 'new-worktree' && (
                <label className="prefixed">
                  <span className="prefixed__prefix">feat/</span>
                  <input
                    type="text"
                    className="prefixed__input"
                    value={feature}
                    onChange={(e) => setFeature(e.target.value)}
                    aria-label="Nombre de la feature"
                    placeholder="nombre-de-la-feature"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              )}
              <PlaceOption
                radio={grupoLugar.radioProps({ value: 'existing-worktree', disabled: worktrees.length === 0 })}
                label="Worktree existente"
                hint={
                  worktrees.length > 0
                    ? esTerminal
                      ? 'Abre la shell en un worktree ya abierto de este proyecto.'
                      : 'Retoma un worktree ya abierto de este proyecto.'
                    : 'Este proyecto no tiene worktrees abiertos.'
                }
              />
              {lugarEfectivo === 'existing-worktree' && worktrees.length > 0 && (
                <select
                  className="input input--mono existing-select"
                  aria-label="Worktree existente"
                  value={existenteEfectivo}
                  onChange={(e) => setExistente(e.target.value)}
                >
                  {worktrees.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.branch ?? `feat/${w.name}`}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {!admiteWorktree && actual && (
            <p className="hint">El propio harness no admite worktrees: trabaja siempre sobre su checkout principal.</p>
          )}
        </fieldset>

        {esTerminal ? (
          <p className="hint">Terminal sin agente: una shell normal para lanzar comandos o servidores. No admite prompt inicial.</p>
        ) : (
          <div className="field">
            <label htmlFor={idPrompt}>
              Prompt inicial <span className="field__note">Opcional. Se pasa a la sesión como primer mensaje.</span>
            </label>
            <textarea
              id={idPrompt}
              className="input input--area"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <span className="field__note">{esTerminal ? 'Se abrirá en una sesión de tmux' : 'Se ejecutará en una sesión de tmux'}</span>
          <div className={`command command--${preview.estado}`} aria-live="polite">
            {preview.estado === 'ok' && <code>{preview.comando}</code>}
            {preview.estado === 'pendiente' && <span className="command__msg">Calculando el comando…</span>}
            {preview.estado === 'incompleto' && <span className="command__msg">{preview.texto}</span>}
            {preview.estado === 'error' && (
              <span className="command__msg command__msg--error" role="alert">
                {preview.mensaje}
              </span>
            )}
          </div>
          {errorEnvio && (
            <p className="form-error" role="alert">
              {errorEnvio}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}

function PlaceOption(props: { radio: ReturnType<ReturnType<typeof useRadioGroup<LocationId>>['radioProps']>; label: string; hint: string }) {
  return (
    <button type="button" className="place" {...props.radio}>
      <span className="place__radio" aria-hidden="true" />
      <span className="place__text">
        <span className="place__label">{props.label}</span>
        <span className="place__hint">{props.hint}</span>
      </span>
    </button>
  );
}

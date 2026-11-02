import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  agoLabel,
  atBottom,
  clipMessage,
  finalMessage,
  followAfterScroll,
  noDataReason,
  parseFollowKey,
  resultNote,
  shellLines,
  statusLabel,
} from '../../lib/follow.ts';
import type { AgentStep } from '../../lib/follow.ts';
import { useFollow } from '../../lib/useFollow.ts';
import { useNow } from '../../lib/useNow.ts';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';

function Step({ paso, pendiente }: { paso: AgentStep; pendiente: boolean }) {
  if (paso.kind === 'message') return <div className="fv__msg">{clipMessage(paso.text)}</div>;
  const r = paso.result;
  if (!r && pendiente) {
    return (
      <div className="fv__step fv__step--pending">
        <span className="light light--working" aria-hidden="true" />
        <span className="fv__pending">
          {paso.verb} {paso.target}…
        </span>
      </div>
    );
  }
  const nota = r ? resultNote(paso.tool, r) : { inline: null, below: null };
  return (
    <>
      <div className={`fv__step${r?.error ? ' fv__step--error' : ''}`}>
        <span className="fv__bullet" aria-hidden="true">
          ●
        </span>
        <span className="fv__line">
          <span className="fv__verb">{paso.verb}</span>
          {paso.target !== '' && <span className="fv__target"> {paso.target}</span>}
          {paso.detail && <span className="fv__muted"> {paso.detail}</span>}
          {nota.inline && <span className={r?.error ? 'fv__fail' : 'fv__muted'}> · {nota.inline}</span>}
        </span>
      </div>
      {nota.below && <div className={`fv__result${r?.error ? ' fv__result--error' : ''}`}>{nota.below}</div>}
    </>
  );
}

/**
 * Pestaña de seguimiento de solo lectura de un subagente o una shell en segundo
 * plano de una sesión del panel (diseño «Seguimiento»). Todo lo que viene de
 * Claude se pinta como texto, nunca como HTML.
 */
export function FollowPane({ tabKey }: { tabKey: string }) {
  const objetivo = parseFollowKey(tabKey);
  const { sessions } = useSessions();
  const { workspace, activate, openSession } = useWorkspace();
  const e = useFollow(tabKey);
  const ahora = useNow(1000);
  const [seguir, setSeguir] = useState(true);
  const cuerpo = useRef<HTMLDivElement>(null);
  const activa = workspace.active === tabKey;
  const sesion = sessions.find((s) => s.name === objetivo?.session);
  const esAgente = objetivo?.kind === 'agent';

  const lineas = useMemo(() => (esAgente ? [] : shellLines(e.shell)), [esAgente, e.shell]);
  const final = esAgente ? finalMessage(e.agent.steps, e.state) : -1;

  // Con «Seguir al final» marcado, baja hasta el final cuando el contenido crece. Solo si crece: que la
  // persona expanda el encargo, por ejemplo, no debe llevarla abajo. Sus propios scrolls se ignoran en
  // onScroll durante un instante, para no confundirlos con los de la persona.
  const alturaVista = useRef(0);
  const programatico = useRef(0);
  useLayoutEffect(() => {
    const el = cuerpo.current;
    if (!el) return;
    const creció = el.scrollHeight !== alturaVista.current;
    alturaVista.current = el.scrollHeight;
    if (seguir && (creció || !atBottom(el))) {
      programatico.current = performance.now() + 150;
      el.scrollTop = el.scrollHeight;
    }
  });

  if (!objetivo) return null;

  const titulo = esAgente
    ? (e.meta?.description ?? sesion?.activity?.subagents.find((s) => s.id === objetivo.id)?.type ?? e.meta?.agentType ?? 'Subagente')
    : (e.meta?.command || sesion?.activity?.shells.find((s) => s.id === objetivo.id)?.label || 'Shell en segundo plano');
  const tipo = e.meta?.agentType || sesion?.activity?.subagents.find((s) => s.id === objetivo.id)?.type || 'subagente';
  const sinDatos = e.state === null && e.error !== null;
  const estado = statusLabel(objetivo.kind, e.state, e.meta, ahora, sinDatos);
  const hayContenido = esAgente ? e.agent.task !== null || e.agent.steps.length > 0 : lineas.length > 0;

  return (
    <section
      id={`pane-${tabKey}`}
      className={`pane pane--follow${activa ? ' pane--active' : ''}`}
      role="tabpanel"
      aria-labelledby={`tab-${tabKey}`}
      aria-label={esAgente ? `Seguimiento del subagente ${titulo}` : `Salida de la shell ${titulo}`}
      onMouseDownCapture={() => !activa && activate(tabKey)}
      onFocusCapture={() => !activa && activate(tabKey)}
    >
      <div className="pane__head fv__head">
        <div className="pane__row">
          <span className={`fv__title${esAgente ? '' : ' fv__title--mono'}`} title={titulo}>
            {titulo}
          </span>
          <span className={`chip${e.state === 'running' ? ' chip--working' : ''}`}>{estado}</span>
        </div>
        <div className="fv__meta">
          {esAgente ? (
            <span>
              <span className="fv__type">{tipo}</span> · subagente
            </span>
          ) : (
            <span>shell en segundo plano</span>
          )}
          <span className="fv__from">
            de{' '}
            {sesion ? (
              <button type="button" className="link-btn" onClick={() => openSession(sesion.name)} title="Ir a la sesión que lo lanzó">
                {sesion.title}
              </button>
            ) : (
              'una sesión que ya no está'
            )}
          </span>
          {esAgente ? <span>{e.agent.toolCount} {e.agent.toolCount === 1 ? 'herramienta' : 'herramientas'}</span> : <span>últimas 2 000 líneas</span>}
          <span>solo lectura</span>
        </div>
      </div>

      <div
        ref={cuerpo}
        className="fv__body"
        role="log"
        aria-live="off"
        aria-label={esAgente ? 'Actividad del subagente' : 'Salida de la shell'}
        tabIndex={0}
        // Cualquier scroll que no termine abajo lo suelta (rueda, arrastre de la barra, táctil, teclado, scrollTo).
        onScroll={(ev) => setSeguir((actual) => followAfterScroll(actual, atBottom(ev.currentTarget), performance.now() < programatico.current))}
      >
        {sinDatos ? (
          <div className="fv__empty" role="status">
            <strong>No hay datos que mostrar</strong>
            {noDataReason(e.error ?? '') !== '' && <span>{noDataReason(e.error ?? '')}</span>}
          </div>
        ) : e.state === null ? (
          <div className="fv__empty" role="status">
            Cargando…
          </div>
        ) : esAgente ? (
          <>
            {e.agent.task !== null && (
              <details className="fv__task" onToggle={(ev) => ev.currentTarget.open && setSeguir(false)}>
                <summary>Encargo</summary>
                <p>{e.agent.task}</p>
              </details>
            )}
            {e.agent.steps.map((paso, i) =>
              i === final ? (
                <section key={i} className="fv__final" aria-label="Resultado final">
                  <h3 className="fv__finalh">Resultado final</h3>
                  {/* El resultado final no se recorta a 4 000 caracteres como el resto de mensajes. */}
                  <div className="fv__finaltext">{paso.kind === 'message' ? paso.text : ''}</div>
                </section>
              ) : (
                <Step key={paso.kind === 'tool' ? paso.id : `m${i}`} paso={paso} pendiente={e.state === 'running'} />
              ),
            )}
            {!hayContenido && <div className="fv__empty">Todavía no hay actividad.</div>}
          </>
        ) : (
          <pre className="fv__out">{lineas.length > 0 ? lineas.join('\n') : 'Todavía no hay salida.'}</pre>
        )}
      </div>

      <div className="fv__foot">
        <label className="fv__follow">
          <input type="checkbox" checked={seguir} onChange={(ev) => setSeguir(ev.target.checked)} /> Seguir al final
        </label>
        {e.error !== null && e.state !== null ? (
          <span className="fv__stale" role="status">
            Sin actualizar: {e.error}
          </span>
        ) : (
          <span className="fv__ago">{agoLabel(e.lastOk, ahora)}</span>
        )}
      </div>
    </section>
  );
}

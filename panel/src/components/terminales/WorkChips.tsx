import { artifactLabel, artifactsLabel, formatClock, formatElapsed, isArtifactUrl, shellsLabel, subagentsLabel } from '../../lib/statusline.ts';
import type { WorkCounts } from '../../lib/statusline.ts';
import { useNow } from '../../lib/useNow.ts';
import type { SessionActivity } from '../../types.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { Disclosure } from '../Disclosure.tsx';
import { IconArtifact, IconShell } from '../Icons.tsx';

function Subagents({ lista, session, cerrar }: { lista: SessionActivity['subagents']; session: string; cerrar: () => void }) {
  // Solo mientras el desplegable está abierto: los segundos corren cada segundo.
  const ahora = useNow(1000);
  const { openFollow } = useWorkspace();
  return (
    <ul className="wpop__list">
      {lista.map((s) => (
        <li key={s.id}>
          {/* Seguir en directo: abre su pestaña de solo lectura (Claude no recibe clics en el modo clásico). */}
          <button
            type="button"
            className="wpop__row wpop__row--open"
            aria-label={`Seguir al subagente ${s.type} en directo`}
            onClick={() => {
              openFollow(session, 'agent', s.id);
              cerrar();
            }}
          >
            <span className="wpop__type" title={s.type}>{s.type}</span>
            <span className="wpop__what">
              {s.since === null ? 'En marcha' : `Desde las ${formatClock(s.since)}`}
            </span>
            {s.since !== null && <span className="wpop__time">{formatElapsed(ahora - s.since)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Chips del trabajo en curso de una sesión de Claude: subagentes activos, shells
 * en segundo plano y artifacts publicados, cada uno con su desplegable. En la
 * columna estrecha (`compact`) son contadores junto al título.
 */
export function WorkChips({ counts, activity, compact, session }: { counts: WorkCounts; activity: SessionActivity; compact: boolean; session: string }) {
  const { openFollow } = useWorkspace();
  const contador = (n: number, texto: string) => (compact ? String(n) : texto);
  return (
    <div className={`wchips${compact ? ' wchips--compact' : ''}`}>
      {counts.subagents > 0 && (
        <Disclosure
          wrapClassName="wchip-wrap"
          buttonClassName="wchip wchip--agents"
          label={`${subagentsLabel(counts.subagents)} activos: ver cuáles`}
          title={compact ? subagentsLabel(counts.subagents) : undefined}
          kind="dialog"
          popLabel="Subagentes activos"
          popClassName="wpop"
          button={
            <>
              <span className="light light--working" aria-hidden="true" />
              {contador(counts.subagents, subagentsLabel(counts.subagents))}
            </>
          }
        >
          {(cerrar) => <Subagents lista={activity.subagents} session={session} cerrar={cerrar} />}
        </Disclosure>
      )}
      {counts.shells > 0 && (
        <Disclosure
          wrapClassName="wchip-wrap"
          buttonClassName="wchip"
          label={`${shellsLabel(counts.shells)} en segundo plano: ver ${counts.shells === 1 ? 'cuál' : 'cuáles'}`}
          title={compact ? shellsLabel(counts.shells) : undefined}
          kind="dialog"
          popLabel="Shells en segundo plano"
          popClassName="wpop"
          button={
            <>
              <IconShell size={12} />
              {contador(counts.shells, shellsLabel(counts.shells))}
            </>
          }
        >
          {(cerrar) => (
            <>
              <ul className="wpop__list">
                {activity.shells.map((s, i) => (
                  <li key={`${i}-${s.label}`}>
                    {s.id ? (
                      <button
                        type="button"
                        className="wpop__row wpop__row--open"
                        aria-label={`Seguir en directo la shell ${s.label}`}
                        onClick={() => {
                          openFollow(session, 'shell', s.id!);
                          cerrar();
                        }}
                      >
                        <code className="wpop__cmd">{s.label}</code>
                      </button>
                    ) : (
                      <span className="wpop__row">
                        <code className="wpop__cmd">{s.label}</code>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="wpop__note">Pulsa una para seguirla en directo. Se actualizan al acabar cada turno de Claude.</p>
            </>
          )}
        </Disclosure>
      )}
      {counts.artifacts > 0 && (
        <Disclosure
          wrapClassName="wchip-wrap"
          buttonClassName="wchip"
          label={`${artifactsLabel(counts.artifacts)} ${counts.artifacts === 1 ? 'publicado' : 'publicados'} en esta sesión: ver enlaces`}
          title={compact ? artifactsLabel(counts.artifacts) : undefined}
          kind="dialog"
          popLabel="Artifacts publicados"
          popClassName="wpop"
          button={
            <>
              <IconArtifact size={12} />
              {contador(counts.artifacts, artifactsLabel(counts.artifacts))}
            </>
          }
        >
          {() => (
            <ul className="wpop__list">
              {activity.artifacts.map((a) => (
                <li key={a.url} className="wpop__row">
                  {isArtifactUrl(a.url) ? (
                    <a className="wpop__link" href={a.url} target="_blank" rel="noopener noreferrer">
                      {artifactLabel(a)}
                    </a>
                  ) : (
                    <span>{artifactLabel(a)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      )}
    </div>
  );
}

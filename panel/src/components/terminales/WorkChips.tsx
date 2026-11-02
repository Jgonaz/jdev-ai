import { artifactLabel, artifactsLabel, formatClock, formatElapsed, isArtifactUrl, shellsLabel, subagentsLabel } from '../../lib/statusline.ts';
import type { WorkCounts } from '../../lib/statusline.ts';
import { useNow } from '../../lib/useNow.ts';
import type { SessionActivity } from '../../types.ts';
import { Disclosure } from '../Disclosure.tsx';
import { IconArtifact, IconShell } from '../Icons.tsx';

function Subagents({ lista }: { lista: SessionActivity['subagents'] }) {
  // Solo mientras el desplegable está abierto: los segundos corren cada segundo.
  const ahora = useNow(1000);
  return (
    <ul className="wpop__list">
      {lista.map((s) => (
        <li key={s.id} className="wpop__row">
          <span className="wpop__type" title={s.type}>{s.type}</span>
          <span className="wpop__what">
            {s.since === null ? 'En marcha' : `Desde las ${formatClock(s.since)}`}
          </span>
          {s.since !== null && <span className="wpop__time">{formatElapsed(ahora - s.since)}</span>}
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
export function WorkChips({ counts, activity, compact }: { counts: WorkCounts; activity: SessionActivity; compact: boolean }) {
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
          {() => <Subagents lista={activity.subagents} />}
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
          {() => (
            <>
              <ul className="wpop__list">
                {activity.shells.map((s, i) => (
                  <li key={`${i}-${s.label}`} className="wpop__row">
                    <code className="wpop__cmd">{s.label}</code>
                  </li>
                ))}
              </ul>
              <p className="wpop__note">Se actualizan al acabar cada turno de Claude.</p>
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

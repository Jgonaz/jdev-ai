import { useRef } from 'react';
import { stateChip, visualState } from '../../lib/sessions.ts';
import { NARROW_BELOW_PX, hasWork, headerView, placeText, placeTitle, shortEffort } from '../../lib/statusline.ts';
import { formatRelative } from '../../lib/time.ts';
import { useElementWidth } from '../../lib/useElementWidth.ts';
import { useNow } from '../../lib/useNow.ts';
import type { ProjectInfo, SessionInfo } from '../../types.ts';
import { IconBranch, IconClock, IconSpark, IconWarning } from '../Icons.tsx';
import { MoreMenu } from './MoreMenu.tsx';
import { WorkChips } from './WorkChips.tsx';

export function ContextBar({ vista, narrow, ago }: { vista: NonNullable<ReturnType<typeof headerView>['context']>; narrow: boolean; ago: string }) {
  const nivel = vista.level;
  return (
    <span className={`ctxbar ctxbar--${nivel}`} title={ago ? `Datos de ${ago}` : undefined}>
      {ago && <span className="ctxbar__ago">{ago}</span>}
      <span aria-hidden="true">ctx</span>
      {vista.percent === null ? (
        <span className="ctxbar__pct">—</span>
      ) : (
        <>
          <span
            className="ctxbar__meter"
            role="meter"
            aria-label="Contexto usado"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(vista.percent)}
            aria-valuetext={vista.valueText}
          >
            <span className="ctxbar__fill" style={{ width: `${vista.percent}%` }} />
            <span className="ctxbar__mark ctxbar__mark--warn" aria-hidden="true" />
            <span className="ctxbar__mark ctxbar__mark--crit" aria-hidden="true" />
          </span>
          <span className="ctxbar__pct">
            {nivel === 'critical' && <IconWarning size={12} />}
            {vista.text}
          </span>
        </>
      )}
      {!narrow && vista.tokens && <span className="ctxbar__tokens">{vista.tokens}</span>}
    </span>
  );
}

/**
 * Cabecera de una terminal en tres filas: título con el estado y «⋯»; una sola
 * línea con proyecto, rama o worktree, modelo y esfuerzo, tiempo de sesión y, a
 * la derecha, el contexto; y, solo si hay trabajo en curso, sus chips. En una
 * columna estrecha se ocultan el proyecto, el tiempo y los tokens, y el trabajo
 * en curso pasa a contadores junto al título.
 */
export function PaneHeader({ session, project }: { session: SessionInfo; project: ProjectInfo }) {
  const ahora = useNow();
  const raiz = useRef<HTMLDivElement>(null);
  const ancho = useElementWidth(raiz);
  const narrow = ancho > 0 && ancho < NARROW_BELOW_PX;
  const estado = visualState(session);
  const v = headerView(session, ahora);
  const trabajo = hasWork(v.counts) && session.activity !== null;
  const lugar = placeText(v.place);

  return (
    <div className={`pane__head${narrow ? ' pane__head--narrow' : ''}`} ref={raiz}>
      <div className="pane__row">
        <span className="pane__title">{session.title}</span>
        {narrow && trabajo && <WorkChips counts={v.counts} activity={session.activity!} compact />}
        <span className={`chip chip--${estado}`}>{stateChip(session, formatRelative(session.updatedAt, ahora))}</span>
        <MoreMenu session={session} />
      </div>
      <div className={`pane__data${v.stale ? ' pane__data--stale' : ''}`}>
        <div className="pane__facts">
          {!narrow && (
            <span className="pfact">
              <span className="pfact__square" style={{ color: project.color }} aria-hidden="true">
                ■
              </span>
              {project.name}
            </span>
          )}
          <span className="pfact" title={placeTitle(v.place)}>
            {!v.place.worktree && <IconBranch size={12} />}
            {v.place.worktree ? (
              <>
                wt <span className="pfact__strong">{v.place.worktree}</span>
                {v.place.branch && <> · {v.place.branch}</>}
              </>
            ) : (
              <span className="pfact__strong">{lugar}</span>
            )}
          </span>
          <span className="pfact">
            {session.usage?.model && <IconSpark size={12} />}
            {session.usage?.model ? (
              <>
                <span className="pfact__strong">{v.model}</span>
                {v.effort && <> {narrow ? `· ${shortEffort(v.effort)}` : v.effort}</>}
              </>
            ) : (
              v.model
            )}
          </span>
          {!narrow && (
            <span className="pfact" title="Tiempo desde que empezó la sesión">
              <IconClock size={12} />
              {v.elapsed}
            </span>
          )}
        </div>
        {v.context && <ContextBar vista={v.context} narrow={narrow} ago={v.ago} />}
      </div>
      {!narrow && trabajo && (
        <div className="pane__work">
          <WorkChips counts={v.counts} activity={session.activity!} compact={false} />
        </div>
      )}
    </div>
  );
}

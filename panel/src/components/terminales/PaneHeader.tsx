import { useRef } from 'react';
import { isShell, stateChip, visualState } from '../../lib/sessions.ts';
import { NARROW_BELOW_PX, hasWork, headerView, placeText, placeTitle, shortEffort } from '../../lib/statusline.ts';
import { formatRelative } from '../../lib/time.ts';
import { useElementWidth } from '../../lib/useElementWidth.ts';
import { useNow } from '../../lib/useNow.ts';
import type { ProjectInfo, SessionInfo } from '../../types.ts';
import type { PaneView } from '../../lib/workspace.ts';
import { AgentIcon } from '../AgentIcon.tsx';
import { IconBranch, IconClock, IconSpark, IconWarning } from '../Icons.tsx';
import { MoreMenu } from './MoreMenu.tsx';
import { SearchButton, ViewSwitch } from './ViewSwitch.tsx';
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
 * en curso pasa a contadores junto al título. En la fila del título va el
 * conmutador Terminal / Chat (y, en chat, la lupa de la búsqueda); en una columna
 * estrecha pasa a una fila propia, a todo el ancho.
 */
export function PaneHeader({
  session,
  project,
  view,
  onView,
  searching,
  onSearch,
}: {
  session: SessionInfo;
  project: ProjectInfo;
  view: PaneView;
  onView: (v: PaneView) => void;
  /** La barra de búsqueda de la vista chat está abierta. */
  searching: boolean;
  onSearch: () => void;
}) {
  const ahora = useNow();
  const raiz = useRef<HTMLDivElement>(null);
  const ancho = useElementWidth(raiz);
  const narrow = ancho > 0 && ancho < NARROW_BELOW_PX;
  const estado = visualState(session);
  const estadoTexto = stateChip(session, formatRelative(session.updatedAt, ahora));
  const v = headerView(session, ahora);
  const trabajo = hasWork(v.counts) && session.activity !== null;
  const lugar = placeText(v.place);

  return (
    <div className={`pane__head${narrow ? ' pane__head--narrow' : ''}${view === 'chat' ? ' pane__head--chat' : ''}`} ref={raiz}>
      <div className="pane__row">
        <AgentIcon agent={session.agent} />
        <span className="pane__title">{session.title}</span>
        {narrow && trabajo && <WorkChips counts={v.counts} activity={session.activity!} compact session={session.name} />}
        {/* En un pane estrecho en vista chat, el chip pasa a un punto de 8 px: el estado va en su nombre accesible y su título. */}
        {narrow && view === 'chat' ? (
          <span className={`pane__statedot pane__statedot--${estado}`} role="img" aria-label={estadoTexto} title={estadoTexto} />
        ) : (
          <span className={`chip chip--${estado}`}>{estadoTexto}</span>
        )}
        {!narrow && <ViewSwitch view={view} onView={onView} chat={session.chat} full={false} />}
        {!narrow && view === 'chat' && <SearchButton active={searching} onClick={onSearch} full={false} />}
        <MoreMenu session={session} />
      </div>
      {/* En un pane estrecho el conmutador ocupa su propia fila, a todo el ancho, con objetivos táctiles de 44 px. */}
      {narrow && (
        <div className="pane__row pane__row--view">
          <ViewSwitch view={view} onView={onView} chat={session.chat} full />
          {view === 'chat' && <SearchButton active={searching} onClick={onSearch} full />}
        </div>
      )}
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
          {/* Una terminal sin agente no tiene modelo: su chip ya dice «Terminal». */}
          {!isShell(session) && (
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
          )}
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
          <WorkChips counts={v.counts} activity={session.activity!} compact={false} session={session.name} />
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { STATE_LABELS, sessionMeta } from '../../lib/sessions.ts';
import { sessionTip } from '../../lib/sidebarTip.ts';
import { formatRelative } from '../../lib/time.ts';
import { loadLiveCollapsed, saveLiveCollapsed } from '../../lib/liveUnopened.ts';
import type { LiveItem } from '../../lib/liveUnopened.ts';
import { useNow } from '../../lib/useNow.ts';
import { useWorkspace } from '../../state/WorkspaceContext.tsx';
import { IconChevron } from '../Icons.tsx';
import { Monogram } from '../Monogram.tsx';
import { StatusLight } from '../StatusLight.tsx';
import { RowTooltip, useRowTip } from './RowTooltip.tsx';
import type { useSessionMenu } from './SessionMenu.tsx';

export type LiveMenuHandlers = Pick<ReturnType<typeof useSessionMenu>, 'onContextMenu' | 'onKeyDown'>;

/** Descripción accesible de una terminal viva sin abrir (la luz sola no se lee). */
function liveLabel(i: LiveItem): string {
  const oculto = i.hiddenProject ? ', proyecto oculto' : '';
  return `Abrir ${i.session.title}, ${i.project.name}${oculto}, ${STATE_LABELS[i.state]}`;
}

/** Fila grande del estado vacío: luz, título, proyecto con monograma, meta y tiempo. */
function LiveRow({ item, ahora, menu }: { item: LiveItem; ahora: number; menu: LiveMenuHandlers }) {
  const { openSession } = useWorkspace();
  const { session: s, project } = item;
  return (
    <li>
      <button
        type="button"
        className={`lrow lrow--${item.state}`}
        aria-label={liveLabel(item)}
        onClick={() => openSession(s.name)}
        onContextMenu={(e) => menu.onContextMenu(e, s)}
        onKeyDown={(e) => menu.onKeyDown(e, s)}
      >
        <StatusLight state={item.state} />
        <span className="lrow__text">
          <span className="lrow__title">{s.title}</span>
          <span className="lrow__meta">{sessionMeta(s)}</span>
        </span>
        <span className="lrow__project">
          <Monogram project={project} size="sm" />
          <span className="lrow__pname">{project.name}</span>
          {item.hiddenProject && <span className="lrow__note">proyecto oculto</span>}
        </span>
        <span className="lrow__time">{formatRelative(s.updatedAt, ahora)}</span>
      </button>
    </li>
  );
}

/**
 * Terminales vivas que no están en ninguna pestaña, en el estado vacío de
 * Terminales. «Abrir todas» las abre como pestañas respetando la distribución
 * y deja activa la primera (la que más atención necesita).
 */
export function LiveList({ items, menu }: { items: LiveItem[]; menu: LiveMenuHandlers }) {
  const { openSession, activate } = useWorkspace();
  const ahora = useNow();
  const abrirTodas = () => {
    for (const i of items) openSession(i.session.name);
    if (items[0]) activate(items[0].session.name);
  };
  return (
    <section className="live" aria-labelledby="live-title">
      <div className="live__head">
        <h3 id="live-title" className="live__title">
          Terminales vivas <span className="live__count">({items.length})</span>
        </h3>
        {items.length > 1 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={abrirTodas}>
            Abrir todas
          </button>
        )}
      </div>
      <ul className="live__list">
        {items.map((i) => (
          <LiveRow key={i.session.name} item={i} ahora={ahora} menu={menu} />
        ))}
      </ul>
    </section>
  );
}

/** Fila compacta de «En segundo plano»: el título completo y el lugar salen en el tooltip. */
function LiveSlRow({ item: i, menu }: { item: LiveItem; menu: LiveMenuHandlers }) {
  const { openSession } = useWorkspace();
  const tip = useRowTip();
  return (
    <li>
      <button
        type="button"
        className={`slrow slrow--${i.state}`}
        aria-label={liveLabel(i)}
        {...tip.props}
        onClick={() => openSession(i.session.name)}
        onContextMenu={(e) => menu.onContextMenu(e, i.session)}
        onKeyDown={(e) => menu.onKeyDown(e, i.session)}
      >
        <StatusLight state={i.state} />
        <span className="slrow__title">{i.session.title}</span>
        <Monogram project={i.project} size="sm" />
      </button>
      {tip.anchor && <RowTooltip anchor={tip.anchor} id={tip.id} build={(ahora) => sessionTip(i.session, i.project, ahora)} />}
    </li>
  );
}

/** Apartado compacto de la barra lateral «En segundo plano (N)»: plegable y recordado. Oculto sin sesiones. */
export function LiveSidebarSection({ items, menu }: { items: LiveItem[]; menu: LiveMenuHandlers }) {
  const [plegado, setPlegado] = useState(() => loadLiveCollapsed());
  if (items.length === 0) return null;
  const alternar = () => {
    saveLiveCollapsed(!plegado);
    setPlegado(!plegado);
  };
  return (
    <section className="slive" aria-labelledby="slive-title">
      <h3 className="slive__heading" id="slive-title">
        <button type="button" className="slive__head" aria-expanded={!plegado} aria-controls="slive-list" onClick={alternar}>
          <IconChevron size={11} className={`recent__chevron${plegado ? '' : ' recent__chevron--open'}`} />
          <span>En segundo plano ({items.length})</span>
        </button>
      </h3>
      <ul className="slive__list" id="slive-list" hidden={plegado}>
        {items.map((i) => (
          <LiveSlRow key={i.session.name} item={i} menu={menu} />
        ))}
      </ul>
    </section>
  );
}

import { useState } from 'react';
import { STATE_HINTS, STATE_LABELS, emptyColumnText, priorityBars, shortDate } from '../../lib/backlog.ts';
import type { Grouped } from '../../lib/backlog.ts';
import { projectHref } from '../../lib/route.ts';
import { useSettings } from '../../state/SettingsContext.tsx';
import type { BacklogItem, BacklogState } from '../../types.ts';

// Arte ASCII del diseño (columna en curso vacía).
const ASCII = '  ( -_-)  zZ\n  /|___|\\';
/** Elementos hechos que se ven con la columna plegada. */
const DONE_PREVIEW = 5;

const MARCAS: Partial<Record<BacklogState, string>> = { todo: '●', 'in-progress': '◐', done: '✓', discarded: '✕' };

function Priority({ value }: { value: string | null }) {
  const barras = priorityBars(value);
  if (!value) return null;
  return (
    <span className="bcard__prio">
      {barras && <span aria-hidden="true">{barras} </span>}
      <span className="sr-only">prioridad </span>
      {value}
    </span>
  );
}

function Card({ item, project, selected }: { item: BacklogItem; project: string; selected: boolean }) {
  const legacy = item.warnings.includes('legacy');
  return (
    <li>
      <a
        className={`bcard bcard--${item.status}${selected ? ' bcard--selected' : ''}`}
        href={projectHref('backlog', project, item.id)}
        aria-current={selected ? 'true' : undefined}
        data-item={item.id}
      >
        <span className="bcard__title">{item.title}</span>
        <span className="bcard__meta">
          {item.type && <span className="bcard__type">{item.type}</span>}
          <Priority value={item.priority} />
          {legacy && <span className="bcard__legacy">formato antiguo</span>}
          {item.created && (
            <span className="bcard__date">
              <span className="sr-only">creado </span>
              {shortDate(item.created)}
            </span>
          )}
        </span>
      </a>
    </li>
  );
}

function ClosedRow({ item, project, selected }: { item: BacklogItem; project: string; selected: boolean }) {
  return (
    <li>
      <a
        className={`bdone${selected ? ' bdone--selected' : ''}`}
        href={projectHref('backlog', project, item.id)}
        aria-current={selected ? 'true' : undefined}
        data-item={item.id}
      >
        {item.title}
      </a>
    </li>
  );
}

function ColumnHead({ state, count, idBase }: { state: BacklogState; count: number; idBase: string }) {
  return (
    <h2 id={`${idBase}-col-${state}`} className="bcol__head">
      {MARCAS[state] && (
        <span className={`bcol__mark bcol__mark--${state}`} aria-hidden="true">
          {MARCAS[state]}
        </span>
      )}
      {STATE_LABELS[state]}
      <span className="bcol__count">
        <span className="sr-only">, </span>
        {count}
        <span className="sr-only"> {count === 1 ? 'elemento' : 'elementos'}</span>
      </span>
    </h2>
  );
}

function OpenColumn(props: {
  state: BacklogState;
  items: BacklogItem[];
  total: number;
  filtered: boolean;
  project: string;
  selected: string | null;
  idBase: string;
}) {
  const { settings } = useSettings();
  const hint = STATE_HINTS[props.state];
  return (
    <section className={`bcol bcol--${props.state}`} aria-labelledby={`${props.idBase}-col-${props.state}`}>
      <ColumnHead state={props.state} count={props.items.length} idBase={props.idBase} />
      {hint && <p className="bcol__hint">{hint}</p>}
      {props.items.length > 0 ? (
        <ul className="bcol__list">
          {props.items.map((i) => (
            <Card key={i.id} item={i} project={props.project} selected={i.id === props.selected} />
          ))}
        </ul>
      ) : props.filtered && props.total > 0 ? (
        <p className="bcol__none">Sin coincidencias con los filtros.</p>
      ) : props.state === 'in-progress' ? (
        <div className="bcol__empty">
          {settings.personality.ascii && (
            <pre className="bcol__ascii" aria-hidden="true">
              {ASCII}
            </pre>
          )}
          <span className="bcol__empty-title">El taller está tranquilo</span>
          <span className="bcol__empty-text">Elige algo de «por hacer» y pulsa «Trabajar en esto».</span>
        </div>
      ) : (
        <p className="bcol__none">{emptyColumnText(props.filtered, props.total)}</p>
      )}
    </section>
  );
}

function ClosedColumn(props: {
  done: BacklogItem[];
  discarded: BacklogItem[];
  totals: Record<BacklogState, number>;
  filtered: boolean;
  project: string;
  selected: string | null;
  idBase: string;
}) {
  // Si el elemento abierto está hecho o descartado y no se ve plegado, la columna empieza desplegada.
  const ocultoPlegado =
    props.selected !== null &&
    (props.discarded.some((i) => i.id === props.selected) || props.done.slice(DONE_PREVIEW).some((i) => i.id === props.selected));
  const [abierta, setAbierta] = useState(ocultoPlegado);
  const desplegada = abierta || ocultoPlegado;
  const hechos = desplegada ? props.done : props.done.slice(0, DONE_PREVIEW);
  return (
    <section
      className={`bcol bcol--closed${desplegada ? ' bcol--closed-open' : ''}`}
      aria-labelledby={`${props.idBase}-col-done`}
    >
      <ColumnHead state="done" count={props.done.length} idBase={props.idBase} />
      {hechos.length > 0 ? (
        <ul className="bcol__list bcol__list--closed">
          {hechos.map((i) => (
            <ClosedRow key={i.id} item={i} project={props.project} selected={i.id === props.selected} />
          ))}
        </ul>
      ) : (
        <p className="bcol__none">{emptyColumnText(props.filtered, props.totals.done)}</p>
      )}
      {desplegada && (
        <>
          <h3 id={`${props.idBase}-col-discarded`} className="bcol__head bcol__head--sub">
            <span className="bcol__mark" aria-hidden="true">
              {MARCAS.discarded}
            </span>
            {STATE_LABELS.discarded}
            <span className="bcol__count">
              <span className="sr-only">, </span>
              {props.discarded.length}
            </span>
          </h3>
          {props.discarded.length > 0 ? (
            <ul className="bcol__list bcol__list--closed" aria-labelledby={`${props.idBase}-col-discarded`}>
              {props.discarded.map((i) => (
                <ClosedRow key={i.id} item={i} project={props.project} selected={i.id === props.selected} />
              ))}
            </ul>
          ) : (
            <p className="bcol__none">{emptyColumnText(props.filtered, props.totals.discarded)}</p>
          )}
        </>
      )}
      {!ocultoPlegado && (
        <button type="button" className="bcol__toggle" aria-expanded={desplegada} onClick={() => setAbierta((a) => !a)}>
          {desplegada ? 'Plegar' : 'Ver todo y descartados'}
        </button>
      )}
    </section>
  );
}

export function Board(props: {
  grouped: Grouped;
  totals: Record<BacklogState, number>;
  filtered: boolean;
  project: string;
  selected: string | null;
  idBase: string;
}) {
  return (
    <div className="board">
      {(['backlog', 'todo', 'in-progress'] as const).map((s) => (
        <OpenColumn
          key={s}
          state={s}
          items={props.grouped[s]}
          total={props.totals[s]}
          filtered={props.filtered}
          project={props.project}
          selected={props.selected}
          idBase={props.idBase}
        />
      ))}
      <ClosedColumn
        key={props.project}
        done={props.grouped.done}
        discarded={props.grouped.discarded}
        totals={props.totals}
        filtered={props.filtered}
        project={props.project}
        selected={props.selected}
        idBase={props.idBase}
      />
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ACTIVITY_AGENTS, ACTIVITY_RANGES } from '../../../shared/activity.ts';
import type { ActivityAgent, ActivityRange, ActivityResponse } from '../../../shared/activity.ts';
import { api } from '../../api.ts';
import {
  agentLabel,
  barPercents,
  bestDayText,
  calendarCells,
  compact,
  exact,
  indexingText,
  isEmpty,
  loadActivityFilters,
  modelShares,
  modelSummary,
  modelTip,
  moveCell,
  projectTip,
  rangeLabel,
  saveActivityFilters,
  streakText,
  tiles,
  updatedText,
  weekRows,
} from '../../lib/activity.ts';
import type { ActivityFilters, ModelShare } from '../../lib/activity.ts';
import { clampMenu } from '../../lib/menuPosition.ts';
import { useNow } from '../../lib/useNow.ts';

const POLL_INDEXING_MS = 3000;
const REFRESH_DEBOUNCE_MS = 400;
const TIP_GAP = 8;

/**
 * GET /api/activity para el filtro actual. Conserva la respuesta anterior mientras
 * llega la nueva (sin parpadeos al cambiar de filtro), la repite cada pocos segundos
 * mientras el servidor indexa y al volver a la ventana.
 */
function useActivity(filtros: ActivityFilters): { data: ActivityResponse | null; error: string | null } {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const indexando = data?.indexing === true;
  const { range, agent } = filtros;

  const cargar = useCallback(
    (señal?: AbortSignal) => {
      const n = ++seq.current;
      api
        .activity(range, agent, señal)
        .then((r) => {
          if (n !== seq.current) return;
          setData(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (n === seq.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
        });
    },
    [range, agent],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    cargar(ctrl.signal);
    return () => ctrl.abort();
  }, [cargar]);

  useEffect(() => {
    if (!indexando) return;
    const t = window.setInterval(() => cargar(), POLL_INDEXING_MS);
    return () => window.clearInterval(t);
  }, [indexando, cargar]);

  useEffect(() => {
    let timer: number | null = null;
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => cargar(), REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [cargar]);

  return { data, error };
}

// ---------- Tooltip de los gráficos ----------

type TipState = { text: string; rect: DOMRect } | null;

/**
 * Detalle exacto al pasar el ratón o llegar con el teclado a un elemento del
 * gráfico. El texto ya está en el aria-label del elemento: el tooltip es solo visual.
 */
function useChartTip() {
  const [tip, setTip] = useState<TipState>(null);
  const cerrar = useCallback(() => setTip(null), []);
  const props = useCallback(
    (text: string) => ({
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') setTip({ text, rect: e.currentTarget.getBoundingClientRect() });
      },
      onPointerLeave: cerrar,
      onFocus: (e: FocusEvent<HTMLElement>) => setTip({ text, rect: e.currentTarget.getBoundingClientRect() }),
      onBlur: cerrar,
    }),
    [cerrar],
  );
  useEffect(() => {
    if (!tip) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);
    return () => {
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
    };
  }, [tip, cerrar]);
  return { tip, props, close: cerrar };
}

function ChartTip({ tip }: { tip: TipState }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = raiz.current;
    if (!tip || !el) return;
    const caja = el.getBoundingClientRect();
    // Encima del elemento, centrado; si no cabe arriba, debajo.
    const arriba = tip.rect.top - caja.height - TIP_GAP;
    const y = arriba >= 8 ? arriba : tip.rect.bottom + TIP_GAP;
    setPos(clampMenu(tip.rect.left + tip.rect.width / 2 - caja.width / 2, y, caja.width, caja.height, { width: window.innerWidth, height: window.innerHeight }));
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div ref={raiz} className="acttip" aria-hidden="true" style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
      {tip.text}
    </div>,
    document.body,
  );
}

// ---------- Piezas ----------

function Segmented<T extends string>({ label, value, options, text, onChange }: { label: string; value: T; options: readonly T[]; text: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="actseg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className="actseg__btn" aria-pressed={value === o} onClick={() => onChange(o)}>
          {text(o)}
        </button>
      ))}
    </div>
  );
}

function Tiles({ data }: { data: ActivityResponse }) {
  const tip = useChartTip();
  return (
    <div className="acttiles">
      {tiles(data).map((t) => (
        <div key={t.id} className="acttile">
          <span className="acttile__label">
            {t.note ? (
              <span tabIndex={0} className="acttile__info" aria-label={`${t.label}. ${t.note}`} {...tip.props(t.note)}>
                {t.label}{' '}
                <span className="acttile__i" aria-hidden="true">
                  i
                </span>
              </span>
            ) : (
              t.label
            )}
          </span>
          <span className="acttile__value">{t.value}</span>
          {t.delta && t.compare ? (
            <span className="acttile__compare">
              <span className={`acttile__delta acttile__delta--${t.delta.dir}`}>
                <span aria-hidden="true">{t.delta.text}</span>
                <span className="sr-only">{t.delta.label}</span>
              </span>{' '}
              {t.compare}
            </span>
          ) : (
            <span className="acttile__compare">{data.range === 'all' ? 'desde el primer registro' : ''}</span>
          )}
          <span className="acttile__detail">{t.detail}</span>
        </div>
      ))}
      <ChartTip tip={tip.tip} />
    </div>
  );
}

const LEVELS = ['Sin actividad', 'Poca', 'Media', 'Alta', 'Muy alta'] as const;
const WEEKDAYS = ['L', '', 'X', '', 'V', '', 'D'];

function Calendar({ data }: { data: ActivityResponse }) {
  const [tabla, setTabla] = useState(false);
  const tip = useChartTip();
  const celdas = useMemo(() => calendarCells(data.days, data.today), [data.days, data.today]);
  const filas = useMemo(() => weekRows(data.days, data.today), [data.days, data.today]);
  // Un único punto de tabulación (rovingtabindex): empieza en hoy y se mueve con las flechas.
  const hoyIdx = Math.max(0, celdas.findIndex((c) => c.date === data.today));
  const [activa, setActiva] = useState(hoyIdx);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);

  const tecla = (e: KeyboardEvent<HTMLElement>, i: number) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const n = moveCell(i, e.key, celdas.length);
    setActiva(n);
    refs.current[n]?.focus();
  };

  return (
    <figure className="actcard actcard--calendar">
      <figcaption className="actcard__cap actcard__cap--split">
        <span className="actcard__title">Respuestas por día · últimas 12 semanas</span>
        <span className="actcard__sub">
          Racha: <strong>{streakText(data.streak)}</strong> · mejor día: {bestDayText(data.bestDay, data.today)}
        </span>
      </figcaption>
      {tabla ? (
        <div className="acttable-wrap">
          <table className="acttable">
            <caption className="sr-only">Respuestas por día de las últimas 12 semanas</caption>
            <thead>
              <tr>
                <th scope="col">Semana</th>
                {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
                  <th key={i} scope="col" className="acttable__num" abbr={['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][i]}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.label}>
                  <th scope="row">{f.label}</th>
                  {f.days.map((d) => (
                    <td key={d.date} className="acttable__num">
                      {d.future ? '' : d.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="actcal">
          <div className="actcal__days" aria-hidden="true">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="actcal__grid" role="group" aria-label="Calendario de respuestas por día de las últimas 12 semanas. Usa las flechas para moverte entre días.">
            {celdas.map((c, i) => (
              <span
                key={c.date}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                role="img"
                className={`actcal__cell actcal__cell--${c.future ? 'future' : c.level}`}
                tabIndex={activa === i ? 0 : -1}
                aria-label={c.text}
                onKeyDown={(e) => tecla(e, i)}
                {...tip.props(c.text)}
                onFocus={(e) => {
                  setActiva(i);
                  tip.props(c.text).onFocus(e);
                }}
              />
            ))}
          </div>
        </div>
      )}
      <div className="actcal__legend">
        {!tabla && (
          <>
            <span>menos</span>
            {[0, 1, 2, 3, 4].map((n) => (
              <span key={n} className={`actcal__swatch actcal__cell--${n}`} title={LEVELS[n]} aria-hidden="true" />
            ))}
            <span>más</span>
          </>
        )}
        <button type="button" className="actlink" onClick={() => {
            // Al cambiar de vista, la celda con el foco desaparece sin avisar: se cierra su tooltip.
            tip.close();
            setTabla((v) => !v);
          }} aria-pressed={tabla}>
          {tabla ? 'Ver como calendario' : 'Ver como tabla'}
        </button>
      </div>
      <ChartTip tip={tip.tip} />
    </figure>
  );
}

function ProjectBars({ data }: { data: ActivityResponse }) {
  const tip = useChartTip();
  const anchos = barPercents(data.byProject);
  const total = data.byProject.reduce((n, p) => n + p.output, 0);
  return (
    <figure className="actcard">
      <figcaption className="actcard__cap">
        <span className="actcard__title">Por proyecto · tokens de salida</span>
      </figcaption>
      {data.byProject.length === 0 ? (
        <p className="actcard__empty">Sin tokens de salida en este periodo.</p>
      ) : (
        <ul className="actbars">
          {data.byProject.map((p, i) => {
            const texto = projectTip(p, total);
            return (
              <li key={p.id ?? 'otros'} className="actbar" tabIndex={0} aria-label={texto} {...tip.props(texto)}>
                <span className="actbar__name">
                  {p.mono && p.color ? (
                    <span className="mono mono--sm" style={{ background: p.color }} aria-hidden="true">
                      {p.mono}
                    </span>
                  ) : (
                    <span className="actbar__other" aria-hidden="true">
                      …
                    </span>
                  )}
                  <span className="actbar__text">{p.name}</span>
                </span>
                <span className="actbar__track" aria-hidden="true">
                  <span className="actbar__fill" style={{ width: `${anchos[i]}%` }} />
                </span>
                <span className="actbar__value">{compact(p.output)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <ChartTip tip={tip.tip} />
    </figure>
  );
}

function ModelSplit({ data }: { data: ActivityResponse }) {
  const tip = useChartTip();
  const shares: ModelShare[] = useMemo(() => modelShares(data.byModel), [data.byModel]);
  return (
    <figure className="actcard">
      <figcaption className="actcard__cap">
        <span className="actcard__title">Por modelo · respuestas</span>
      </figcaption>
      {shares.length === 0 ? (
        <p className="actcard__empty">Sin respuestas en este periodo.</p>
      ) : (
        <>
          <div className="actmodel__bar" role="group" aria-label={modelSummary(shares)}>
            {shares.map((m) => (
              <span key={m.family} role="img" className={`actmodel__seg actmodel__seg--${m.family}`} style={{ flexGrow: m.responses }} tabIndex={0} aria-label={modelTip(m)} {...tip.props(modelTip(m))} />
            ))}
          </div>
          <ul className="actmodel__legend">
            {shares.map((m) => (
              <li key={m.family}>
                <span className={`actmodel__key actmodel__seg--${m.family}`} aria-hidden="true" />
                <span className="actmodel__name">{m.label}</span>
                <span className="actmodel__pct">{m.percent} %</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ChartTip tip={tip.tip} />
    </figure>
  );
}

function CountList({ title, items, empty }: { title: string; items: { name: string; count: number }[]; empty: string }) {
  return (
    <figure className="actcard actcard--list">
      <figcaption className="actcard__cap">
        <span className="actcard__title">{title}</span>
      </figcaption>
      {items.length === 0 ? (
        <p className="actcard__empty">{empty}</p>
      ) : (
        <ul className="actlist">
          {items.map((it) => (
            <li key={it.name} className="actlist__row">
              <span className="actlist__name" title={it.name}>
                {it.name}
              </span>
              <span className="actlist__dots" aria-hidden="true" />
              <span className="actlist__value">{exact(it.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** Sección «tu actividad» de Inicio: cifras, calendario y repartos de Claude y Codex. */
export function ActivitySection() {
  const [filtros, setFiltros] = useState<ActivityFilters>(() => loadActivityFilters());
  const { data, error } = useActivity(filtros);
  const ahora = useNow(30_000);

  const cambiar = (parche: Partial<ActivityFilters>) => {
    const nuevos = { ...filtros, ...parche };
    setFiltros(nuevos);
    saveActivityFilters(nuevos);
  };

  return (
    <section className="inicio__section act" aria-labelledby="h-tu-actividad">
      <div className="act__head">
        <h2 id="h-tu-actividad" className="inicio__h2">
          <span className="inicio__h2-mark" aria-hidden="true">
            ›
          </span>{' '}
          tu actividad
        </h2>
        <div className="act__filters">
          <Segmented<ActivityRange> label="Periodo" value={filtros.range} options={ACTIVITY_RANGES} text={rangeLabel} onChange={(range) => cambiar({ range })} />
          <Segmented<ActivityAgent> label="Agente" value={filtros.agent} options={ACTIVITY_AGENTS} text={agentLabel} onChange={(agent) => cambiar({ agent })} />
        </div>
      </div>

      {error && (
        <p className="inicio__error" role="alert">
          No se pudo cargar la actividad: {error}
        </p>
      )}

      {!data ? (
        !error && <p className="inicio__calm">Calculando…</p>
      ) : (
        <>
          {data.indexing && (
            <p className="act__indexing" role="status">
              {indexingText(data)}
              {data.updatedAt === null || isEmpty(data) ? ' Lo que ya está leído se muestra mientras tanto.' : ''}
            </p>
          )}
          <Tiles data={data} />
          <div className="act__row act__row--two">
            <Calendar data={data} />
            <ProjectBars data={data} />
          </div>
          <div className="act__row act__row--three">
            <ModelSplit data={data} />
            <CountList title="Subagentes lanzados" items={data.agents} empty="Ningún subagente en este periodo." />
            <CountList title="Herramientas más usadas" items={data.tools} empty="Ninguna herramienta en este periodo." />
          </div>
          <p className="act__foot">
            Calculado en tu equipo a partir de los transcripts de Claude Code y Codex
            {updatedText(data.updatedAt, ahora) ? ` · ${updatedText(data.updatedAt, ahora)}` : ''}
          </p>
        </>
      )}
    </section>
  );
}

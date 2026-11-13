import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AgentEvent } from '../../../shared/follow.ts';
import type { Station } from '../../../shared/stations.ts';
import { buildBoard } from '../../lib/activityMap.ts';
import {
  ANILLO_R,
  CENTRO,
  MAP_H,
  MAP_W,
  NUCLEO_R,
  PULSE_MS,
  contextRing,
  needsTick,
  nowLine,
  planPulses,
  pulsePoint,
  pulseProgress,
  routeLegs,
  stationPoint,
  stationViews,
  subagentDots,
  toneColor,
  viewRows,
} from '../../lib/mapView.ts';
import type { NowLine, Pulse, Tone } from '../../lib/mapView.ts';
import { useElementWidth } from '../../lib/useElementWidth.ts';
import { useMediaQuery } from '../../lib/useMediaQuery.ts';
import { Collapsible } from '../Collapsible.tsx';

export type ActivityMapProps = {
  /** Eventos ligeros de la conversación, en orden (`ConversationEntry.mapEvents`). */
  events: readonly AgentEvent[];
  /** Eventos que han llegado desde el último reinicio (`ConversationEntry.mapTotal`): lo que crece son los eventos nuevos. */
  total: number;
  /** Id de la sesión de Claude a la que pertenecen: si cambia, lo que había no cuenta como nuevo. */
  epoch: string | null;
  /** Ya se leyó la conversación hasta el final: antes, lo que llega es historia y no lanza pulsos. */
  synced: boolean;
  /** Estado de la sesión: fuera de «working» y «waiting», las llamadas sin resultado se dibujan como interrumpidas. */
  state: 'working' | 'waiting' | 'other';
  /** Contexto usado (0 a 100); null si no se conoce. */
  percent: number | null;
  model: string;
  /** Subagentes activos, de los mismos datos que la cabecera. */
  subagents: number;
  /** La vista está a la vista: sin ella no hay pulsos ni repintados. */
  active: boolean;
  /** Desplegable «Actividad reciente» abierto. El mapa y la línea de «ahora» se mantienen al día aunque esté cerrado. */
  listOpen: boolean;
  onListToggle: (open: boolean) => void;
};

/** Ancho del bloque de textos del núcleo (cabe dentro del disco de radio 41). */
const NUCLEO_TEXTO = 100;

const tinta = (t: Tone): CSSProperties => ({ stroke: toneColor(t) });
const relleno = (t: Tone): CSSProperties => ({ fill: toneColor(t) });
const color = (t: Tone): CSSProperties => ({ color: toneColor(t) });

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const alCambiar = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', alCambiar);
    return () => document.removeEventListener('visibilitychange', alCambiar);
  }, []);
  return visible;
}

/**
 * Los pulsos en vuelo. Es lo único que se repinta en cada fotograma, y solo mientras hay alguno y la vista es visible:
 * `requestAnimationFrame` no se llama en reposo.
 */
function Pulses({ pulsos, activo, alPodar }: { pulsos: readonly Pulse[]; activo: boolean; alPodar: (t: number) => void }) {
  const [t, setT] = useState(() => performance.now());
  const hay = activo && pulsos.length > 0;
  useEffect(() => {
    if (!hay) return;
    let id = 0;
    const paso = () => {
      const n = performance.now();
      setT(n);
      alPodar(n);
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [hay, alPodar]);
  if (!hay) return null;
  return (
    <g className="map__pulses">
      {pulsos.map((p) => {
        const f = pulseProgress(p, t);
        if (f === null) return null;
        const tono: Tone = p.kind === 'error' ? 'danger' : 'accent';
        const cabeza = pulsePoint(p, f);
        // La estela: dos copias más pálidas por detrás de la cabeza.
        const cola = [0.07, 0.14].flatMap((d, i) => (f - d < 0 ? [] : [{ ...pulsePoint(p, f - d), r: 3 - i * 0.7, o: 0.5 - i * 0.25 }]));
        return (
          <g key={p.key} style={relleno(tono)}>
            {cola.map((c, i) => (
              <circle key={i} cx={c.x} cy={c.y} r={c.r} fillOpacity={c.o} />
            ))}
            <circle cx={cabeza.x} cy={cabeza.y} r={8} fillOpacity={0.22} />
            <circle cx={cabeza.x} cy={cabeza.y} r={3.5} />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Mapa de actividad de una sesión de Claude (diseño «Mapa de actividad»): el núcleo con el anillo de contexto, las nueve
 * estaciones con sus radios, la ruta reciente, halos y manecillas de lo que sigue en marcha, y debajo la línea de «ahora»
 * y, en un desplegable, las últimas filas. El dibujo (SVG) es decorativo y las filas son su equivalente textual.
 */
export function ActivityMap({ events, total, epoch, synced, state, percent, model, subagents, active, listOpen, onListToggle }: ActivityMapProps) {
  const reducido = useMediaQuery('(prefers-reduced-motion: reduce)');
  const visible = useDocumentVisible();
  const interrumpida = state === 'other';

  // La hora se refresca con cada evento nuevo y, mientras haya algo que se mueva, cada segundo.
  const [tic, setTic] = useState(0);
  const ahora = useMemo(() => Date.now(), [events, tic, active]);
  const board = useMemo(() => buildBoard(events, ahora), [events, ahora]);
  const hayTic = active && needsTick(board, ahora, interrumpida);
  useEffect(() => {
    if (!hayTic) return;
    const id = window.setInterval(() => setTic((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [hayTic]);

  // ---- Pulsos y onda: solo con lo que llega después de la primera sincronización de esta sesión.
  const [pulsos, setPulsos] = useState<readonly Pulse[]>([]);
  const [onda, setOnda] = useState(0);
  const claveSiguiente = useRef(0);
  const visto = useRef<{ epoch: string | null; total: number; synced: boolean; listo: boolean } | null>(null);
  const listo = board.now.kind === 'ready';
  useEffect(() => {
    const previo = visto.current;
    visto.current = { epoch, total, synced, listo };
    if (previo === null || !previo.synced || !synced || previo.epoch !== epoch) return;
    if (!active || reducido) return;
    if (total > previo.total) {
      const nuevos = planPulses(events, total - previo.total, performance.now(), claveSiguiente.current);
      claveSiguiente.current += nuevos.length;
      if (nuevos.length > 0) setPulsos((p) => [...p, ...nuevos]);
    }
    if (listo && !previo.listo) setOnda((n) => n + 1);
  }, [events, total, epoch, synced, listo, active, reducido]);
  useEffect(() => {
    if (!active) setPulsos([]);
  }, [active]);
  const podar = useCallback(
    (t: number) =>
      setPulsos((p) => {
        const vivos = p.filter((q) => t < q.start + PULSE_MS);
        return vivos.length === p.length ? p : vivos;
      }),
    [],
  );

  const errorPulses = useMemo(() => new Set<Station>(pulsos.filter((p) => p.kind === 'error').map((p) => p.station)), [pulsos]);
  // Con subagentes trabajando, lo que está en marcha es Agentes, no el modelo de la sesión principal.
  const pensando = state === 'working' && board.now.kind !== 'running' && subagents === 0;
  const estaciones = useMemo(
    () => stationViews(board, { now: ahora, interrupted: interrumpida, errorPulses, thinking: pensando, subagents }),
    [board, ahora, interrumpida, errorPulses, pensando, subagents],
  );
  const tramos = useMemo(() => routeLegs(board.route, ahora), [board, ahora]);
  const puntos = useMemo(() => subagentDots(subagents), [subagents]);
  const anillo = contextRing(percent);
  const trabajando = estaciones.some((s) => s.running);
  const linea: NowLine = synced
    ? nowLine(board, { interrupted: interrumpida, working: state === 'working', subagents })
    : { glyph: '·', tone: 'faint', text: 'Sin datos todavía', time: '' };
  const filas = useMemo(() => viewRows(board, interrumpida), [board, interrumpida]);

  // En una columna estrecha todo el dibujo se encoge a la vez: la geometría es de 312 px.
  const ajuste = useRef<HTMLDivElement>(null);
  const ancho = useElementWidth(ajuste);
  const escala = ancho > 0 ? Math.min(1, ancho / MAP_W) : 1;
  const dibujo = ancho > 0 ? Math.min(ancho, MAP_W) : MAP_W;

  const agentes = stationPoint('agentes');

  return (
    <div className="map">
      <div className="map__fit" ref={ajuste} style={{ height: MAP_H * escala }}>
        <div className="map__stage" style={{ width: MAP_W, height: MAP_H, left: (ancho - dibujo) / 2, transform: `scale(${escala})` }}>
          <svg className="map__svg" width={MAP_W} height={MAP_H} viewBox={`0 0 ${MAP_W} ${MAP_H}`} aria-hidden="true" focusable="false">
            <circle cx={CENTRO.x} cy={CENTRO.y} r={118} fill="none" strokeWidth={1} strokeDasharray="1 5" style={tinta('line')} />
            {estaciones.map((s) => (
              <line
                key={s.id}
                className="map__spoke"
                x1={s.spoke.x1}
                y1={s.spoke.y1}
                x2={s.spoke.x2}
                y2={s.spoke.y2}
                strokeWidth={s.spoke.width}
                strokeOpacity={s.spoke.opacity}
                strokeLinecap="round"
                style={tinta(s.spoke.tone)}
              />
            ))}
            {tramos.map((l, i) => (
              <path key={i} d={l.d} fill="none" strokeWidth={l.width} strokeOpacity={l.opacity} strokeLinecap="round" style={tinta(l.tone)} />
            ))}
            {onda > 0 && !reducido && (
              <circle
                key={onda}
                className="map__wave"
                cx={CENTRO.x}
                cy={CENTRO.y}
                r={ANILLO_R}
                fill="none"
                strokeWidth={1.5}
                style={{ ...tinta('accent'), transformOrigin: `${CENTRO.x}px ${CENTRO.y}px` }}
              />
            )}
            <Pulses pulsos={pulsos} activo={active && visible && !reducido} alPodar={podar} />
            {estaciones.flatMap((s) =>
              s.halo === null
                ? []
                : [
                    <g key={s.id}>
                      <circle cx={s.halo.x} cy={s.halo.y} r={31} fillOpacity={0.16} style={relleno(s.halo.tone)} />
                      {s.halo.inner !== null && <path d={s.halo.inner} fill="none" strokeWidth={2} strokeLinecap="round" style={tinta(s.halo.tone)} />}
                      {s.halo.outer !== null && <path d={s.halo.outer} fill="none" strokeWidth={2} strokeOpacity={0.5} strokeLinecap="round" style={tinta(s.halo.tone)} />}
                    </g>,
                  ],
            )}
            <circle cx={CENTRO.x} cy={CENTRO.y} r={ANILLO_R} fill="none" strokeWidth={3} style={tinta('line')} />
            <circle
              className="map__ctx"
              cx={CENTRO.x}
              cy={CENTRO.y}
              r={ANILLO_R}
              fill="none"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={anillo.dash}
              transform={`rotate(-90 ${CENTRO.x} ${CENTRO.y})`}
              style={tinta(anillo.ring)}
            />
            <circle cx={CENTRO.x} cy={CENTRO.y} r={NUCLEO_R} strokeWidth={1.5} style={{ fill: 'var(--bg-surface)', stroke: toneColor(trabajando ? 'accent' : 'used') }} />
            {puntos.length > 0 && (
              <g className="map__orbit" style={{ transformOrigin: `${agentes.x}px ${agentes.y}px` }}>
                {puntos.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r={3.5} style={relleno('accent')} />
                ))}
              </g>
            )}
          </svg>

          {/* Centrado en el centro del mapa, sea cual sea su alto. */}
          <div className="map__core" style={{ left: CENTRO.x - NUCLEO_TEXTO / 2, top: CENTRO.y, width: NUCLEO_TEXTO }}>
            <span className="map__pct" style={color(anillo.text)}>
              {anillo.label}
            </span>
            <span className="map__brand">CLAUDE</span>
            <span className="map__model" title={model || undefined}>
              {model}
            </span>
          </div>

          <ul className="map__stations" aria-label="Estaciones">
            {estaciones.map((s) => (
              <li key={s.id} className={`map__st${s.labelUp ? ' map__st--up' : ''}`} style={{ left: s.left, top: s.top }} data-station={s.id}>
                <span className="map__disc" style={{ borderColor: toneColor(s.ring), ...color(s.iconTone) }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d={s.icon} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {s.errors > 0 && (
                    <span className="map__err" aria-hidden="true">
                      {s.errors}
                    </span>
                  )}
                  {s.count !== '' && (
                    <span className="map__count" aria-hidden="true">
                      {s.count}
                    </span>
                  )}
                </span>
                <span className="map__label">
                  <span className="map__name" style={color(s.labelTone)}>
                    {s.name}
                  </span>
                  {s.usesLabel !== '' && (
                    <span className="map__uses" style={color(s.usesTone)}>
                      {s.usesLabel}
                    </span>
                  )}
                </span>
                {(s.running || s.errors > 0) && (
                  <span className="sr-only">
                    {[s.running ? (s.count !== '' ? `${s.count.slice(1)} en marcha` : 'en marcha') : '', s.errors > 0 ? `${s.errors} ${s.errors === 1 ? 'error' : 'errores'}` : '']
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="map__now">
        <span className="map__nowglyph" style={color(linea.tone)} aria-hidden="true">
          {linea.glyph}
        </span>
        <span className="map__nowtext" aria-live="polite" aria-atomic="true">
          {linea.text}
        </span>
        <span className="map__nowtime" style={color(linea.tone === 'accent' ? 'accent' : 'muted')}>
          {linea.time}
        </span>
      </div>

      <Collapsible title="Actividad reciente" summary={filas.length > 0 ? String(filas.length) : ''} label={filas.length > 0 ? `Actividad reciente (${filas.length})` : undefined} open={listOpen} onToggle={onListToggle}>
        {filas.length === 0 ? (
          // Sin leer aún la conversación (o si falló), la nota de arriba lo explica: no se afirma que no haya actividad.
          synced && <p className="map__empty">Aún no hay actividad. El mapa se llena en cuanto el agente use una herramienta.</p>
        ) : (
          <ul className="map__rows">
            {filas.map((r) => (
              <li key={r.id} className="map__row" data-status={r.status}>
                <span className="map__glyph" style={color(r.glyphTone)} aria-hidden="true">
                  {r.glyph}
                </span>
                <span className="sr-only">{r.statusText}: </span>
                <span className="map__rst">{r.station}</span>
                <span className="map__rwhat">
                  <span style={color(r.toolTone)}>{r.tool}</span>
                  {r.target !== '' && <span style={color(r.targetTone)}> {r.target}</span>}
                  {r.fold !== '' && <span style={color('faint')}> {r.fold}</span>}
                </span>
                <span className="map__rtime" style={color(r.timeTone)}>
                  {r.time}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>
    </div>
  );
}

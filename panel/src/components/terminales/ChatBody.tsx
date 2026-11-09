import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ApiError, api } from '../../api.ts';
import { checkChatMessage } from '../../../shared/chat.ts';
import {
  actionsLabel,
  countNewMessages,
  errorsLabel,
  findRanges,
  newMessagesLabel,
  progressLabel,
  progressPercent,
  resultText,
  searchChat,
  splitHighlight,
  stepKey,
  toolsSummary,
} from '../../lib/chat.ts';
import type { ChatItem, ChatStep } from '../../lib/chat.ts';
import { atBottom, followAfterScroll, resultNote } from '../../lib/follow.ts';
import { visualState } from '../../lib/sessions.ts';
import { formatClock } from '../../lib/statusline.ts';
import { useConversation } from '../../lib/useConversation.ts';
import type { SessionInfo } from '../../types.ts';
import { IconArrowDown, IconChat, IconChevron, IconChevronDown, IconChevronUp, IconClose, IconSearch, IconSend } from '../Icons.tsx';
import { Markdown } from '../Markdown.tsx';

/** A partir de tantos elementos se deja que el navegador se salte el pintado de lo que queda fuera de pantalla. */
const LISTA_LARGA = 1500;
const ALTO_MAX_CAJA = 200;

const SIN_COINCIDENCIAS: ReadonlySet<string> = new Set();

/** Un texto con las coincidencias de la búsqueda dentro de `<mark>`; el mismo texto si no hay búsqueda. */
function resalta(texto: string, consulta: string): ReactNode {
  if (consulta.trim() === '') return texto;
  const partes = splitHighlight(texto, consulta);
  if (partes.length === 1 && !partes[0]!.hit) return texto;
  return partes.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text));
}

const claseHit = (hit: boolean, actual: boolean): string => (hit ? ` chat__hit${actual ? ' chat__hit--cur' : ''}` : '');

/** Abre un `<details>` (sin controlar su atributo `open`, para no pelear con quien lo abre o cierra a mano). */
function useAbreSi(ref: { current: HTMLDetailsElement | null }, abrir: boolean, ...dependencias: unknown[]): void {
  useLayoutEffect(() => {
    if (abrir && ref.current) ref.current.open = true;
  }, [abrir, ...dependencias]);
}

// ---------------------------------------------------------------------- Elementos

function StepView({ paso, clave, consulta, hit, actual }: { paso: ChatStep; clave: string; consulta: string; hit: boolean; actual: boolean }) {
  const r = paso.result;
  const texto = r ? resultText(r) : '';
  const nota = r ? resultNote(paso.tool, r) : { inline: null, below: null };
  const salida = useRef<HTMLDetailsElement>(null);
  const hitEnSalida = hit && texto !== '' && findRanges(texto, consulta).length > 0;
  useAbreSi(salida, hitEnSalida, actual);
  return (
    <div className={`chat__step${r?.error ? ' chat__step--error' : ''}${claseHit(hit, actual)}`} data-hit={hit ? clave : undefined}>
      <div className="chat__stepline">
        <span className="chat__bullet" aria-hidden="true">
          ●
        </span>
        <span className="chat__line">
          <span className="chat__verb">{resalta(paso.verb, consulta)}</span>
          {paso.target !== '' && <span className="chat__target"> {resalta(paso.target, consulta)}</span>}
          {paso.detail && <span className="chat__muted"> {resalta(paso.detail, consulta)}</span>}
          {nota.inline && <span className={r?.error ? 'chat__fail' : 'chat__muted'}> · {nota.inline}</span>}
        </span>
      </div>
      {r && texto !== '' && r.error && <pre className="chat__out chat__out--error">{resalta(texto, consulta)}</pre>}
      {r && texto !== '' && !r.error && (
        <details className="chat__outd" ref={salida}>
          <summary>Resultado</summary>
          <pre className="chat__out">{resalta(texto, consulta)}</pre>
        </details>
      )}
    </div>
  );
}

function ToolsView({ item, consulta, hits, curKey }: { item: Extract<ChatItem, { kind: 'tools' }>; consulta: string; hits: ReadonlySet<string>; curKey: string | null }) {
  const caja = useRef<HTMLDetailsElement>(null);
  const [abierto, setAbierto] = useState(false);
  const hay = hits.size > 0;
  // Las acciones solo se pintan con el grupo abierto (o con una coincidencia dentro): una conversación larga tiene miles.
  const pinta = abierto || hay;
  useAbreSi(caja, hay, curKey);
  return (
    <details className={`chat__tools${item.errors > 0 ? ' chat__tools--err' : ''}`} ref={caja} onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary className="chat__toolsum">
        <IconChevron size={12} className="chat__chev" />
        <span className="chat__count">{actionsLabel(item.steps.length)}</span>
        {item.errors > 0 && <span className="chat__errs">· {errorsLabel(item.errors)}</span>}
        <span className="chat__preview">{toolsSummary(item.steps)}</span>
      </summary>
      {pinta && (
        <div className="chat__steps">
          {item.steps.map((s, j) => {
            const k = stepKey(item.key, j);
            return <StepView key={s.id} paso={s} clave={k} consulta={consulta} hit={hits.has(k)} actual={curKey === k} />;
          })}
        </div>
      )}
    </details>
  );
}

function ItemViewBase({ item, consulta, curKey }: { item: ChatItem; consulta: string; curKey: string | null }) {
  // Qué mensajes o acciones de este elemento contienen la búsqueda (comparte la normalización de la búsqueda general).
  const hits = useMemo(() => (consulta.trim() === '' ? SIN_COINCIDENCIAS : new Set(searchChat([item], consulta).map((m) => m.key))), [item, consulta]);
  const resaltador = useCallback((t: string) => resalta(t, consulta), [consulta]);

  if (item.kind === 'tools') {
    return (
      <div className="chat__item">
        <ToolsView item={item} consulta={consulta} hits={hits} curKey={curKey} />
      </div>
    );
  }
  const hit = hits.has(item.key);
  const actual = curKey === item.key;
  const hora = item.at !== null ? ` · ${formatClock(item.at)}` : '';
  if (item.kind === 'user') {
    return (
      <div className={`chat__item chat__user${claseHit(hit, actual)}`} data-hit={hit ? item.key : undefined}>
        {item.text !== '' && <div className="chat__bubble">{resalta(item.text, consulta)}</div>}
        {item.images > 0 && <div className="chat__imgs">{item.images === 1 ? '1 imagen adjunta' : `${item.images} imágenes adjuntas`}</div>}
        <span className="chat__meta">Tú{hora}</span>
      </div>
    );
  }
  return (
    <div className={`chat__item chat__agent${claseHit(hit, actual)}`} data-hit={hit ? item.key : undefined}>
      <span className="chat__meta chat__meta--agent">
        <span className="chat__dot" aria-hidden="true" />
        Claude{hora}
      </span>
      <Markdown source={item.text} className="chat__md" highlight={consulta.trim() === '' ? undefined : resaltador} />
    </div>
  );
}

// Los elementos son inmutables: solo se repinta el que cambia (o todos, si cambia la búsqueda).
const ItemView = memo(ItemViewBase);

// ---------------------------------------------------------------------- Caja de entrada

/** Lo escrito y no enviado de cada sesión: sobrevive a pasar a la terminal y volver. */
const borradores = new Map<string, string>();

function Composer({ nombre, onSent }: { nombre: string; onSent: () => void }) {
  const [texto, setTexto] = useState(() => borradores.get(nombre) ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const idArea = useId();
  const idNota = useId();

  // Crece con el texto hasta un máximo; a partir de ahí, scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTO_MAX_CAJA)}px`;
  }, [texto]);

  const cambia = (t: string) => {
    setTexto(t);
    if (t === '') borradores.delete(nombre);
    else borradores.set(nombre, t);
    if (error !== null) setError(null);
  };

  const enviar = async () => {
    if (enviando) return;
    const c = checkChatMessage(texto);
    if (!c.ok) {
      setError(c.error);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await api.sendInput(nombre, c.text);
      setTexto('');
      borradores.delete(nombre);
      onSent();
    } catch (e) {
      const motivo = e instanceof ApiError ? e.message : 'No se pudo contactar con el panel.';
      setError(`No se envió el mensaje. ${motivo.replace(/\.?\s*$/, '.')} El texto sigue en la caja.`);
    } finally {
      setEnviando(false);
      area.current?.focus();
    }
  };

  const alPulsar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter envía; Mayús+Enter es un salto de línea. Con un compositor de texto (IME) abierto, Enter lo confirma.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void enviar();
    }
  };

  return (
    <div className="chat__foot">
      <div className="chat__composer">
        <label htmlFor={idArea} className="sr-only">
          Mensaje para Claude
        </label>
        <div className={`chat__box${error !== null ? ' chat__box--error' : ''}`}>
          <textarea
            id={idArea}
            ref={area}
            className="chat__input"
            rows={2}
            placeholder="Escribe a Claude…"
            value={texto}
            // Mientras envía no se puede editar, pero la caja conserva el foco (con `disabled` lo perdería).
            readOnly={enviando}
            aria-busy={enviando}
            aria-invalid={error !== null || undefined}
            aria-describedby={idNota}
            onChange={(e) => cambia(e.target.value)}
            onKeyDown={alPulsar}
          />
          <button type="button" className="chat__send" aria-label="Enviar" disabled={enviando || texto.trim() === ''} onClick={() => void enviar()}>
            <IconSend size={16} />
          </button>
        </div>
        {error !== null && (
          <div className="chat__senderr" role="alert">
            {error}
          </div>
        )}
        <span className="chat__hint" id={idNota}>
          Enter envía · Shift+Enter, salto de línea · permisos, menús y /comandos, en la terminal
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- Vista

type Props = {
  session: SessionInfo;
  /** Hay que leer la conversación (no hay un diálogo encima ni la pantalla está oculta). */
  active: boolean;
  searching: boolean;
  onSearching: (abierta: boolean) => void;
  /** Cambia cada vez que se pide abrir la búsqueda (Ctrl+F): devuelve el foco a su campo aunque ya estuviera abierta. */
  searchTick: number;
  onTerminal: () => void;
};

/**
 * Vista chat de una sesión de Claude (diseño «Vista chat»): la conversación de su transcripción,
 * con búsqueda y una caja para escribirle. Los mensajes de la persona se pintan como texto plano y
 * los del agente como Markdown saneado (ver `Markdown`); nunca HTML crudo.
 */
export function ChatBody({ session, active, searching, onSearching, searchTick, onTerminal }: Props) {
  const estado = visualState(session);
  const conv = useConversation(session.name, active, estado === 'working');
  const items = conv.chat.items;
  const esperando = estado === 'waiting';

  const [seguir, setSeguir] = useState(true);
  const cuerpo = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  // Con «seguir» activo baja hasta el final cuando el contenido crece; sus propios scrolls se ignoran un instante
  // en onScroll para no confundirlos con los de la persona (como en el seguimiento de subagentes).
  const alturaVista = useRef(0);
  const programatico = useRef(0);
  const vistos = useRef(0);
  useLayoutEffect(() => {
    const el = cuerpo.current;
    if (!el) return;
    const creció = el.scrollHeight !== alturaVista.current;
    alturaVista.current = el.scrollHeight;
    if (seguir) {
      vistos.current = items.length;
      if (creció || !atBottom(el)) {
        programatico.current = performance.now() + 150;
        el.scrollTop = el.scrollHeight;
      }
    }
  });

  // ---- Búsqueda
  const idBusca = useId();
  const campo = useRef<HTMLInputElement>(null);
  const [consulta, setConsulta] = useState('');
  const diferida = useDeferredValue(consulta);
  const activa = searching ? diferida : '';
  const coincidencias = useMemo(() => searchChat(items, activa), [items, activa]);
  const [claveActual, setClaveActual] = useState<string | null>(null);
  const indice = Math.max(0, coincidencias.findIndex((m) => m.key === claveActual));
  const actual = coincidencias[indice]?.key ?? null;
  const itemActual = coincidencias[indice]?.item ?? -1;

  useEffect(() => {
    if (!searching) return;
    campo.current?.focus();
    campo.current?.select();
  }, [searching, searchTick]);

  // Salta a la coincidencia actual: sus desplegables ya se abrieron al pintarla.
  useEffect(() => {
    if (actual === null) return;
    const el = lista.current?.querySelector(`[data-hit="${actual}"]`);
    if (!el) return;
    setSeguir(false);
    programatico.current = 0;
    el.scrollIntoView({ block: 'center' });
  }, [actual]);

  const ir = (delta: number) => {
    if (coincidencias.length === 0) return;
    setClaveActual(coincidencias[(indice + delta + coincidencias.length) % coincidencias.length]!.key);
  };
  const cerrar = () => {
    onSearching(false);
    cuerpo.current?.focus();
  };
  const alPulsarBusqueda = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
    } else if (e.target === campo.current && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      ir(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
    }
  };

  const nuevos = seguir ? 0 : countNewMessages(items, vistos.current);
  const alEnviar = () => {
    setSeguir(true);
    conv.refrescar();
    // El mensaje llega a la transcripción en cuanto Claude lo recibe: se pregunta una vez más enseguida.
    window.setTimeout(conv.refrescar, 700);
  };

  const cargando = !conv.synced && items.length === 0 && conv.error === null;
  const fallo = conv.error !== null && !conv.synced && items.length === 0;
  const vacia = conv.synced && items.length === 0;

  return (
    <div className="chat">
      {searching && (
        <div className="chat__search" role="search" onKeyDown={alPulsarBusqueda}>
          <label htmlFor={idBusca} className="sr-only">
            Buscar en la conversación
          </label>
          <div className={`chat__searchbox${consulta.trim() !== '' && coincidencias.length === 0 ? ' chat__searchbox--none' : ''}`}>
            <IconSearch size={14} />
            <input
              id={idBusca}
              ref={campo}
              className="chat__searchinput"
              type="text"
              value={consulta}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setConsulta(e.target.value);
                setClaveActual(null);
              }}
            />
            <span className={`chat__count-hits${consulta.trim() !== '' && coincidencias.length === 0 ? ' chat__count-hits--none' : ''}`} role="status">
              {consulta.trim() === '' ? '' : coincidencias.length === 0 ? 'Sin coincidencias' : `${indice + 1} de ${coincidencias.length}`}
            </span>
          </div>
          <button type="button" className="chat__sbtn" aria-label="Coincidencia anterior" disabled={coincidencias.length === 0} onClick={() => ir(-1)}>
            <IconChevronUp size={14} />
          </button>
          <button type="button" className="chat__sbtn" aria-label="Coincidencia siguiente" disabled={coincidencias.length === 0} onClick={() => ir(1)}>
            <IconChevronDown size={14} />
          </button>
          <button type="button" className="chat__sbtn chat__sbtn--plain" aria-label="Cerrar búsqueda (Esc)" onClick={cerrar}>
            <IconClose size={14} />
          </button>
        </div>
      )}
      {searching && consulta.trim() !== '' && coincidencias.length === 0 && (
        <p className="chat__searchtip">Busca en los mensajes, los nombres de las acciones y sus resultados, sin distinguir mayúsculas ni tildes.</p>
      )}

      <div className="chat__main">
        <div
          ref={cuerpo}
          className="chat__scroll"
          role="log"
          aria-live="off"
          aria-label="Conversación"
          tabIndex={0}
          // Cualquier scroll que no termine abajo suelta el seguimiento (rueda, barra, táctil, teclado, scrollIntoView).
          onScroll={(ev) => {
            const abajo = atBottom(ev.currentTarget);
            const propio = performance.now() < programatico.current;
            setSeguir((a) => followAfterScroll(a, abajo, propio));
          }}
        >
          {cargando ? (
            <div className="chat__state" role="status">
              <div className="chat__progress" aria-hidden="true">
                <div className="chat__progressfill" style={{ width: `${progressPercent(conv.from, conv.size)}%` }} />
              </div>
              <p>Cargando la conversación…</p>
              {conv.size > 0 && <p className="chat__statenote">{progressLabel(conv.from, conv.size)} · la búsqueda cubre todo en cuanto termina</p>}
            </div>
          ) : fallo ? (
            <div className="chat__state">
              <div className="chat__alert" role="alert">
                <span>
                  No se pudo leer la conversación. La terminal sigue funcionando.
                  <span className="chat__alertwhy"> {conv.error}</span>
                </span>
                <button type="button" className="chat__retry" onClick={conv.refrescar}>
                  Reintentar
                </button>
              </div>
            </div>
          ) : vacia ? (
            <div className="chat__state">
              <IconChat size={28} />
              <p>Todavía no hay mensajes en esta sesión.</p>
              <p className="chat__statenote">Escribe abajo para empezar.</p>
            </div>
          ) : (
            <div ref={lista} className={`chat__list${items.length > LISTA_LARGA ? ' chat__list--long' : ''}`}>
              {items.map((it, i) => (
                <ItemView key={it.key} item={it} consulta={activa} curKey={i === itemActual ? actual : null} />
              ))}
            </div>
          )}
        </div>
        {nuevos > 0 && (
          <button type="button" className="chat__newpill" onClick={() => setSeguir(true)}>
            <IconArrowDown size={13} />
            {newMessagesLabel(nuevos)}
          </button>
        )}
      </div>

      {conv.error !== null && conv.synced && (
        <div className="chat__stale" role="status">
          <span>Sin actualizar: {conv.error}</span>
          <button type="button" className="link-btn" onClick={conv.refrescar}>
            Reintentar
          </button>
        </div>
      )}

      {esperando && (
        <div className="chat__wait" role="status">
          <span className="chat__waitdot" aria-hidden="true" />
          <span className="chat__waittext">
            Claude espera tu respuesta en la terminal{session.notice !== '' ? `: ${session.notice}` : '.'}
          </span>
          <button type="button" className="chat__waitbtn" onClick={onTerminal}>
            Ir a la terminal
          </button>
        </div>
      )}

      <Composer nombre={session.name} onSent={alEnviar} />
    </div>
  );
}

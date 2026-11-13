import { Fragment, memo, startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { ApiError, api } from '../../api.ts';
import { checkChatMessage, parseBtw } from '../../../shared/chat.ts';
import type { ChatSendResponse } from '../../../shared/chat.ts';
import {
  actionsLabel,
  commandLine,
  countNewMessages,
  errorsLabel,
  findRanges,
  MAX_RESALTADAS,
  groupMatches,
  highlightRange,
  hitCountLabel,
  newMessagesLabel,
  newRepliesAnnouncement,
  progressLabel,
  progressPercent,
  resultText,
  searchChat,
  splitHighlight,
  stepKey,
  toolsSummary,
  waitingNotice,
  warmSearch,
  windowAround,
  windowDown,
  windowRange,
  windowUp,
  workingView,
} from '../../lib/chat.ts';
import type { ChatWindow } from '../../lib/chat.ts';
import type { ChatItem, ChatStep, ChatTurn } from '../../lib/chat.ts';
import { addBtw, btwOutcome, groupBtwByAnchor, removeBtw, updateBtw, useBtwBlocks } from '../../lib/btw.ts';
import type { BtwBlock } from '../../lib/btw.ts';
import { atBottom, followAfterScroll, resultNote } from '../../lib/follow.ts';
import { visualState } from '../../lib/sessions.ts';
import { formatClock } from '../../lib/statusline.ts';
import { insertAtCursor, pastedImages } from '../../lib/attachments.ts';
import { useConversation } from '../../lib/useConversation.ts';
import { useNow } from '../../lib/useNow.ts';
import { uploadImages } from '../../lib/uploadImages.ts';
import type { SessionInfo } from '../../types.ts';
import { IconArrowDown, IconChat, IconChevron, IconChevronDown, IconChevronUp, IconClose, IconSearch, IconSend } from '../Icons.tsx';
import { Markdown } from '../Markdown.tsx';
import { useFileDrop } from './useFileDrop.ts';

/** A partir de tantos elementos pintados se deja que el navegador se salte el pintado de lo que queda fuera de pantalla. */
const LISTA_LARGA = 1500;
const ALTO_MAX_CAJA = 200;
/** Espera tras la última tecla antes de buscar: en una conversación enorme cada búsqueda cuesta. */
export const RETARDO_BUSQUEDA = 200;
/** Cada cuánto se anuncian a un lector de pantalla las respuestas nuevas (se agrupan, no se lee cada una). */
const RETARDO_ANUNCIO = 1500;

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

/**
 * ¿Está el elemento en pantalla o cerca (600 px)? Sin `IntersectionObserver` se da por visto. Solo observa si `activo`:
 * se usa para no pintar `<mark>` en las coincidencias lejanas.
 */
function useCerca(ref: { current: Element | null }, activo: boolean): boolean {
  const [cerca, setCerca] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!activo || !el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((es) => es.forEach((e) => setCerca(e.isIntersecting)), { rootMargin: '600px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, activo]);
  return cerca;
}

/** Llama a `alVer` cada vez que el elemento entra en la zona visible del contenedor (con 400 px de margen). Se vuelve a observar al cambiar `dependencia`. */
function useAlVer(ref: { current: Element | null }, contenedor: { current: Element | null }, alVer: () => void, dependencia: unknown): void {
  const ultimo = useRef(alVer);
  ultimo.current = alVer;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && ultimo.current(), { root: contenedor.current, rootMargin: '400px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref, contenedor, dependencia]);
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

function ToolsView({
  item,
  consulta,
  hits,
  curKey,
  cerca,
}: {
  item: Extract<ChatItem, { kind: 'tools' }>;
  consulta: string;
  hits: ReadonlySet<string>;
  curKey: string | null;
  cerca: boolean;
}) {
  const caja = useRef<HTMLDetailsElement>(null);
  const [abierto, setAbierto] = useState(false);
  // Un grupo con coincidencias se abre al acercarse (o si tiene la actual); los lejanos no se pintan hasta entonces.
  const hay = hits.size > 0 && (cerca || curKey !== null);
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
            return <StepView key={s.id} paso={s} clave={k} consulta={hay ? consulta : ''} hit={hits.has(k)} actual={curKey === k} />;
          })}
        </div>
      )}
    </details>
  );
}

function ItemViewBase({ item, consulta: consultaItem, hits, curKey }: { item: ChatItem; consulta: string; hits: ReadonlySet<string>; curKey: string | null }) {
  // `hits` son las coincidencias de este elemento que se resaltan (las calcula ChatBody de una vez para toda la conversación).
  const raiz = useRef<HTMLDivElement>(null);
  const cerca = useCerca(raiz, hits.size > 0);
  // Los `<mark>` solo se pintan cerca de la pantalla (y siempre en la coincidencia actual): miles de marcas bloquean la página.
  const consulta = hits.size > 0 && (cerca || curKey !== null) ? consultaItem : '';
  const resaltador = useCallback((t: string) => resalta(t, consulta), [consulta]);

  if (item.kind === 'tools') {
    return (
      <div className="chat__item" ref={raiz}>
        <ToolsView item={item} consulta={consulta} hits={hits} curKey={curKey} cerca={cerca} />
      </div>
    );
  }
  const hit = hits.has(item.key);
  const actual = curKey === item.key;
  const hora = item.at !== null ? ` · ${formatClock(item.at)}` : '';
  if (item.kind === 'user') {
    return (
      <div ref={raiz} className={`chat__item chat__user${claseHit(hit, actual)}`} data-hit={hit ? item.key : undefined}>
        {item.text !== '' && <div className="chat__bubble">{resalta(item.text, consulta)}</div>}
        {item.images > 0 && <div className="chat__imgs">{item.images === 1 ? '1 imagen adjunta' : `${item.images} imágenes adjuntas`}</div>}
        <span className="chat__meta">Tú{hora}</span>
      </div>
    );
  }
  if (item.kind === 'command') {
    return (
      <div ref={raiz} className={`chat__item chat__user chat__cmd${claseHit(hit, actual)}`} data-hit={hit ? item.key : undefined}>
        <div className="chat__bubble chat__bubble--cmd">{resalta(commandLine(item), consulta)}</div>
        {item.output && <pre className={`chat__cmdout${item.output.error ? ' chat__cmdout--error' : ''}`}>{resalta(item.output.text, consulta)}</pre>}
        <span className="chat__meta">Tú{hora}</span>
      </div>
    );
  }
  return (
    <div ref={raiz} className={`chat__item chat__agent${claseHit(hit, actual)}`} data-hit={hit ? item.key : undefined}>
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

// ---------------------------------------------------------------------- Pregunta al margen (/btw)

/** La respuesta de /btw: aparte de la conversación (Claude no la guarda en su transcripción). */
function BtwView({ bloque, onTerminal }: { bloque: BtwBlock; onTerminal: () => void }) {
  return (
    <section className={`chat__item chat__btw chat__btw--${bloque.state}`} aria-label="Pregunta al margen">
      <div className="chat__btwhead">
        <span className="chat__btwtag">Pregunta al margen</span>
        <span className="chat__btwcmd">/btw</span>
      </div>
      <p className="chat__btwq">{bloque.question !== '' ? bloque.question : '(sin pregunta)'}</p>
      {bloque.state === 'waiting' && (
        <div className="chat__btwstate" role="status">
          <span className="chat__waitdot" aria-hidden="true" />
          Esperando la respuesta de /btw…
        </div>
      )}
      {/* Texto preformateado: la TUI de Claude ya lo maqueta (títulos, listas, código, sangría) y pasarlo por Markdown le quitaría los saltos de línea. */}
      {bloque.state === 'done' && <pre className="chat__btwans">{bloque.answer}</pre>}
      {bloque.state === 'done' && bloque.truncated && (
        <p className="chat__btwwarn">Puede estar incompleta: solo se pudo leer lo que mostraba la ventana de la terminal.</p>
      )}
      {bloque.state === 'pending' && (
        <div className="chat__btwstate chat__btwstate--warn" role="status">
          <span>No se pudo leer la respuesta a tiempo: la ventana de /btw sigue abierta en la terminal.</span>
          <button type="button" className="chat__waitbtn" onClick={onTerminal}>
            Ir a la terminal
          </button>
        </div>
      )}
      {bloque.state === 'empty' && (
        <div className="chat__btwstate chat__btwstate--warn" role="status">
          No se obtuvo respuesta de /btw. Escribe la pregunta detrás del comando, por ejemplo «/btw ¿qué archivo estábamos tocando?».
        </div>
      )}
      <p className="chat__btwnote">No forma parte de la conversación: Claude no la guarda y desaparece al recargar el panel.</p>
    </section>
  );
}

// ---------------------------------------------------------------------- Indicador de trabajo

/**
 * «Trabajando…» con el tiempo del turno y los tokens de salida, mientras Claude trabaja. Es un componente aparte para que
 * el reloj de cada segundo repinte solo esto y no toda la conversación. El lector de pantalla oye solo «Trabajando…»
 * (una vez, al aparecer): el tiempo y los tokens, que cambian sin parar, quedan fuera de la región.
 */
function WorkingIndicator({ turno, desde }: { turno: ChatTurn; desde: number }) {
  const ahora = useNow(1000);
  const v = workingView(turno, desde, ahora);
  return (
    <div className="chat__work">
      <span role="status">
        <span className="chat__spinner" aria-hidden="true" />
        Trabajando…
      </span>
      <span className="chat__worknum" aria-hidden="true">
        {v.elapsed}
        {v.tokens !== null && ` · ${v.tokens}`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------- Caja de entrada

/** Lo escrito y no enviado de cada sesión: sobrevive a pasar a la terminal y volver. */
const borradores = new Map<string, string>();

type ComposerProps = {
  nombre: string;
  onSent: (r: ChatSendResponse) => void;
  onTerminal: () => void;
  /** Dónde va la respuesta de un /btw: la sesión de Claude y los elementos que hay ahora en la conversación. */
  btwContext: () => { sessionId: string | null; anchor: number };
};

/** Un fallo de envío; `terminal` ofrece ir a la terminal (hay una ventana de Claude abierta). */
type SendError = { text: string; terminal: boolean };

function Composer({ nombre, onSent, onTerminal, btwContext }: ComposerProps) {
  const [texto, setTexto] = useState(() => borradores.get(nombre) ?? '');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  // Subidas de imágenes en curso (pegadas o soltadas) que aún no han escrito su ruta en la caja.
  const [subiendo, setSubiendo] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const textoActual = useRef(texto);
  textoActual.current = texto;
  // Dónde dejar el cursor tras insertar una ruta: se aplica cuando React ya ha pintado el texto nuevo.
  const cursorTras = useRef<number | null>(null);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const idArea = useId();
  const idNota = useId();

  // Crece con el texto hasta un máximo; a partir de ahí, scroll.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, ALTO_MAX_CAJA)}px`;
  }, [texto]);

  useLayoutEffect(() => {
    const c = cursorTras.current;
    if (c === null) return;
    cursorTras.current = null;
    area.current?.setSelectionRange(c, c);
  }, [texto]);

  const cambia = (t: string) => {
    textoActual.current = t;
    setTexto(t);
    if (t === '') borradores.delete(nombre);
    else borradores.set(nombre, t);
    if (error !== null) setError(null);
  };

  const enviar = async () => {
    if (enviando) return;
    const c = checkChatMessage(texto);
    if (!c.ok) {
      setError({ text: c.error, terminal: false });
      return;
    }
    setEnviando(true);
    setError(null);
    // /btw tarda en responder (Claude lo contesta en una ventana de la terminal): su bloque aparece ya, esperando.
    const btw = parseBtw(c.text);
    const bloque = btw ? addBtw(nombre, { question: btw.question, ...btwContext() }) : null;
    try {
      const r = await api.sendInput(nombre, c.text);
      setTexto('');
      borradores.delete(nombre);
      if (bloque !== null) updateBtw(nombre, bloque, btwOutcome(r));
      onSent(r);
    } catch (e) {
      if (bloque !== null) removeBtw(nombre, bloque);
      const motivo = e instanceof ApiError ? e.message : 'No se pudo contactar con el panel.';
      setError({ text: `No se envió el mensaje. ${motivo.replace(/\.?\s*$/, '.')} El texto sigue en la caja.`, terminal: e instanceof ApiError && e.code === 'tui-busy' });
    } finally {
      setEnviando(false);
      area.current?.focus();
    }
  };

  // Sube las imágenes y escribe sus rutas en el cursor (con un espacio detrás): Claude Code las convierte en adjuntos al enviar.
  const adjunta = async (archivos: File[]) => {
    if (enviando) return;
    setSubiendo((n) => n + 1);
    try {
      const { subidas, motivos } = await uploadImages(archivos);
      if (subidas.length > 0) {
        const rutas = subidas.map((s) => s.path).join(' ');
        const el = area.current;
        if (montado.current && el) {
          // El texto pudo cambiar mientras subía: el cursor se ajusta al que hay ahora.
          const actual = textoActual.current;
          const r = insertAtCursor(actual, Math.min(el.selectionStart, actual.length), Math.min(el.selectionEnd, actual.length), rutas);
          cursorTras.current = r.cursor;
          cambia(r.texto);
          el.focus();
        } else {
          // La vista se cerró mientras subía: la ruta no se pierde, queda en el borrador.
          const previo = borradores.get(nombre) ?? '';
          borradores.set(nombre, insertAtCursor(previo, previo.length, previo.length, rutas).texto);
        }
      }
      if (motivos.length > 0 && montado.current) setError({ text: `No se adjuntó. ${motivos.join(' ')}`, terminal: false });
    } finally {
      setSubiendo((n) => n - 1);
    }
  };
  const { dragging, dropProps } = useFileDrop((archivos) => void adjunta(archivos));

  // Pegar una imagen (y ningún texto) la sube; con texto, el pegado normal.
  const alPegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const datos = e.clipboardData;
    const archivos = pastedImages(Array.from(datos.files), datos.getData('text/plain'));
    if (archivos.length === 0) return;
    e.preventDefault();
    void adjunta(archivos);
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
        <div className={`chat__box${error !== null ? ' chat__box--error' : ''}${dragging ? ' chat__box--drop' : ''}`} {...dropProps}>
          <textarea
            id={idArea}
            ref={area}
            className="chat__input"
            rows={1}
            placeholder="Escribe a Claude…"
            value={texto}
            // Mientras envía no se puede editar, pero la caja conserva el foco (con `disabled` lo perdería).
            readOnly={enviando}
            aria-busy={enviando}
            aria-invalid={error !== null || undefined}
            aria-describedby={idNota}
            onChange={(e) => cambia(e.target.value)}
            onKeyDown={alPulsar}
            onPaste={alPegar}
          />
          {dragging && (
            <span className="chat__droptip" aria-hidden="true">
              Suelta para adjuntar la imagen
            </span>
          )}
          <button type="button" className="chat__send" aria-label="Enviar" disabled={enviando || texto.trim() === ''} onClick={() => void enviar()}>
            <IconSend size={16} />
          </button>
        </div>
        {subiendo > 0 && (
          <div className="chat__uploading" role="status">
            <span className="chat__spinner" aria-hidden="true" />
            {subiendo === 1 ? 'Subiendo imagen…' : 'Subiendo imágenes…'}
          </div>
        )}
        {error !== null && (
          <div className="chat__senderr" role="alert">
            <span>{error.text}</span>
            {error.terminal && (
              <button type="button" className="link-btn" onClick={onTerminal}>
                Ir a la terminal
              </button>
            )}
          </div>
        )}
        <span className="chat__hint" id={idNota}>
          Enter envía · Shift+Enter, salto de línea · pega o suelta imágenes · permisos y menús, en la terminal
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
  const aviso = waitingNotice(session.notice);
  // Respuestas de /btw: no están en la transcripción, van aparte, en el punto donde se preguntó.
  const btwTodos = useBtwBlocks(session.name);
  const btwPorPunto = useMemo(() => groupBtwByAnchor(btwTodos, conv.sessionId, items.length), [btwTodos, conv.sessionId, items.length]);
  const contextoBtw = useRef({ sessionId: conv.sessionId, anchor: items.length });
  contextoBtw.current = { sessionId: conv.sessionId, anchor: items.length };
  const [comandoEspera, setComandoEspera] = useState(false);

  const [seguir, setSeguir] = useState(true);
  const siguiendo = useRef(seguir);
  siguiendo.current = seguir;
  const cuerpo = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const marcaArriba = useRef<HTMLDivElement>(null);
  const marcaAbajo = useRef<HTMLDivElement>(null);

  // Ventana de render: una conversación de miles de elementos pinta solo los últimos y va cargando más al subir.
  const [ventana, setVentana] = useState<ChatWindow>(null);
  const [desde, hasta] = windowRange(ventana, items.length);
  const enCola = hasta >= items.length;
  const rango = useRef<[number, number]>([desde, hasta]);
  rango.current = [desde, hasta];
  // Altura y posición del scroll antes de añadir elementos por arriba: se restituye para que el contenido no salte.
  const anclaje = useRef<{ alto: number; top: number } | null>(null);
  const cambiaVentana = (f: (v: ChatWindow) => ChatWindow, arriba: boolean) => {
    const el = cuerpo.current;
    if (arriba && el) anclaje.current = { alto: el.scrollHeight, top: el.scrollTop };
    setVentana(f);
  };
  // Al acercarse al principio (o al final de un tramo) se cargan más elementos sin pulsar el botón.
  useAlVer(marcaArriba, cuerpo, () => cambiaVentana((v) => windowUp(v, items.length), true), desde);
  useAlVer(marcaAbajo, cuerpo, () => cambiaVentana((v) => windowDown(v, items.length), false), hasta);

  // Con «seguir» activo baja hasta el final cuando el contenido crece; sus propios scrolls se ignoran un instante
  // en onScroll para no confundirlos con los de la persona (como en el seguimiento de subagentes).
  const alturaVista = useRef(0);
  const programatico = useRef(0);
  const vistos = useRef(0);
  useLayoutEffect(() => {
    const el = cuerpo.current;
    if (!el) return;
    if (anclaje.current) {
      const { alto, top } = anclaje.current;
      anclaje.current = null;
      programatico.current = performance.now() + 150;
      el.scrollTop = top + (el.scrollHeight - alto);
    }
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
  // Lo que se busca va con retraso y en una transición: escribir nunca espera a una búsqueda en una conversación enorme.
  const [buscada, setBuscada] = useState('');
  useEffect(() => {
    if (consulta === buscada) return;
    if (consulta.trim() === '') {
      setBuscada(consulta);
      return;
    }
    const id = window.setTimeout(() => startTransition(() => setBuscada(consulta)), RETARDO_BUSQUEDA);
    return () => window.clearTimeout(id);
  }, [consulta, buscada]);
  const pendiente = consulta.trim() !== '' && consulta !== buscada;
  const activa = searching ? buscada : '';
  const coincidencias = useMemo(() => searchChat(items, activa), [items, activa]);
  const [claveActual, setClaveActual] = useState<string | null>(null);
  const indice = Math.max(0, coincidencias.findIndex((m) => m.key === claveActual));
  const actual = coincidencias[indice]?.key ?? null;
  const itemActual = coincidencias[indice]?.item ?? -1;
  // Coincidencias por elemento (se cuentan todas) y tramo de elementos que se resalta: solo las más cercanas a la actual.
  const porElemento = useMemo(() => groupMatches(coincidencias), [coincidencias]);
  const [resaltaDesde, resaltaHasta] = useMemo(() => {
    const [a, b] = highlightRange(coincidencias.length, indice);
    return a === b ? [-1, -1] : [coincidencias[a]!.item, coincidencias[b - 1]!.item];
  }, [coincidencias, indice]);

  // Con la búsqueda abierta se normaliza el texto de la conversación en ratos libres: la primera búsqueda sale ya preparada.
  useEffect(() => {
    if (!searching || !conv.synced) return;
    const pide = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    const quita = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    let id = 0;
    const paso = () => {
      id = pide ? pide(() => !warmSearch(items, 8) && paso()) : window.setTimeout(() => !warmSearch(items, 8) && paso(), 16);
    };
    paso();
    return () => (pide && quita ? quita(id) : window.clearTimeout(id));
  }, [searching, conv.synced, items]);

  useEffect(() => {
    if (!searching) return;
    campo.current?.focus();
    campo.current?.select();
  }, [searching, searchTick]);

  // Salta a la coincidencia actual: sus desplegables ya se abrieron al pintarla. Si queda fuera de la ventana
  // de render (una antigua), se pinta primero un tramo a su alrededor y el salto se hace en el pase siguiente.
  const saltado = useRef<string | null>(null);
  useEffect(() => {
    saltado.current = null;
  }, [activa]);
  useEffect(() => {
    if (actual === null) {
      saltado.current = null;
      return;
    }
    if (saltado.current === actual) return;
    if (itemActual < desde || itemActual >= hasta) {
      setVentana((v) => {
        const [d, h] = windowRange(v, items.length);
        return itemActual >= d && itemActual < h ? v : windowAround(itemActual, items.length);
      });
      return;
    }
    const el = lista.current?.querySelector(`[data-hit="${actual}"]`);
    if (!el) return;
    saltado.current = actual;
    // Solo si hace falta: un setState en cada salto, aunque no cambie nada, encadenaba efectos pasivos.
    if (siguiendo.current) setSeguir(false);
    // El scroll del salto lo provoca el código: onScroll no debe tocar la ventana ni el seguimiento por él.
    programatico.current = performance.now() + 150;
    el.scrollIntoView({ block: 'center' });
  }, [actual, itemActual, desde, hasta, items.length]);

  // Navegación por coincidencias agrupada: varias pulsaciones entre dos fotogramas (una ráfaga de Enter) solo
  // avanzan un índice acumulado, y un único `requestAnimationFrame` aplica el salto (coincidencia, ventana de
  // render y seguimiento en el mismo lote). Así una pulsación no encadena un render y un efecto por tecla
  // (React #185 con transcripts enormes) ni salta a coincidencias intermedias que nadie llega a ver.
  const nav = useRef<{ lista: typeof coincidencias; indice: number; total: number; pendiente: { lista: typeof coincidencias; indice: number } | null; raf: number }>({
    lista: coincidencias,
    indice,
    total: items.length,
    pendiente: null,
    raf: 0,
  });
  nav.current.lista = coincidencias;
  nav.current.indice = indice;
  nav.current.total = items.length;
  useEffect(
    () => () => {
      if (nav.current.raf !== 0) cancelAnimationFrame(nav.current.raf);
      nav.current.raf = 0;
    },
    [],
  );
  const aplicaSalto = useCallback(() => {
    const n = nav.current;
    n.raf = 0;
    const p = n.pendiente;
    // Si la búsqueda cambió entre medias, el índice acumulado ya no vale.
    if (!p || p.lista !== n.lista || p.lista.length === 0) return;
    const destino = p.lista[p.indice]!;
    setClaveActual(destino.key);
    // Fuera de la ventana de render, esta se mueve a su alrededor; dentro, se deja el mismo objeto (sin render de más).
    setVentana((v) => {
      const [d, h] = windowRange(v, n.total);
      return destino.item >= d && destino.item < h ? v : windowAround(destino.item, n.total);
    });
    setSeguir(false);
  }, []);
  const ir = (delta: number) => {
    const n = nav.current;
    const largo = n.lista.length;
    if (largo === 0) return;
    const base = n.pendiente !== null && n.pendiente.lista === n.lista ? n.pendiente.indice : n.indice;
    n.pendiente = { lista: n.lista, indice: (((base + delta) % largo) + largo) % largo };
    if (n.raf === 0) n.raf = requestAnimationFrame(aplicaSalto);
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
  const alFinal = () => {
    setVentana(null);
    setSeguir(true);
  };
  // Al volver a seguir el final se deja la ventana en «los últimos», para que no crezca sin límite.
  useEffect(() => {
    if (seguir) setVentana((v) => (v !== null && v.to === null ? null : v));
  }, [seguir]);

  // Lo que se anuncia a un lector de pantalla: las respuestas nuevas de Claude, agrupadas cada poco, sin leer su texto.
  // Con la pastilla visible (no se sigue el final) la anuncia ella misma.
  const [anuncio, setAnuncio] = useState('');
  const anunciados = useRef<number | null>(null);
  const alAnunciar = useRef({ items, seguir });
  alAnunciar.current = { items, seguir };
  useEffect(() => {
    if (!conv.synced || anunciados.current === null || items.length < anunciados.current) {
      anunciados.current = conv.synced ? items.length : null;
      return;
    }
    if (items.length === anunciados.current) return;
    let aviso = 0;
    const id = window.setTimeout(() => {
      const { items: ahora, seguir: siguiendo } = alAnunciar.current;
      const texto = newRepliesAnnouncement(ahora, anunciados.current ?? ahora.length);
      anunciados.current = ahora.length;
      if (texto === '' || !siguiendo) return;
      // Se vacía antes: un lector no repite un texto idéntico al anterior.
      setAnuncio('');
      aviso = window.setTimeout(() => setAnuncio(texto), 50);
    }, RETARDO_ANUNCIO);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(aviso);
    };
  }, [items, conv.synced]);

  const alEnviar = (r: ChatSendResponse) => {
    setComandoEspera(r.awaitingTerminal === true);
    alFinal();
    conv.refrescar();
    // El mensaje llega a la transcripción en cuanto Claude lo recibe: se pregunta una vez más enseguida.
    window.setTimeout(conv.refrescar, 700);
  };

  const cargando = !conv.synced && items.length === 0 && conv.error === null;
  const fallo = conv.error !== null && !conv.synced && items.length === 0;
  const vacia = conv.synced && items.length === 0 && btwPorPunto.size === 0;

  return (
    <div className="chat">
      {searching && (
        <div className="chat__search" role="search" onKeyDown={alPulsarBusqueda}>
          <label htmlFor={idBusca} className="sr-only">
            Buscar en la conversación
          </label>
          <div className={`chat__searchbox${consulta.trim() !== '' && !pendiente && coincidencias.length === 0 ? ' chat__searchbox--none' : ''}`}>
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
            <span
              className={`chat__count-hits${consulta.trim() !== '' && !pendiente && coincidencias.length === 0 ? ' chat__count-hits--none' : ''}`}
              role="status"
              title={coincidencias.length > MAX_RESALTADAS ? `Se cuentan todas, pero solo se resaltan las ${MAX_RESALTADAS} más cercanas a la actual.` : undefined}
            >
              {consulta.trim() === '' ? '' : pendiente ? 'Buscando…' : hitCountLabel(indice, coincidencias.length)}
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
      {searching && consulta.trim() !== '' && !pendiente && coincidencias.length === 0 && (
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
          // Solo se vuelve a seguir al llegar abajo si la ventana de render llega al último elemento.
          onScroll={(ev) => {
            const abajo = atBottom(ev.currentTarget);
            const propio = performance.now() < programatico.current;
            // Al soltar el final, la ventana se fija para que los elementos nuevos no desplacen lo que se está leyendo.
            if (!abajo && !propio) setVentana((v) => v ?? { from: rango.current[0], to: null });
            setSeguir((a) => followAfterScroll(a, abajo && enCola, propio));
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
            <div ref={lista} className={`chat__list${hasta - desde > LISTA_LARGA ? ' chat__list--long' : ''}`}>
              {desde > 0 && (
                <div ref={marcaArriba} className="chat__more">
                  <button type="button" className="chat__morebtn" onClick={() => cambiaVentana((v) => windowUp(v, items.length), true)}>
                    <IconChevronUp size={13} />
                    Mostrar anteriores ({desde.toLocaleString('es-ES')} más)
                  </button>
                </div>
              )}
              {items.slice(desde, hasta).map((it, k) => {
                const i = desde + k;
                const conCoincidencias = i >= resaltaDesde && i <= resaltaHasta;
                return (
                  <Fragment key={it.key}>
                    {btwPorPunto.get(i)?.map((b) => <BtwView key={b.id} bloque={b} onTerminal={onTerminal} />)}
                    <ItemView item={it} consulta={conCoincidencias ? activa : ''} hits={(conCoincidencias && porElemento.get(i)) || SIN_COINCIDENCIAS} curKey={i === itemActual ? actual : null} />
                  </Fragment>
                );
              })}
              {enCola && btwPorPunto.get(items.length)?.map((b) => <BtwView key={b.id} bloque={b} onTerminal={onTerminal} />)}
              {!enCola && (
                <div ref={marcaAbajo} className="chat__more">
                  <button type="button" className="chat__morebtn" onClick={() => cambiaVentana((v) => windowDown(v, items.length), false)}>
                    <IconChevronDown size={13} />
                    Mostrar siguientes ({(items.length - hasta).toLocaleString('es-ES')} más)
                  </button>
                  <button type="button" className="chat__morebtn" onClick={alFinal}>
                    <IconArrowDown size={13} />
                    Ir al final
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* La región existe siempre: así el lector de pantalla anuncia la pastilla cuando aparece o cambia su cuenta. */}
        <div className="chat__pillslot" role="status">
          {nuevos > 0 && (
            <button type="button" className="chat__newpill" onClick={alFinal}>
              <IconArrowDown size={13} />
              {newMessagesLabel(nuevos)}
            </button>
          )}
        </div>
        <div className="sr-only" role="status" aria-atomic="true">
          {anuncio}
        </div>
      </div>

      {conv.error !== null && conv.synced && (
        <div className="chat__stale" role="status">
          <span>Sin actualizar: {conv.error}</span>
          <button type="button" className="link-btn" onClick={conv.refrescar}>
            Reintentar
          </button>
        </div>
      )}

      {estado === 'working' && <WorkingIndicator turno={conv.chat.turn} desde={session.updatedAt} />}

      {esperando && (
        <div className="chat__wait" role="status">
          <span className="chat__waitdot" aria-hidden="true" />
          <span className="chat__waittext">
            {aviso.text}
            {aviso.detail !== null && <span className="chat__waitdetail">{aviso.translated ? aviso.detail : `«${aviso.detail}»`}</span>}
          </span>
          <button type="button" className="chat__waitbtn" onClick={onTerminal}>
            Ir a la terminal
          </button>
        </div>
      )}

      {comandoEspera && (
        <div className="chat__wait" role="status">
          <span className="chat__waitdot" aria-hidden="true" />
          <span className="chat__waittext">El comando espera en la terminal: ábrela para responderlo. No se envían más mensajes hasta que se cierre.</span>
          <button type="button" className="chat__waitbtn" onClick={onTerminal}>
            Ir a la terminal
          </button>
          <button type="button" className="link-btn" onClick={() => setComandoEspera(false)}>
            Descartar
          </button>
        </div>
      )}

      <Composer nombre={session.name} onSent={alEnviar} onTerminal={onTerminal} btwContext={() => contextoBtw.current} />
    </div>
  );
}

import { Fragment, createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api } from '../../api.ts';
import { ANSWER_TEXT_MAX_CHARS, NOT_PENDING_CODE } from '../../../shared/chat.ts';
import type { PromptInfo } from '../../../shared/chat.ts';
import type { ChatItem } from '../../lib/chat.ts';
import {
  answeredClock,
  answeredCount,
  answeredView,
  buildAnswers,
  chooseOption,
  dropDraft,
  loadDraft,
  markAnsweredFromChat,
  pendingSend,
  permissionView,
  progressText,
  questionReadiness,
  questionsLabel,
  saveDraft,
  selectOther,
  setOtherText,
  splitRecommended,
  toggleOther,
  trackSend,
  wasAnsweredFromChat,
} from '../../lib/prompts.ts';
import type { Draft, QuestionReadiness, SendOutcome, Selection } from '../../lib/prompts.ts';
import { IconAlert, IconCheck, IconClose } from '../Icons.tsx';
import { resalta } from './chatHighlight.tsx';

// Tarjetas del chat para lo que Claude Code espera en su terminal y el chat sabe contestar (diseño «Pregunta pendiente
// en el chat»): una pregunta de `AskUserQuestion` (pendiente, respondida) y un diálogo de permiso. Lo que llega de la
// transcripción o de la pantalla se pinta siempre como texto plano.

type QuestionChatItem = Extract<ChatItem, { kind: 'question' }>;
type PermissionPrompt = Extract<PromptInfo, { kind: 'permission' }>;

/** Lo que las tarjetas necesitan del chat que las contiene. */
export type PromptContextValue = {
  nombre: string;
  /** La sesión está en `waiting`. */
  esperando: boolean;
  /** Lo último que se leyó de la terminal (null: nada abierto, aún sin leer o sin sesión en espera). */
  prompt: PromptInfo | null;
  onTerminal: () => void;
  /** Consulta ya qué hay abierto y resuelve con lo leído aplicado. */
  refrescarPrompt: () => Promise<void>;
  /** Lee ya lo nuevo de la conversación. */
  refrescarConversacion: () => void;
};

export const PromptContext = createContext<PromptContextValue | null>(null);

/** Un fallo de envío, tal como lo explica el servidor. */
type Fallo = { text: string };

const motivoDe = (e: unknown): string => (e instanceof ApiError ? e.message : 'No se pudo contactar con el panel.');

/** Sigue montado: el envío tarda y la tarjeta puede cambiar (o irse) mientras tanto. */
function useMontado(): { current: boolean } {
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  return montado;
}

/** Tras enviar, la conversación se vuelve a leer enseguida y una vez más poco después (el resultado llega con Claude ya trabajando). */
function refrescaTrasContestar(ctx: PromptContextValue): void {
  ctx.refrescarConversacion();
  window.setTimeout(ctx.refrescarConversacion, 700);
}

function ErrorDeEnvio({ fallo, onTerminal, etiqueta = 'Ir a la terminal' }: { fallo: Fallo; onTerminal: () => void; etiqueta?: string }) {
  // La alerta sale bajo un botón que puede estar fuera de la vista (una tarjeta alta): se lleva a la vista y recibe el foco
  // (tabIndex -1: no entra en el orden de tabulación), para que quien usa teclado o lector de pantalla la encuentre.
  const alerta = useRef<HTMLDivElement>(null);
  useEffect(() => {
    alerta.current?.focus({ preventScroll: true });
    alerta.current?.scrollIntoView?.({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);
  return (
    <div className="chat__qerr" role="alert" ref={alerta} tabIndex={-1}>
      <IconAlert size={18} className="chat__qerricon" />
      <div className="chat__qerrbody">
        <strong>No se ha podido contestar desde el chat.</strong>
        <span>{fallo.text}</span>
      </div>
      <button type="button" className="chat__waitbtn chat__qerrbtn" onClick={onTerminal}>
        {etiqueta}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------- Pregunta

/** La tarjeta de una pregunta de Claude: pendiente (se contesta aquí) o respondida (queda en la conversación). */
export function QuestionCard({ item, consulta }: { item: QuestionChatItem; consulta: string }) {
  return item.result ? <AnsweredQuestion item={item} consulta={consulta} /> : <PendingQuestion item={item} consulta={consulta} />;
}

function Cabecera({ id, titulo, meta, derecha }: { id: string; titulo: string; meta?: ReactNode; derecha?: ReactNode }) {
  return (
    <div className="chat__qhead">
      <span className="chat__qdot" aria-hidden="true" />
      <h3 id={id} className="chat__qtitle">
        {titulo}
      </h3>
      {meta !== undefined && <span className="chat__qmeta">{meta}</span>}
      {derecha !== undefined && <span className="chat__qmeta chat__qprog">{derecha}</span>}
    </div>
  );
}

/** El pie dice por qué no se puede enviar todavía. */
function notaDeEstado(r: QuestionReadiness): string {
  switch (r) {
    case 'ready':
      return 'El panel la contesta en la terminal por ti.';
    case 'started':
      return 'Ya has empezado a contestarla en la terminal: termínala allí.';
    case 'not-open':
      return 'Esperando a que la terminal muestre la pregunta…';
    case 'not-waiting':
      return 'Se podrá contestar desde aquí cuando Claude espere tu respuesta.';
  }
}

type Fase = 'idle' | 'sending' | 'sent' | 'gone';

function PendingQuestion({ item, consulta }: { item: QuestionChatItem; consulta: string }) {
  const ctx = useContext(PromptContext);
  const nombre = ctx?.nombre ?? '';
  const { questions } = item;
  const [draft, setDraft] = useState<Draft>(() => loadDraft(nombre, item.id, questions));
  // Si la tarjeta cambia de sitio (al final → su línea de la conversación) con el envío en marcha o ya enviado, sigue así.
  const [fase, setFase] = useState<Fase>(() => (pendingSend(nombre, item.id) !== null ? 'sending' : wasAnsweredFromChat(nombre, item.id) ? 'sent' : 'idle'));
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const montado = useMontado();
  const idTitulo = useId();
  const idEstado = useId();
  const nombreGrupo = useId();

  const readiness = questionReadiness(item, ctx?.esperando ?? false, ctx?.prompt ?? null);
  const hechas = answeredCount(draft);
  const completo = hechas === questions.length;
  const bloqueada = fase !== 'idle';
  const puede = readiness === 'ready' && completo && !bloqueada && ctx !== null;

  const cambia = (i: number, f: (s: Selection) => Selection) => {
    const nuevo = draft.map((s, k) => (k === i ? f(s) : s));
    setDraft(nuevo);
    saveDraft(nombre, item.id, nuevo);
    if (fallo !== null) setFallo(null);
  };

  const aplica = (r: SendOutcome) => {
    if (!montado.current) return;
    if (r === 'sent') setFase('sent');
    else if (r === 'gone') setFase('gone');
    else {
      setFase('idle');
      setFallo({ text: r.error });
    }
  };

  // Un envío que sigue en marcha al montarse (la tarjeta cambió de sitio) se espera igual que si se hubiera lanzado aquí.
  useEffect(() => {
    const envio = pendingSend(nombre, item.id);
    if (envio === null) return;
    let vigente = true;
    void envio.then((r) => vigente && aplica(r));
    return () => {
      vigente = false;
    };
  }, [nombre, item.id]);

  const enviar = async () => {
    if (!puede || ctx === null) return;
    setFase('sending');
    setFallo(null);
    const respuestas = buildAnswers(draft);
    // Los efectos del envío (marcar, releer) no dependen de que la tarjeta siga montada.
    const envio = trackSend(
      ctx.nombre,
      item.id,
      (async (): Promise<SendOutcome> => {
        try {
          await api.answer(ctx.nombre, { kind: 'question', id: item.id, answers: respuestas });
          markAnsweredFromChat(ctx.nombre, item.id);
          refrescaTrasContestar(ctx);
          void ctx.refrescarPrompt();
          return 'sent';
        } catch (e) {
          if (e instanceof ApiError && e.code === NOT_PENDING_CODE) {
            // Ya no estaba pendiente (se contestó en la terminal): sin ruido, la conversación la marcará como respondida.
            refrescaTrasContestar(ctx);
            return 'gone';
          }
          void ctx.refrescarPrompt();
          return { error: motivoDe(e) };
        }
      })(),
    );
    aplica(await envio);
  };

  return (
    <section className={`chat__q${bloqueada ? ' chat__q--locked' : ''}`} aria-labelledby={idTitulo}>
      <Cabecera id={idTitulo} titulo="Claude te pregunta" meta={questionsLabel(questions.length)} derecha={progressText(hechas, questions.length)} />
      {questions.map((q, i) => (
        <Fragment key={i}>
          {i > 0 && <hr className="chat__qsep" />}
          <QuestionFields q={q} sel={draft[i]!} name={`${nombreGrupo}-${i}`} bloqueada={bloqueada} consulta={consulta} onChange={(f) => cambia(i, f)} />
        </Fragment>
      ))}
      <div className="chat__qfoot">
        {fase === 'sending' || fase === 'sent' || fase === 'gone' ? (
          <span className="chat__qstate" role="status" id={idEstado}>
            <span className="chat__qspin" aria-hidden="true" />
            {fase === 'sending' ? 'Contestando en la terminal…' : fase === 'sent' ? 'Respuesta enviada. Esperando a que Claude la registre…' : 'La pregunta ya no estaba pendiente. Actualizando…'}
          </span>
        ) : (
          <span className="chat__qnote">{notaDeEstado(readiness)}</span>
        )}
        {!bloqueada && ctx !== null && (
          <button type="button" className="link-btn chat__qlink" onClick={ctx.onTerminal}>
            Contestar en la terminal
          </button>
        )}
        <button type="button" className="chat__qsend" disabled={!puede} onClick={() => void enviar()}>
          {fase === 'sending' ? 'Enviando…' : fase === 'sent' || fase === 'gone' ? 'Enviada' : 'Enviar respuestas'}
        </button>
      </div>
      {fallo !== null && ctx !== null && <ErrorDeEnvio fallo={fallo} onTerminal={ctx.onTerminal} />}
    </section>
  );
}

type FieldsProps = {
  q: QuestionChatItem['questions'][number];
  sel: Selection;
  name: string;
  bloqueada: boolean;
  consulta: string;
  onChange: (f: (s: Selection) => Selection) => void;
};

/** Una pregunta: su cabecera, su texto y sus opciones, con «Otra respuesta» al final. */
function QuestionFields({ q, sel, name, bloqueada, consulta, onChange }: FieldsProps) {
  const base = useId();
  const multi = q.multiSelect;
  const tipo = multi ? 'checkbox' : 'radio';
  const otro = useRef<HTMLInputElement>(null);
  const idNota = `${base}-nota`;
  return (
    <fieldset className="chat__qset" disabled={bloqueada}>
      <legend className="chat__qlegend">
        <span className="chat__qchiprow">
          {q.header !== '' && <span className="chat__chip">{resalta(q.header, consulta)}</span>}
          {multi && <span className="chat__qmulti">Puedes elegir varias</span>}
        </span>
        <span className="chat__qtext">{resalta(q.question, consulta)}</span>
      </legend>
      {q.options.map((o, j) => {
        const on = sel.options.includes(j);
        const idDesc = `${base}-d${j}`;
        const { text: etiqueta, recommended } = splitRecommended(o.label);
        return (
          <label key={j} className={`chat__qopt${on ? ' chat__qopt--on' : ''}`}>
            <input type={tipo} name={name} checked={on} aria-describedby={o.description !== '' ? idDesc : undefined} onChange={() => onChange((s) => chooseOption(s, multi, j))} />
            <span className="chat__qoptbody">
              <span className="chat__qlabel">
                {resalta(etiqueta, consulta)}
                {recommended && <span className="chat__qrec">Recomendada</span>}
              </span>
              {o.description !== '' && (
                <span className="chat__qdesc" id={idDesc}>
                  {resalta(o.description, consulta)}
                </span>
              )}
            </span>
          </label>
        );
      })}
      <label className={`chat__qopt chat__qopt--other${sel.other ? ' chat__qopt--on' : ''}`}>
        <input
          type={tipo}
          name={name}
          checked={sel.other}
          onChange={() => {
            // Marcarla lleva al texto; en las múltiples, desmarcarla no lo toca.
            const marcara = !(multi && sel.other);
            onChange((s) => toggleOther(s, multi));
            if (marcara) otro.current?.focus();
          }}
        />
        <span className="chat__qotherlbl">Otra respuesta</span>
        <input
          ref={otro}
          type="text"
          className="chat__qtextin"
          aria-label={`Otra respuesta a la pregunta ${q.header !== '' ? q.header : q.question}`}
          aria-describedby={sel.other ? idNota : undefined}
          placeholder="Escribe tu respuesta…"
          autoComplete="off"
          maxLength={ANSWER_TEXT_MAX_CHARS}
          value={sel.text}
          onFocus={() => !sel.other && onChange((s) => selectOther(s, multi))}
          onChange={(e) => onChange((s) => setOtherText(s, multi, e.target.value))}
        />
      </label>
      {sel.other && (
        <span className="chat__qnote chat__qnote--field" id={idNota}>
          El texto se envía en una sola línea: los saltos de línea se cambian por espacios.
        </span>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------- Pregunta respondida

function AnsweredQuestion({ item, consulta }: { item: QuestionChatItem; consulta: string }) {
  const ctx = useContext(PromptContext);
  const nombre = ctx?.nombre ?? '';
  const idTitulo = useId();
  // Con la respuesta registrada, la selección guardada ya no sirve.
  useEffect(() => dropDraft(nombre, item.id), [nombre, item.id]);
  const v = answeredView(item);
  const desdeElChat = wasAnsweredFromChat(nombre, item.id);
  const hora = answeredClock(v.at);
  return (
    <section className="chat__qa" aria-labelledby={idTitulo}>
      <div className="chat__qahead">
        {v.declined ? <IconClose size={14} className="chat__qaicon chat__qaicon--no" /> : <IconCheck size={14} className="chat__qaicon" />}
        <h3 id={idTitulo} className="chat__qadone">
          {v.declined ? 'Sin respuesta' : 'Respondida'}
        </h3>
        {desdeElChat && !v.declined && <span>· desde el chat</span>}
        {hora !== null && <span>· {hora}</span>}
      </div>
      <div className="chat__qagrid">
        {v.rows.map((f, i) => (
          <Fragment key={i}>
            {f.header !== '' ? <span className="chat__chip">{resalta(f.header, consulta)}</span> : <span />}
            <span className="chat__qarow">
              <span className="chat__qaq">{resalta(f.question, consulta)}</span>
              {f.answer !== null && (
                <>
                  {' → '}
                  {f.chosen.length > 0 && <strong>{resalta(f.chosen.join(', '), consulta)}</strong>}
                  {f.own !== null && (
                    <>
                      {f.chosen.length > 0 && ', '}
                      <span className="chat__qaown">«{resalta(f.own, consulta)}»</span> <span className="chat__qaownnote">(texto propio)</span>
                    </>
                  )}
                </>
              )}
            </span>
          </Fragment>
        ))}
      </div>
      {v.note !== null && <p className="chat__qanote">{resalta(v.note, consulta)}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------- Permiso

/**
 * El diálogo de permiso de una herramienta: lo que quiere hacer (lo que dice el hook de la herramienta y, sin él, el paso de la
 * conversación, si se sabe cuál es), la pregunta de la terminal y las opciones tal como las ofrece. Elegir una la pulsa en la terminal; la tarjeta se va cuando el diálogo se cierra.
 */
export function PermissionCard({ prompt, step }: { prompt: PermissionPrompt; step: { verb: string; target: string; detail?: string } | null }) {
  const ctx = useContext(PromptContext);
  const [elegida, setElegida] = useState<number | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const montado = useMontado();
  const idTitulo = useId();

  const elegir = async (n: number, label: string) => {
    if (ctx === null || elegida !== null) return;
    setElegida(n);
    setFallo(null);
    try {
      await api.answer(ctx.nombre, { kind: 'permission', option: n, label });
      refrescaTrasContestar(ctx);
      // Con lo ya leído de la terminal: si el diálogo se cerró, esta tarjeta se va; si hay otro igual, se puede contestar.
      await ctx.refrescarPrompt();
    } catch (e) {
      if (montado.current) setFallo({ text: motivoDe(e) });
      void ctx.refrescarPrompt();
    } finally {
      if (montado.current) setElegida(null);
    }
  };

  const enviando = elegida !== null;
  // Con el hook, lo que pide la herramienta viene completo (comando entero, dónde, descripción); sin él, el paso de la conversación.
  const vista = prompt.input !== undefined ? permissionView(prompt.input) : null;
  return (
    <section className={`chat__perm${enviando ? ' chat__q--locked' : ''}`} aria-labelledby={idTitulo}>
      <Cabecera id={idTitulo} titulo="Claude pide permiso" meta={prompt.tool !== null ? `para usar ${prompt.tool}` : undefined} />
      <div className="chat__permbody">
        {vista !== null ? (
          <>
            <span className="chat__permlead">
              {vista.lead}
              {vista.where !== null && (
                <>
                  {' en '}
                  <code className="chat__permcode">{vista.where}</code>
                </>
              )}
              {vista.text !== '' ? ':' : ''}
            </span>
            {vista.text !== '' && <pre className="chat__permpre">{vista.text}</pre>}
            {vista.note !== null && <span className="chat__permdetail">{vista.note}</span>}
          </>
        ) : step !== null ? (
          <>
            <span className="chat__permlead">{step.verb}</span>
            {step.target !== '' && <pre className="chat__permpre">{step.target}</pre>}
            {step.detail !== undefined && <span className="chat__permdetail">{step.detail}</span>}
          </>
        ) : (
          <span className="chat__permlead">{prompt.title}</span>
        )}
        {prompt.question !== '' && <span className="chat__permask">{prompt.question}</span>}
        <div className="chat__permopts" role="group" aria-label="Opciones de la terminal">
          {prompt.options.map((o, k) => (
            <button
              key={o.n}
              type="button"
              className={`chat__permopt${k === 0 ? ' chat__permopt--first' : ''}`}
              disabled={enviando || ctx === null}
              onClick={() => void elegir(o.n, o.label)}
            >
              <span className="chat__permn" aria-hidden="true">
                {o.n}
              </span>
              <span className="chat__permlabel">{o.label}</span>
            </button>
          ))}
        </div>
        {enviando && (
          <span className="chat__qstate" role="status">
            <span className="chat__qspin" aria-hidden="true" />
            Contestando en la terminal…
          </span>
        )}
        {fallo !== null && ctx !== null && <ErrorDeEnvio fallo={fallo} onTerminal={ctx.onTerminal} />}
      </div>
      <div className="chat__qfoot chat__qfoot--perm">
        <span className="chat__qnote">Opciones tal como las ofrece la terminal. Al elegir, el panel la pulsa por ti.</span>
        {ctx !== null && (
          <button type="button" className="link-btn chat__qlink" onClick={ctx.onTerminal}>
            Ver en la terminal
          </button>
        )}
      </div>
    </section>
  );
}

import { describe, expect, it } from 'vitest';
import type { PromptInfo } from '../../shared/chat.ts';
import type { AgentEvent, QuestionItem } from '../../shared/follow.ts';
import { EMPTY_CHAT, applyChatEvents } from './chat.ts';
import type { ChatItem } from './chat.ts';
import {
  answeredCount,
  answeredView,
  splitAnswer,
  buildAnswers,
  chooseOption,
  emptyDraft,
  fitDraft,
  forgetPrompts,
  isAnswered,
  loadDraft,
  markAnsweredFromChat,
  pendingQuestion,
  permissionView,
  progressText,
  promptQuestionItem,
  questionReadiness,
  saveDraft,
  selectOther,
  trackSend,
  pendingSend,
  splitRecommended,
  answeredClock,
  questionSearchTexts,
  setOtherText,
  toggleOther,
  toolStep,
  wasAnsweredFromChat,
  waitingView,
} from './prompts.ts';

const opciones = (...labels: string[]) => labels.map((label) => ({ label, description: `desc ${label}` }));
const simple: QuestionItem = { question: '¿Tamaño?', header: 'Tamaño', multiSelect: false, options: opciones('Pequeño', 'Mediano', 'Grande') };
const multi: QuestionItem = { question: '¿Frutas?', header: 'Frutas', multiSelect: true, options: opciones('Pera', 'Uva', 'Kiwi') };

const question = (id: string, questions: QuestionItem[] = [simple]): AgentEvent => ({ type: 'question', id, questions, at: 1 });
const itemDe = (eventos: AgentEvent[]): Extract<ChatItem, { kind: 'question' }> => {
  const it = applyChatEvents(EMPTY_CHAT, eventos).items.find((i) => i.kind === 'question');
  if (!it || it.kind !== 'question') throw new Error('sin pregunta');
  return it;
};

describe('selección', () => {
  const vacia = emptyDraft(1)[0]!;

  it('en las simples elegir una opción sustituye a la anterior y a «Otra respuesta»', () => {
    let s = chooseOption(vacia, false, 1);
    s = chooseOption(s, false, 2);
    expect(s.options).toEqual([2]);
    s = selectOther(s, false);
    expect(s).toMatchObject({ options: [], other: true });
    expect(chooseOption(s, false, 0)).toMatchObject({ options: [0], other: false });
  });

  it('en las múltiples marca y desmarca, en orden, y «Otra respuesta» se suma', () => {
    let s = chooseOption(vacia, true, 2);
    s = chooseOption(s, true, 0);
    expect(s.options).toEqual([0, 2]);
    s = selectOther(s, true);
    expect(s).toMatchObject({ options: [0, 2], other: true });
    expect(chooseOption(s, true, 0).options).toEqual([2]);
    expect(toggleOther(s, true).other).toBe(false);
    expect(toggleOther(toggleOther(s, true), true).other).toBe(true);
  });

  it('escribir en «Otra respuesta» la marca, y en las simples quita la opción', () => {
    const s = setOtherText(chooseOption(vacia, false, 1), false, 'a mi manera');
    expect(s).toEqual({ options: [], other: true, text: 'a mi manera' });
    expect(setOtherText(vacia, true, 'x').other).toBe(true);
  });

  it('el texto solo cuenta si «Otra respuesta» está marcada y no es solo espacios', () => {
    expect(isAnswered({ options: [], other: false, text: 'hola' })).toBe(false);
    expect(isAnswered({ options: [], other: true, text: '  \n ' })).toBe(false);
    expect(isAnswered({ options: [], other: true, text: 'hola' })).toBe(true);
    expect(isAnswered({ options: [1], other: false, text: '' })).toBe(true);
    expect(answeredCount([{ options: [1], other: false, text: '' }, vacia])).toBe(1);
  });

  it('buildAnswers arma el cuerpo de POST /answer: una entrada por pregunta, índices ascendentes y el texto en una línea', () => {
    const draft = [
      { options: [], other: true, text: '  mi\ntexto   propio ' },
      { options: [2, 0], other: true, text: 'y más' },
      { options: [1], other: false, text: 'ignorado' },
    ];
    expect(buildAnswers(draft)).toEqual([{ options: [], text: 'mi texto   propio' }, { options: [0, 2], text: 'y más' }, { options: [1] }]);
  });

  it('una selección guardada solo se reutiliza si encaja con las preguntas', () => {
    const buena = [{ options: [2], other: false, text: '' }];
    expect(fitDraft(buena, [simple])).toBe(buena);
    expect(fitDraft(buena, [simple, multi])).toEqual(emptyDraft(2));
    expect(fitDraft([{ options: [7], other: false, text: '' }], [simple])).toEqual(emptyDraft(1));
    expect(fitDraft(undefined, [simple])).toEqual(emptyDraft(1));
  });

  it('los borradores son por sesión y pregunta, y se olvidan', () => {
    const d = [{ options: [1], other: false, text: '' }];
    saveDraft('s1', 'q1', d);
    expect(loadDraft('s1', 'q1', [simple])).toBe(d);
    expect(loadDraft('s1', 'q2', [simple])).toEqual(emptyDraft(1));
    expect(loadDraft('s2', 'q1', [simple])).toEqual(emptyDraft(1));
    markAnsweredFromChat('s1', 'q1');
    expect(wasAnsweredFromChat('s1', 'q1')).toBe(true);
    expect(wasAnsweredFromChat('s2', 'q1')).toBe(false);
    forgetPrompts('s1');
    expect(loadDraft('s1', 'q1', [simple])).toEqual(emptyDraft(1));
    expect(wasAnsweredFromChat('s1', 'q1')).toBe(false);
  });
});

describe('pregunta respondida', () => {
  it('une cada pregunta con su respuesta (por el texto de la pregunta)', () => {
    const it = itemDe([question('q1', [simple, multi]), { type: 'result', id: 'q1', error: false, summary: 'ok', lines: 1, answers: { '¿Tamaño?': 'Mediano', '¿Frutas?': 'Pera, Uva, mi fruta' } }]);
    expect(answeredView(it)).toEqual({
      rows: [
        { header: 'Tamaño', question: '¿Tamaño?', answer: 'Mediano', chosen: ['Mediano'], own: null },
        { header: 'Frutas', question: '¿Frutas?', answer: 'Pera, Uva, mi fruta', chosen: ['Pera', 'Uva'], own: 'mi fruta' },
      ],
      note: null,
      declined: false,
      at: null,
    });
  });

  it('separa las opciones elegidas del texto propio y quita «(Recommended)»', () => {
    const q = { question: '¿X?', header: 'X', multiSelect: false, options: [{ label: 'Azul (Recommended)', description: '' }, { label: 'Rojo', description: '' }] };
    expect(splitAnswer('Azul (Recommended)', q)).toEqual({ chosen: ['Azul'], own: null });
    expect(splitAnswer('Lisboa', q)).toEqual({ chosen: [], own: 'Lisboa' });
    const m = { ...q, multiSelect: true };
    expect(splitAnswer('Azul (Recommended), Rojo, Con cariño', m)).toEqual({ chosen: ['Azul', 'Rojo'], own: 'Con cariño' });
    expect(splitAnswer('Rojo, Azul (Recommended)', m)).toEqual({ chosen: ['Rojo', 'Azul'], own: null });
  });

  it('sin respuestas, o con alguna que falta, enseña el resumen del resultado', () => {
    const sin = itemDe([question('q1'), { type: 'result', id: 'q1', error: false, summary: 'Contestada', lines: 1 }]);
    expect(answeredView(sin)).toMatchObject({ rows: [{ answer: null }], note: 'Contestada', declined: false });
    const falta = itemDe([question('q1', [simple, multi]), { type: 'result', id: 'q1', error: false, summary: 'resumen', lines: 1, answers: { '¿Tamaño?': 'Grande' } }]);
    expect(answeredView(falta).rows.map((r) => r.answer)).toEqual(['Grande', null]);
    expect(answeredView(falta).note).toBe('resumen');
  });

  it('un error es que no se contestó', () => {
    const it = itemDe([question('q1'), { type: 'result', id: 'q1', error: true, summary: 'El usuario no quiso contestar', lines: 1 }]);
    expect(answeredView(it)).toMatchObject({ declined: true, note: 'El usuario no quiso contestar' });
  });
});

describe('qué enseña el chat mientras la sesión espera', () => {
  const pendiente = applyChatEvents(EMPTY_CHAT, [question('q1')]).items;
  const permiso: PromptInfo = { kind: 'permission', tool: 'Bash', title: 'Bash command', question: '¿Seguir?', options: [{ n: 1, label: 'Yes' }], toolUseId: 't1' };
  const preguntaAbierta: PromptInfo = { kind: 'question', id: 'q1', questions: [simple], screen: 'menu', tabs: [{ header: 'Tamaño', answered: false }], active: 0 };
  const estado = (prompt: PromptInfo | null, over: Partial<{ loaded: boolean; failed: boolean }> = {}) => ({ prompt, loaded: true, failed: false, ...over });

  it('sin esperar no enseña nada', () => {
    expect(waitingView(false, estado(permiso), pendiente)).toEqual({ permission: null, question: null, notice: false });
  });

  it('un permiso va en su tarjeta y no en el aviso', () => {
    expect(waitingView(true, estado(permiso), [])).toEqual({ permission: permiso, question: null, notice: false });
  });

  it('una pregunta abierta que está en la conversación es su tarjeta: ni aviso ni otra tarjeta, también si ya está respondida', () => {
    expect(waitingView(true, estado(preguntaAbierta), pendiente)).toEqual({ permission: null, question: null, notice: false });
    const respondida = applyChatEvents(EMPTY_CHAT, [question('q1'), { type: 'result', id: 'q1', error: false, summary: '', lines: 0 }]).items;
    expect(waitingView(true, estado(preguntaAbierta), respondida)).toEqual({ permission: null, question: null, notice: false });
  });

  it('una pregunta abierta que aún no está en la conversación (la anunció el hook) sale como tarjeta al final, con la misma clave por id', () => {
    const v = waitingView(true, estado(preguntaAbierta), []);
    expect(v.notice).toBe(false);
    expect(v.permission).toBeNull();
    expect(v.question).toEqual({ kind: 'question', key: 'prompt-q1', id: 'q1', questions: [simple], at: null });
    expect(v.question).toEqual(promptQuestionItem(preguntaAbierta as Extract<PromptInfo, { kind: 'question' }>));
    // Otra pregunta en la conversación no la tapa.
    expect(waitingView(true, estado(preguntaAbierta), applyChatEvents(EMPTY_CHAT, [question('otra')]).items).question).not.toBeNull();
  });

  it('el aviso sale con otra ventana, sin nada abierto o si falla la consulta, y no mientras se lee la primera vez', () => {
    expect(waitingView(true, estado({ kind: 'other', hint: '/model' }), []).notice).toBe(true);
    expect(waitingView(true, estado(null), []).notice).toBe(true);
    expect(waitingView(true, estado(null, { loaded: false, failed: true }), []).notice).toBe(true);
    expect(waitingView(true, estado(null, { loaded: false }), []).notice).toBe(false);
  });

  it('una pregunta solo se puede contestar con su menú abierto y sin empezar en la terminal', () => {
    const it = pendiente[0]! as Extract<ChatItem, { kind: 'question' }>;
    expect(questionReadiness(it, false, preguntaAbierta)).toBe('not-waiting');
    expect(questionReadiness(it, true, null)).toBe('not-open');
    expect(questionReadiness(it, true, { ...preguntaAbierta, id: 'otra' })).toBe('not-open');
    expect(questionReadiness(it, true, permiso)).toBe('not-open');
    expect(questionReadiness(it, true, { ...preguntaAbierta, screen: 'review', active: null })).toBe('started');
    expect(questionReadiness(it, true, { ...preguntaAbierta, tabs: [{ header: 'Tamaño', answered: true }] })).toBe('started');
    expect(questionReadiness(it, true, preguntaAbierta)).toBe('ready');
  });

  it('busca la pregunta pendiente y el paso de la herramienta que pide permiso', () => {
    const items = applyChatEvents(EMPTY_CHAT, [
      { type: 'tool', id: 't1', tool: 'Bash', verb: 'Ejecuto', target: 'git rm -r src', detail: 'borrar', at: null },
      question('q1'),
    ]).items;
    expect(pendingQuestion(items, 'q1')?.id).toBe('q1');
    expect(pendingQuestion(items, 'nada')).toBeNull();
    expect(toolStep(items, 't1')).toEqual({ verb: 'Ejecuto', target: 'git rm -r src', detail: 'borrar' });
    expect(toolStep(items, 'x')).toBeNull();
  });
});

describe('plurales', () => {
  it('«1 de 1 contestada» en singular y «0 de 2 contestadas» en plural', () => {
    expect(progressText(0, 1)).toBe('0 de 1 contestada');
    expect(progressText(1, 1)).toBe('1 de 1 contestada');
    expect(progressText(1, 2)).toBe('1 de 2 contestadas');
  });
});

describe('pastilla «Recomendada»', () => {
  it('quita el sufijo (Recommended)/(Recomendado)/(Recomendada) de lo que se ve, sin distinguir mayúsculas', () => {
    expect(splitRecommended('Retirarla del todo (Recommended)')).toEqual({ text: 'Retirarla del todo', recommended: true });
    expect(splitRecommended('Usar A (Recomendado)')).toEqual({ text: 'Usar A', recommended: true });
    expect(splitRecommended('Usar B (recomendada)  ')).toEqual({ text: 'Usar B', recommended: true });
  });

  it('solo al final de la etiqueta y nunca la deja vacía', () => {
    expect(splitRecommended('(Recommended) primero')).toEqual({ text: '(Recommended) primero', recommended: false });
    expect(splitRecommended('Con (Recommended) dentro y más')).toEqual({ text: 'Con (Recommended) dentro y más', recommended: false });
    expect(splitRecommended('(Recommended)')).toEqual({ text: '(Recommended)', recommended: false });
    expect(splitRecommended('Normal')).toEqual({ text: 'Normal', recommended: false });
  });

  it('la búsqueda usa el texto que se ve, sin el sufijo', () => {
    const it = itemDe([question('q1', [{ ...simple, options: opciones('Retirarla (Recommended)', 'Otra') }])]);
    expect(questionSearchTexts(it)).toContain('Retirarla');
    expect(questionSearchTexts(it)).not.toContain('Retirarla (Recommended)');
  });
});

describe('hora de «Respondida»', () => {
  it('la lleva si el resultado trae la hora de la línea, y si no, nada', () => {
    const at = new Date(2026, 10, 14, 9, 5).getTime();
    const con = itemDe([question('q1'), { type: 'result', id: 'q1', error: false, summary: 'ok', lines: 1, at }]);
    expect(answeredView(con).at).toBe(at);
    expect(answeredClock(answeredView(con).at)).toBe('09:05');
    const sin = itemDe([question('q1'), { type: 'result', id: 'q1', error: false, summary: 'ok', lines: 1 }]);
    const nula = itemDe([question('q1'), { type: 'result', id: 'q1', error: false, summary: 'ok', lines: 1, at: null }]);
    expect(answeredView(sin).at).toBeNull();
    expect(answeredView(nula).at).toBeNull();
    expect(answeredClock(null)).toBeNull();
  });
});

describe('permiso con el detalle del hook', () => {
  it('Bash: «Ejecutar este comando», dónde, el comando entero y la explicación', () => {
    expect(permissionView({ verb: 'Ejecuto', target: 'git rm -r a', text: 'git rm -r a\ngit status', description: 'Borra a', where: 'projects/foo' })).toEqual({
      lead: 'Ejecutar este comando',
      where: 'projects/foo',
      text: 'git rm -r a\ngit status',
      note: 'Borra a',
    });
  });

  it('archivos, URLs y herramientas MCP; el cambio de líneas va en la nota; un verbo desconocido se deja tal cual', () => {
    expect(permissionView({ verb: 'Edito', target: 'a.ts', text: 'a.ts', detail: '(+2 −1)' })).toEqual({ lead: 'Editar este archivo', where: null, text: 'a.ts', note: '(+2 −1)' });
    expect(permissionView({ verb: 'Escribo', target: 'b.ts', text: 'b.ts' }).lead).toBe('Escribir este archivo');
    expect(permissionView({ verb: 'Leo', target: 'c.ts', text: 'c.ts' }).lead).toBe('Leer este archivo');
    expect(permissionView({ verb: 'Consulto', target: 'https://x.dev', text: 'https://x.dev' }).lead).toBe('Consultar esta URL');
    expect(permissionView({ verb: 'Uso', target: 'srv · hacer', text: 'srv · hacer' })).toMatchObject({ lead: 'Usar', text: 'srv · hacer' });
    expect(permissionView({ verb: 'WebSearch', target: '', text: '' })).toEqual({ lead: 'WebSearch', where: null, text: '', note: null });
  });
});

describe('envío en marcha', () => {
  it('se recuerda por sesión e id hasta que acaba y se olvida con la sesión', async () => {
    let acaba: (r: 'sent') => void = () => undefined;
    const envio = trackSend('s1', 'q1', new Promise((ok) => (acaba = ok)));
    expect(pendingSend('s1', 'q1')).toBe(envio);
    expect(pendingSend('s2', 'q1')).toBeNull();
    acaba('sent');
    expect(await envio).toBe('sent');
    await Promise.resolve();
    expect(pendingSend('s1', 'q1')).toBeNull();
    trackSend('s1', 'q2', new Promise(() => undefined));
    forgetPrompts('s1');
    expect(pendingSend('s1', 'q2')).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnswerRequest, normalizeAnswerText } from '../shared/chat.ts';
import type { AnswerRequest, PromptInfo } from '../shared/chat.ts';
import type { QuestionItem } from '../shared/follow.ts';
import { answerPermission, answerQuestion, describePrompt, planAnswers } from './chat-answer.ts';
import type { AnswerTiming, PromptDeps, TuiIo } from './chat-answer.ts';
import { parseAgentLines, pendingWork } from './follow.ts';
import type { AgentEvent, PendingWork } from './follow.ts';
import type { PromptHook } from './prompt-hook.ts';
import type { TmuxConfig } from './tmux.ts';

type QuestionEvent = Extract<AgentEvent, { type: 'question' }>;
type PermisoReq = Extract<AnswerRequest, { kind: 'permission' }>;
type PreguntaReq = Extract<AnswerRequest, { kind: 'question' }>;

const fixtures = (...ruta: string[]): string => readFileSync(join(import.meta.dirname, 'fixtures', ...ruta), 'utf8');
const captura = (nombre: string): string => fixtures('tui', `${nombre}.txt`);

const timing: AnswerTiming = { pollMs: 5, stepTimeoutMs: 120, doneTimeoutMs: 120 };
// Solo importa el socket: la terminal es simulada.
const cfg = { socket: 'jdev-test-answer' } as TmuxConfig;

// ---------------------------------------------------------------- Claude Code simulado

const SEP = '─'.repeat(60);

type Opciones = {
  /** Qué enseña la pantalla de revisión en lugar de las respuestas reales. */
  revision?: (respuestas: string[]) => string[];
  /** Opciones de la selección múltiple de cada pregunta que ya salen marcadas al abrirla. */
  marcadas?: Record<number, number[]>;
  /** Pregunta en la que empieza (las anteriores, contestadas en la terminal). */
  empiezaEn?: number;
  /** Deja de reaccionar a esta tecla (un menú que no responde). */
  ignora?: string;
  /** Empieza sin menú, como si ya se hubiera cerrado. */
  cerrado?: boolean;
};

/**
 * El menú de `AskUserQuestion` de Claude Code 2.1.325 con sus teclas: el número elige (simple) o marca (múltiple), Abajo y Arriba
 * mueven el cursor, Enter envía lo que hay bajo él, y el texto solo se escribe con el cursor en «Type something».
 * Con una sola pregunta, elegir envía; con varias, tras la última sale la revisión («1» envía).
 */
class ClaudeFalso implements TuiIo {
  readonly teclas: string[] = [];
  fase: 'menu' | 'revision' | 'cerrado';
  resultado: string[] | null = null;
  private pestana: number;
  private cursor = 1;
  private readonly marcas: Set<number>[];
  private readonly textos: string[];
  private readonly contestada: boolean[];

  private readonly preguntas: QuestionItem[];
  private readonly o: Opciones;

  constructor(preguntas: QuestionItem[], o: Opciones = {}) {
    this.preguntas = preguntas;
    this.o = o;
    this.pestana = o.empiezaEn ?? 0;
    this.fase = o.cerrado ? 'cerrado' : 'menu';
    this.marcas = preguntas.map((_, i) => new Set(o.marcadas?.[i] ?? []));
    this.textos = preguntas.map(() => '');
    this.contestada = preguntas.map((_, i) => i < this.pestana);
  }

  private get q(): QuestionItem {
    return this.preguntas[this.pestana]!;
  }

  private get hasta(): number {
    return this.q.options.length + (this.q.multiSelect ? 2 : 1);
  }

  private respuesta(i: number): string {
    const q = this.preguntas[i]!;
    const elegidas = q.options.filter((_, j) => this.marcas[i]!.has(j)).map((x) => x.label);
    return [...elegidas, ...(this.textos[i] === '' ? [] : [this.textos[i]!])].join(', ');
  }

  private contestadaVisible(i: number): boolean {
    return this.contestada[i]! || (this.preguntas[i]!.multiSelect && (this.marcas[i]!.size > 0 || this.textos[i] !== ''));
  }

  async capture(): Promise<string> {
    const historia = ['● Pregúntame algo.', ''];
    if (this.fase === 'cerrado') return [...historia, '● User answered Claude\'s questions:', '', SEP, '❯ ', SEP, '  ⏵⏵ auto mode on'].join('\n');
    const n = this.preguntas.length;
    const pestanas =
      n > 1
        ? `←  ${this.preguntas.map((q, i) => `${this.contestadaVisible(i) || this.fase === 'revision' ? '☒' : '☐'} ${q.header}`).join('  ')}  ✔ Submit  →`
        : ` ☐ ${this.preguntas[0]!.header}`;
    if (this.fase === 'revision') {
      const respuestas = this.preguntas.map((_, i) => this.respuesta(i));
      const mostradas = this.o.revision ? this.o.revision(respuestas) : respuestas;
      return [
        ...historia,
        SEP,
        pestanas,
        '',
        'Review your answers',
        '',
        ...this.preguntas.flatMap((q, i) => [` ● ${q.question}`, `   → ${mostradas[i]}`]),
        '',
        'Ready to submit your answers?',
        '',
        '❯ 1. Submit answers',
        '  2. Cancel',
      ].join('\n');
    }
    const q = this.q;
    const marca = (fila: number) => (this.cursor === fila ? '❯ ' : '  ');
    const filas = q.options.flatMap((op, j) => [
      `${marca(j + 1)}${j + 1}. ${q.multiSelect ? `[${this.marcas[this.pestana]!.has(j) ? '✔' : ' '}] ` : ''}${op.label}`,
      `${q.multiSelect ? '         ' : '     '}${op.description}`,
    ]);
    const texto = this.textos[this.pestana]!;
    const otra = `${marca(q.options.length + 1)}${q.options.length + 1}. ${q.multiSelect ? `[${texto === '' ? ' ' : '✔'}] ` : ''}${texto === '' ? `Type something${q.multiSelect ? '' : '.'}` : texto}`;
    return [
      ...historia,
      SEP,
      pestanas,
      '',
      q.question,
      '',
      ...filas,
      otra,
      ...(q.multiSelect ? [this.cursor === this.hasta ? '❯    Submit' : '     Submit'] : []),
      SEP,
      `  ${q.options.length + 2}. Chat about this`,
      '',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
    ].join('\n');
  }

  private avanza(): void {
    this.contestada[this.pestana] = true;
    if (this.pestana + 1 < this.preguntas.length) {
      this.pestana++;
      this.cursor = 1;
    } else if (this.preguntas.length === 1) {
      this.cierra();
    } else {
      this.fase = 'revision';
    }
  }

  private cierra(): void {
    this.resultado = this.preguntas.map((_, i) => this.respuesta(i));
    this.fase = 'cerrado';
  }

  async press(tecla: string): Promise<boolean> {
    this.teclas.push(`press:${tecla}`);
    if (tecla === this.o.ignora) return true;
    if (this.fase === 'revision') {
      if (tecla === '1') this.cierra();
      else if (tecla === '2') this.fase = 'cerrado';
      return true;
    }
    if (this.fase !== 'menu') return true;
    const q = this.q;
    const k = q.options.length;
    if (/^[1-9]$/.test(tecla)) {
      const j = Number(tecla) - 1;
      if (j >= k) return true;
      if (q.multiSelect) {
        const m = this.marcas[this.pestana]!;
        if (m.has(j)) m.delete(j);
        else m.add(j);
      } else {
        this.marcas[this.pestana]!.clear();
        this.marcas[this.pestana]!.add(j);
        this.avanza();
      }
    } else if (tecla === 'Down') this.cursor = Math.min(this.hasta, this.cursor + 1);
    else if (tecla === 'Up') this.cursor = Math.max(1, this.cursor - 1);
    else if (tecla === 'Enter') {
      if (q.multiSelect) {
        if (this.cursor === this.hasta) this.avanza();
      } else if (this.cursor <= k) {
        this.marcas[this.pestana]!.clear();
        this.marcas[this.pestana]!.add(this.cursor - 1);
        this.avanza();
      } else if (this.textos[this.pestana] !== '') {
        this.marcas[this.pestana]!.clear();
        this.avanza();
      }
    }
    return true;
  }

  async type(texto: string): Promise<boolean> {
    this.teclas.push(`type:${texto}`);
    // El texto solo se escribe con el cursor en «Type something»; en otro sitio se pierde.
    if (this.fase === 'menu' && this.cursor === this.q.options.length + 1) this.textos[this.pestana] += texto;
    return true;
  }
}

/** Un solo diálogo de permiso real: elegir un número lo cierra. */
class PermisoFalso implements TuiIo {
  readonly teclas: string[] = [];
  abierto: boolean;
  private readonly cierraCon: string | null;
  constructor(cierraCon: string | null = '1', abierto = true) {
    this.cierraCon = cierraCon;
    this.abierto = abierto;
  }
  async capture(): Promise<string> {
    return captura(this.abierto ? 'permiso-bash' : 'permiso-tras-si');
  }
  async press(tecla: string): Promise<boolean> {
    this.teclas.push(`press:${tecla}`);
    if (tecla === this.cierraCon) this.abierto = false;
    return true;
  }
  async type(): Promise<boolean> {
    return true;
  }
}

// ---------------------------------------------------------------- Preguntas de ejemplo

const color: QuestionItem = {
  question: '¿Color?',
  header: 'Color',
  multiSelect: false,
  options: [
    { label: 'Rojo', description: 'Color cálido asociado a pasión y energía.' },
    { label: 'Verde', description: 'Color asociado a naturaleza y calma.' },
    { label: 'Azul', description: 'Color asociado a confianza y serenidad.' },
  ],
};
const frutas: QuestionItem = {
  question: '¿Frutas?',
  header: 'Frutas',
  multiSelect: true,
  options: [
    { label: 'Pera', description: 'Fruta dulce y jugosa de piel suave.' },
    { label: 'Uva', description: 'Fruta pequeña que crece en racimos.' },
    { label: 'Kiwi', description: 'Fruta ácida de pulpa verde con semillas negras.' },
  ],
};
const tamano: QuestionItem = { ...color, question: '¿Tamaño?', header: 'Tamaño', options: color.options.map((o, i) => ({ ...o, label: ['Pequeño', 'Mediano', 'Grande'][i]! })) };

const pendiente = (...preguntas: QuestionItem[]): QuestionEvent => ({ type: 'question', id: 'toolu_1', questions: preguntas, at: 1 });
const pregunta = (answers: PreguntaReq['answers'], id = 'toolu_1'): PreguntaReq => ({ kind: 'question', id, answers });

/** Contesta con una terminal simulada y devuelve la respuesta de la API. */
const contesta = (falso: TuiIo, p: QuestionEvent | null, req: PreguntaReq, nombre = 'jdev-foo-1') =>
  answerQuestion(cfg, nombre, req, async () => p, { io: falso, timing });

// ---------------------------------------------------------------- Pruebas

describe('answerQuestion: una pregunta de selección simple', () => {
  it('elegir una opción pulsa solo su número y el menú se cierra', async () => {
    const falso = new ClaudeFalso([tamano]);
    expect(await contesta(falso, pendiente(tamano), pregunta([{ options: [1] }]))).toEqual({ status: 200, body: { answered: true } });
    expect(falso.teclas).toEqual(['press:2']);
    expect(falso.resultado).toEqual(['Mediano']);
  });

  it('con texto libre baja con las flechas hasta «Type something», teclea el texto, comprueba que aparece y pulsa Enter', async () => {
    const falso = new ClaudeFalso([tamano]);
    expect(await contesta(falso, pendiente(tamano), pregunta([{ options: [], text: 'Enorme' }]))).toEqual({ status: 200, body: { answered: true } });
    expect(falso.teclas).toEqual(['press:Down', 'press:Down', 'press:Down', 'type:Enorme', 'press:Enter']);
    expect(falso.resultado).toEqual(['Enorme']);
  });

  it('un texto que empieza por «-» o acaba en «;» se teclea tal cual', async () => {
    const falso = new ClaudeFalso([tamano]);
    expect(await contesta(falso, pendiente(tamano), pregunta([{ options: [], text: '-1; o más;' }]))).toMatchObject({ status: 200 });
    expect(falso.resultado).toEqual(['-1; o más;']);
  });
});

describe('answerQuestion: varias preguntas', () => {
  it('simple + múltiple con texto: marca cada opción, escribe el texto, baja a Submit, comprueba la revisión y la envía con 1', async () => {
    const falso = new ClaudeFalso([color, frutas]);
    const r = await contesta(falso, pendiente(color, frutas), pregunta([{ options: [1] }, { options: [0, 2], text: 'Mango' }]));
    expect(r).toEqual({ status: 200, body: { answered: true } });
    expect(falso.teclas).toEqual([
      'press:2', // Verde: pasa a la pestaña siguiente
      'press:1',
      'press:3', // Pera y Kiwi
      'press:Down',
      'press:Down',
      'press:Down',
      'type:Mango',
      'press:Down', // a «Submit»
      'press:Enter',
      'press:1', // «Submit answers» de la revisión
    ]);
    expect(falso.resultado).toEqual(['Verde', 'Pera, Kiwi, Mango']);
  });

  it('múltiple sin texto: baja directamente a Submit y no teclea nada', async () => {
    const falso = new ClaudeFalso([frutas, color]);
    expect(await contesta(falso, pendiente(frutas, color), pregunta([{ options: [1] }, { options: [2] }]))).toMatchObject({ status: 200 });
    expect(falso.teclas).toEqual(['press:2', 'press:Down', 'press:Down', 'press:Down', 'press:Down', 'press:Enter', 'press:3', 'press:1']);
    expect(falso.resultado).toEqual(['Uva', 'Azul']);
  });

  it('en una múltiple que ya trae marcas no desmarca por error: pulsa solo lo que hace falta para llegar a lo pedido', async () => {
    const falso = new ClaudeFalso([frutas], { marcadas: { 0: [1, 2] } });
    expect(await contesta(falso, pendiente(frutas), pregunta([{ options: [0, 2] }]))).toMatchObject({ status: 200 });
    // Pera (marcar) y Uva (desmarcar); Kiwi ya estaba marcada y no se toca.
    expect(falso.teclas.filter((t) => /^press:\d$/.test(t))).toEqual(['press:1', 'press:2']);
    expect(falso.resultado).toEqual(['Pera, Kiwi']);
  });

  it('una múltiple solo con texto libre', async () => {
    const falso = new ClaudeFalso([frutas]);
    expect(await contesta(falso, pendiente(frutas), pregunta([{ options: [], text: 'Mango' }]))).toMatchObject({ status: 200 });
    expect(falso.resultado).toEqual(['Mango']);
  });
});

describe('answerQuestion: la pantalla no coincide', () => {
  const sinMasPulsaciones = (falso: ClaudeFalso, hasta: string) => {
    expect(falso.teclas.at(-1)).toBe(hasta);
  };

  it('si la revisión no lista lo que se contestó, para sin pulsar 1 ni Escape: 409 tui-mismatch', async () => {
    const falso = new ClaudeFalso([color, frutas], { revision: (r) => [r[0]!, 'Pera, Uva'] });
    const r = await contesta(falso, pendiente(color, frutas), pregunta([{ options: [1] }, { options: [0, 2], text: 'Mango' }]));
    expect(r).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'revision' } });
    if (r.status !== 409) throw new Error('esperaba un 409');
    expect(r.body.error).toContain('la revisión muestra otra respuesta en la pregunta 2');
    expect(r.body.error).toContain('terminal');
    sinMasPulsaciones(falso, 'press:Enter');
    expect(falso.teclas).not.toContain('press:Escape');
    expect(falso.fase).toBe('revision');
  });

  it('si el menú ya se cerró antes de empezar, no pulsa nada', async () => {
    const falso = new ClaudeFalso([tamano], { cerrado: true });
    const r = await contesta(falso, pendiente(tamano), pregunta([{ options: [0] }]));
    expect(r).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'menu' } });
    expect(falso.teclas).toEqual([]);
    if (r.status === 409) expect(r.body.error).toContain('No se ha pulsado ninguna tecla');
  });

  it('si el menú es de otras preguntas (otras cabeceras), no pulsa nada', async () => {
    const falso = new ClaudeFalso([frutas]);
    expect(await contesta(falso, pendiente(color), pregunta([{ options: [0] }]))).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'menu' } });
    expect(falso.teclas).toEqual([]);
  });

  it('si la primera pregunta ya se contestó en la terminal (el menú va por la segunda), no pulsa nada', async () => {
    const falso = new ClaudeFalso([color, frutas], { empiezaEn: 1 });
    expect(await contesta(falso, pendiente(color, frutas), pregunta([{ options: [0] }, { options: [0] }]))).toMatchObject({ status: 409, body: { step: 'menu' } });
    expect(falso.teclas).toEqual([]);
  });

  it('si el cursor no baja a la fila esperada (el menú ignora Abajo), para y lo dice en ese paso', async () => {
    const falso = new ClaudeFalso([tamano], { ignora: 'Down' });
    const r = await contesta(falso, pendiente(tamano), pregunta([{ options: [], text: 'Enorme' }]));
    expect(r).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'cursor' } });
    expect(falso.teclas).toEqual(['press:Down']);
    if (r.status === 409) expect(r.body.error).toContain('a medias');
  });

  it('si una opción no queda marcada, para antes de seguir', async () => {
    const falso = new ClaudeFalso([frutas], { ignora: '3' });
    expect(await contesta(falso, pendiente(frutas), pregunta([{ options: [0, 2] }]))).toMatchObject({ status: 409, body: { step: 'marca' } });
    expect(falso.teclas).toEqual(['press:1', 'press:3']);
  });

  it('si el menú no se cierra tras la última pulsación, no da la respuesta por enviada', async () => {
    const falso = new ClaudeFalso([tamano], { ignora: '2' });
    expect(await contesta(falso, pendiente(tamano), pregunta([{ options: [1] }]))).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'envio' } });
    expect(falso.teclas).toEqual(['press:2']);
  });

  it('si la fila de «Type something» ya trae un texto, no lo pisa', async () => {
    const falso = new ClaudeFalso([tamano]);
    await falso.press('Down');
    await falso.press('Down');
    await falso.press('Down');
    await falso.type('ya escrito');
    falso.teclas.length = 0;
    expect(await contesta(falso, pendiente(tamano), pregunta([{ options: [], text: 'Enorme' }]))).toMatchObject({ status: 409, body: { step: 'texto' } });
    expect(falso.teclas).toEqual([]);
  });

  it('una sesión que desaparece a mitad responde 404', async () => {
    const io: TuiIo = { capture: async () => null, press: async () => false, type: async () => false };
    expect(await contesta(io, pendiente(tamano), pregunta([{ options: [0] }]))).toEqual({ status: 404, body: { error: 'La sesión no existe.' } });
  });
});

describe('answerQuestion: validación contra lo pendiente', () => {
  it('409 not-pending si la pregunta ya no está pendiente en la transcripción (o es otra), sin tocar la terminal', async () => {
    const falso = new ClaudeFalso([tamano]);
    for (const p of [null, { ...pendiente(tamano), id: 'toolu_otra' }]) {
      expect(await contesta(falso, p, pregunta([{ options: [0] }]))).toMatchObject({ status: 409, body: { code: 'not-pending' } });
    }
    expect(falso.teclas).toEqual([]);
  });

  it('400 si las respuestas no encajan con las preguntas, sin tocar la terminal', async () => {
    const falso = new ClaudeFalso([color, frutas]);
    const p = pendiente(color, frutas);
    for (const answers of [
      [{ options: [0] }], // falta una
      [{ options: [0] }, { options: [0] }, { options: [0] }], // sobra una
      [{ options: [] }, { options: [0] }], // simple sin respuesta
      [{ options: [0, 1] }, { options: [0] }], // simple con dos
      [{ options: [0], text: 'otra' }, { options: [0] }], // simple con opción y texto
      [{ options: [3] }, { options: [0] }], // fuera de rango
      [{ options: [1] }, { options: [] }], // múltiple vacía
      [{ options: [1] }, { options: [1, 1] }], // repetida
    ] satisfies PreguntaReq['answers'][]) {
      expect(await contesta(falso, p, pregunta(answers)), JSON.stringify(answers)).toMatchObject({ status: 400 });
    }
    expect(falso.teclas).toEqual([]);
  });

  it('planAnswers ordena las opciones y devuelve el texto vacío si no hay', () => {
    expect(planAnswers([frutas], [{ options: [2, 0] }])).toEqual([{ options: [0, 2], text: '' }]);
    expect(typeof planAnswers([color], [{ options: [] }])).toBe('string');
  });
});

describe('answerPermission', () => {
  const req: PermisoReq = { kind: 'permission', option: 1, label: 'Yes' };
  const permiso = (falso: TuiIo, r: PermisoReq = req) => answerPermission(cfg, 'jdev-foo-1', r, { io: falso, timing });

  it('comprueba la etiqueta, pulsa el número de la opción y espera a que el diálogo desaparezca', async () => {
    const falso = new PermisoFalso();
    expect(await permiso(falso)).toEqual({ status: 200, body: { answered: true } });
    expect(falso.teclas).toEqual(['press:1']);
  });

  it('elige cualquier opción por su número si la etiqueta coincide, aunque la TUI la haya partido en varias líneas', async () => {
    const falso = new PermisoFalso('4');
    expect(await permiso(falso, { kind: 'permission', option: 4, label: 'No' })).toMatchObject({ status: 200 });
    expect(falso.teclas).toEqual(['press:4']);
  });

  it('si la opción ya no tiene esa etiqueta, no pulsa nada: 409 tui-mismatch', async () => {
    const falso = new PermisoFalso();
    const r = await permiso(falso, { kind: 'permission', option: 1, label: 'No' });
    expect(r).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'etiqueta' } });
    expect(falso.teclas).toEqual([]);
  });

  it('si la opción no existe o el diálogo ya no está abierto, no pulsa nada', async () => {
    const abierto = new PermisoFalso();
    expect(await permiso(abierto, { kind: 'permission', option: 7, label: 'Yes' })).toMatchObject({ status: 409, body: { step: 'permiso' } });
    const cerrado = new PermisoFalso('1', false);
    expect(await permiso(cerrado)).toMatchObject({ status: 409, body: { step: 'permiso' } });
    expect([...abierto.teclas, ...cerrado.teclas]).toEqual([]);
  });

  it('si el diálogo no se cierra tras la pulsación, no da la respuesta por enviada', async () => {
    const falso = new PermisoFalso(null);
    expect(await permiso(falso)).toMatchObject({ status: 409, body: { code: 'tui-mismatch', step: 'permiso' } });
    expect(falso.teclas).toEqual(['press:1']);
  });

  it('un segundo diálogo distinto que aparece enseguida cuenta como cerrado el primero', async () => {
    let n = 0;
    const io: TuiIo = {
      capture: async () => (n === 0 ? captura('permiso-bash') : captura('permiso-bash').replaceAll('rm -f borrame.txt', 'rm -f otra.txt')),
      press: async () => {
        n++;
        return true;
      },
      type: async () => true,
    };
    expect(await permiso(io)).toMatchObject({ status: 200 });
  });
});

describe('el cerrojo por sesión', () => {
  it('dos respuestas a la misma sesión no se mezclan: la segunda empieza cuando termina la primera', async () => {
    const log: string[] = [];
    const lento = (nombre: string): TuiIo => {
      let abierto = true;
      return {
        capture: async () => captura(abierto ? 'permiso-bash' : 'permiso-tras-si'),
        press: async () => {
          log.push(`${nombre}:inicio`);
          await new Promise((ok) => setTimeout(ok, 40));
          abierto = false;
          log.push(`${nombre}:fin`);
          return true;
        },
        type: async () => true,
      };
    };
    const req: PermisoReq = { kind: 'permission', option: 1, label: 'Yes' };
    await Promise.all([answerPermission(cfg, 'jdev-foo-7', req, { io: lento('a'), timing }), answerPermission(cfg, 'jdev-foo-7', req, { io: lento('b'), timing })]);
    expect(log).toEqual(['a:inicio', 'a:fin', 'b:inicio', 'b:fin']);
  });
});

describe('describePrompt', () => {
  const eventos = (nombre: string): AgentEvent[] => parseAgentLines(fixtures('questions', nombre), { primero: true, cwd: null, conversacion: true });
  const dosPreguntas: PendingWork = pendingWork(eventos('dos-preguntas.jsonl').filter((e) => e.type !== 'result'));
  const bash: PendingWork = pendingWork(eventos('permiso-bash.jsonl').filter((e) => e.type !== 'result'));
  const sinNada: PendingWork = { question: null, tools: [], resolved: new Set() };
  const describe_ = (pantalla: string, pendiente: PendingWork, aviso = '', extra: Partial<PromptDeps> = {}) =>
    describePrompt(pantalla, { cargaPendiente: async () => pendiente, aviso, ...extra });

  it('sin menú ni ventana no hay nada', async () => {
    expect(await describe_(captura('simple-2-tras-pulsar'), sinNada)).toBeNull();
    expect(await describe_(captura('permiso-tras-si'), sinNada)).toBeNull();
  });

  it('el menú de preguntas, si sus pestañas casan con la pregunta pendiente: id, pantalla, pestañas y pregunta activa', async () => {
    const eventosFijos = pendingWork([{ type: 'question', id: 'toolu_1', questions: [color, frutas], at: 1 }]);
    expect(await describe_(captura('multi-1-inicial'), eventosFijos)).toEqual({
      kind: 'question',
      id: 'toolu_1',
      questions: [color, frutas],
      screen: 'menu',
      tabs: [
        { header: 'Color', answered: false },
        { header: 'Frutas', answered: false },
      ],
      active: 0,
    });
    expect(await describe_(captura('multi-2-pestana-frutas'), eventosFijos)).toMatchObject({ screen: 'menu', active: 1 });
    expect(await describe_(captura('multi-5-revision'), eventosFijos)).toMatchObject({ kind: 'question', screen: 'review', active: null });
    // Con las preguntas reales de la transcripción también casa.
    expect(dosPreguntas.question?.questions.map((q) => q.header)).toEqual(['Color', 'Frutas']);
    expect(await describe_(captura('multi-1-inicial'), dosPreguntas)).toMatchObject({ kind: 'question', id: 'toolu_016dSrLZuGQ7seg1rPR1wLwy' });
  });

  it('un menú de preguntas que no es el de la pregunta pendiente (o sin pregunta pendiente) es `other`', async () => {
    const distinta = pendingWork([{ type: 'question', id: 'toolu_1', questions: [tamano], at: 1 }]);
    expect(await describe_(captura('multi-1-inicial'), distinta)).toMatchObject({ kind: 'other', hint: expect.stringContaining('Esc to cancel') });
    expect(await describe_(captura('multi-1-inicial'), sinNada)).toMatchObject({ kind: 'other' });
  });

  it('el permiso lleva el título, la pregunta y las opciones completas; la herramienta, del aviso del hook, y su tool_use si es una sola', async () => {
    const p = (await describe_(captura('permiso-bash'), bash, 'Claude needs your permission to use Bash')) as Extract<PromptInfo, { kind: 'permission' }>;
    expect(p).toEqual({
      kind: 'permission',
      tool: 'Bash',
      title: 'Bash command',
      question: 'Do you want to proceed?',
      options: [
        { n: 1, label: 'Yes' },
        { n: 2, label: 'Yes, and always allow access to /home/u/proyecto from this project' },
        { n: 3, label: 'Yes, and switch to auto mode · auto mode handles these prompts for you' },
        { n: 4, label: 'No' },
      ],
      toolUseId: 'toolu_01HSh1XPZ931KpQcnefB5jao',
    });
  });

  it('sin aviso del hook, con otra herramienta o con varias pendientes del mismo nombre, devuelve las opciones sin `toolUseId`', async () => {
    const sin = await describe_(captura('permiso-bash'), bash);
    expect(sin).toMatchObject({ kind: 'permission', tool: null, options: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] });
    expect(sin).not.toHaveProperty('toolUseId');
    expect(await describe_(captura('permiso-bash'), bash, 'Claude needs your permission to use Edit')).toMatchObject({ tool: 'Edit' });
    expect(await describe_(captura('permiso-bash'), bash, 'Claude needs your permission to use Edit')).not.toHaveProperty('toolUseId');
    const dos: PendingWork = { question: null, tools: [...bash.tools, { ...bash.tools[0]!, id: 'toolu_2' }], resolved: new Set() };
    expect(await describe_(captura('permiso-bash'), dos, 'Claude needs your permission to use Bash')).not.toHaveProperty('toolUseId');
    expect(await describe_(captura('permiso-bash'), sinNada, 'Claude needs your permission to use Bash')).toMatchObject({ tool: 'Bash' });
  });

  describe('con lo que dejó el hook', () => {
    const hookPregunta: PromptHook = { kind: 'question', sessionId: 's', toolUseId: 'toolu_hook', questions: [color, frutas], at: 5 };
    const hookBash = (extra: Partial<Extract<PromptHook, { kind: 'permission' }>> = {}): PromptHook => ({
      kind: 'permission',
      sessionId: 's',
      tool: 'Bash',
      input: { verb: 'Ejecuto', target: 'rm -f borrame.txt', text: 'rm -f borrame.txt', description: 'Borra el archivo' },
      cwd: '/home/u/proyecto',
      at: 5,
      ...extra,
    });

    it('la pregunta sale del hook aunque la transcripción no la traiga, con sus preguntas', async () => {
      const p = await describe_(captura('multi-1-inicial'), sinNada, '', { hook: hookPregunta });
      expect(p).toEqual({
        kind: 'question',
        id: 'toolu_hook',
        questions: [color, frutas],
        screen: 'menu',
        tabs: [
          { header: 'Color', answered: false },
          { header: 'Frutas', answered: false },
        ],
        active: 0,
      });
    });

    it('con la misma pregunta ya en la transcripción, el id es el mismo; con su resultado, deja de estar pendiente (other)', async () => {
      const enTranscripcion = pendingWork([{ type: 'question', id: 'toolu_hook', questions: [color, frutas], at: 1 }]);
      expect(await describe_(captura('multi-1-inicial'), enTranscripcion, '', { hook: hookPregunta })).toMatchObject({ kind: 'question', id: 'toolu_hook' });
      const resuelta: PendingWork = { question: null, tools: [], resolved: new Set(['toolu_hook']) };
      expect(await describe_(captura('multi-1-inicial'), resuelta, '', { hook: hookPregunta })).toMatchObject({ kind: 'other' });
    });

    it('la pantalla manda: si el menú no casa con la pregunta del hook, es other', async () => {
      const otra: PromptHook = { ...hookPregunta, questions: [tamano] } as PromptHook;
      expect(await describe_(captura('multi-1-inicial'), sinNada, '', { hook: otra })).toMatchObject({ kind: 'other' });
    });

    it('un hook de permiso no cuenta como pregunta, ni uno de pregunta como permiso', async () => {
      expect(await describe_(captura('multi-1-inicial'), sinNada, '', { hook: hookBash() })).toMatchObject({ kind: 'other' });
      const sin = await describe_(captura('permiso-bash'), sinNada, '', { hook: hookPregunta });
      expect(sin).toMatchObject({ kind: 'permission', tool: null });
      expect(sin).not.toHaveProperty('input');
    });

    it('el permiso lleva la herramienta y su entrada del hook, sin necesitar el aviso; las opciones siguen siendo las de la pantalla', async () => {
      const p = await describe_(captura('permiso-bash'), bash, 'Claude needs your permission', { hook: hookBash(), cwd: '/home/u/proyecto' });
      expect(p).toEqual({
        kind: 'permission',
        tool: 'Bash',
        input: { verb: 'Ejecuto', target: 'rm -f borrame.txt', text: 'rm -f borrame.txt', description: 'Borra el archivo' },
        title: 'Bash command',
        question: 'Do you want to proceed?',
        options: [
          { n: 1, label: 'Yes' },
          { n: 2, label: 'Yes, and always allow access to /home/u/proyecto from this project' },
          { n: 3, label: 'Yes, and switch to auto mode · auto mode handles these prompts for you' },
          { n: 4, label: 'No' },
        ],
        toolUseId: 'toolu_01HSh1XPZ931KpQcnefB5jao',
      });
    });

    it('`where` es el directorio donde se ejecuta si no es el de la sesión: relativo si cuelga de él, absoluto si no', async () => {
      const donde = async (cwdHook: string, cwdSesion: string) =>
        ((await describe_(captura('permiso-bash'), sinNada, '', { hook: hookBash({ cwd: cwdHook }), cwd: cwdSesion })) as Extract<PromptInfo, { kind: 'permission' }>).input?.where;
      expect(await donde('/h/projects/foo', '/h')).toBe('projects/foo');
      expect(await donde('/h', '/h')).toBeUndefined();
      expect(await donde('/otro/sitio', '/h')).toBe('/otro/sitio');
      expect(await donde('', '/h')).toBeUndefined();
    });

    it('un hook de Bash cuyo comando no se ve en el diálogo (archivo que no se borró) se ignora y se cae al aviso', async () => {
      const viejo = hookBash({ input: { verb: 'Ejecuto', target: 'git push --force origin main', text: 'git push --force origin main' } });
      const p = await describe_(captura('permiso-bash'), bash, 'Claude needs your permission to use Bash', { hook: viejo });
      expect(p).toMatchObject({ kind: 'permission', tool: 'Bash', toolUseId: 'toolu_01HSh1XPZ931KpQcnefB5jao' });
      expect(p).not.toHaveProperty('input');
    });

    it('un hook de otra herramienta (no Bash) no se contrasta con la pantalla', async () => {
      const edita = hookBash({ tool: 'Edit', input: { verb: 'Edito', target: 'src/a.ts', text: 'src/a.ts', detail: '(+1 −1)' } });
      expect(await describe_(captura('permiso-bash'), sinNada, '', { hook: edita })).toMatchObject({ tool: 'Edit', input: { verb: 'Edito', detail: '(+1 −1)' } });
    });
  });

  it('otra ventana o menú de Claude (el /model) es `other` con la línea que lo delata', async () => {
    const modelo = ['  Select model', '  ❯ 1.  Default', '', '  Enter to confirm · Esc to cancel'].join('\n');
    expect(await describe_(modelo, sinNada)).toEqual({ kind: 'other', hint: 'Enter to confirm · Esc to cancel' });
  });
});

describe('checkAnswerRequest', () => {
  const ok = (cuerpo: Record<string, unknown>) => {
    const r = checkAnswerRequest(cuerpo);
    if (!r.ok) throw new Error(r.error);
    return r.request;
  };
  const mal = (cuerpo: Record<string, unknown>) => {
    const r = checkAnswerRequest(cuerpo);
    expect(r.ok, JSON.stringify(cuerpo)).toBe(false);
  };

  it('acepta una pregunta con varias respuestas: ordena las opciones y normaliza el texto libre (saltos de línea y tabuladores a espacios)', () => {
    expect(ok({ kind: 'question', id: 'toolu_1', answers: [{ options: [2, 0] }, { options: [], text: '  una\r\nlínea\tdos \n' }, { options: [1], text: '   ' }] })).toEqual({
      kind: 'question',
      id: 'toolu_1',
      answers: [{ options: [0, 2] }, { options: [], text: 'una línea dos' }, { options: [1] }],
    });
    expect(normalizeAnswerText('a\n\nb')).toBe('a b');
  });

  it('acepta un permiso', () => {
    expect(ok({ kind: 'permission', option: 2, label: 'Yes, and always' })).toEqual({ kind: 'permission', option: 2, label: 'Yes, and always' });
  });

  it('rechaza lo que no tiene la forma esperada', () => {
    mal({});
    mal({ kind: 'otra' });
    mal({ kind: 'question', answers: [{ options: [0] }] });
    mal({ kind: 'question', id: 'a b', answers: [{ options: [0] }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [] });
    mal({ kind: 'question', id: 'toolu_1', answers: Array(7).fill({ options: [0] }) });
    mal({ kind: 'question', id: 'toolu_1', answers: ['no'] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: 'no' }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [-1] }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [8] }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [1.5] }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [1, 1] }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [], text: 3 }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [], text: 'a\u001bb' }] });
    mal({ kind: 'question', id: 'toolu_1', answers: [{ options: [], text: 'x'.repeat(1001) }] });
    mal({ kind: 'permission', option: 0, label: 'Yes' });
    mal({ kind: 'permission', option: 10, label: 'Yes' });
    mal({ kind: 'permission', option: 1.5, label: 'Yes' });
    mal({ kind: 'permission', option: 1, label: '  ' });
    mal({ kind: 'permission', option: 1 });
  });
});

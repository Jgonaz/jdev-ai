import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectTuiWindow, extractBtwAnswer, extractBtwPage, joinBtwLines, mergeBtwPages, normalizeTuiText, readPermissionDialog, readQuestionScreen, tuiTextMatches } from './tui.ts';

// Capturas (capture-pane -p -J) recortadas de Claude Code 2.1.319.
const SEP = '─'.repeat(60);
const PROMPT = ['', SEP, '❯ ', SEP, '  /jdev-ai │ ⎇ main │ Opus 5.5 · medium │ ctx 0/1.0M (0%) │ $0.05', '  ⏵⏵ auto mode on (shift+tab to cycle)'];

const idle = ['● Hecho.', ...PROMPT].join('\n');
const trabajando = ['● Leyendo…', '', '✢ Pensando… (12s · esc to interrupt)', ...PROMPT].join('\n');

const btwEsperando = [
  '❯ /btw ¿qué es tmux?',
  '',
  '  /btw ¿qué es tmux?',
  '',
  '    · Answering…',
  '  Esc to close',
  '',
].join('\n');

const btwLarga = [
  '❯ /btw Responde sin usar herramientas: enumera los números del 1 al 40, uno por línea, cada uno con una frase corta distinta.',
  '',
  '  /btw Responde sin usar herramientas: enumera los números del 1 al 40, uno por línea, cada uno con una frase…',
  '',
  '    1. El uno es el principio de toda cuenta.',
  '    2. Dos personas pueden mantener una conversación.',
  '    3. Un triángulo tiene tres lados.',
  '',
  '  ↑/↓ to scroll · c to copy · f to fork · Esc to close',
  '',
].join('\n');

const btwConHistorial = [
  '❯ /btw Responde en una sola frase: ¿qué es tmux?',
  '  /btw Responde sin usar herramientas: enumera los números del 1 al 40, uno por línea, cada uno con una frase…',
  '  /btw Responde en una sola frase: ¿qué es tmux?',
  '    tmux es un multiplexor de terminal: en una misma ventana de terminal puedes abrir varias sesiones,      ',
  '    ventanas y paneles, y esas sesiones siguen en marcha aunque te desconectes, así que luego puedes volver a',
  '    conectarte a ellas.',
  '  ⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close',
  '',
].join('\n');

const btwCopiada = btwLarga.replace('c to copy', 'Copied to clipboard');

const modelo = [
  '  Select model',
  '  ❯ 1.  Default (recommended) ✔  Opus 5.5 · Best for everyday, complex tasks',
  '    2.  Opus 5.5                 For complex work and everyday tasks',
  '',
  '  Enter to set as default · s to use this session only · Esc to cancel',
].join('\n');

const confianza = [' Quick safety check: Is this a project you created or one you trust?', ' ❯ No, exit', '   Yes, I trust this folder', ' Enter to confirm · Esc to cancel'].join('\n');
const ayuda = ['  /btw for side question    ctrl + o for verbose output', '  For more help: https://code.claude.com/docs/en/overview', '  Esc to cancel', ...PROMPT].join('\n');
const permiso = [
  '● Bash(rm -rf build)',
  ' Bash command',
  '   rm -rf build',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and don\'t ask again for rm commands',
  '   3. No, and tell Claude what to do differently (esc)',
].join('\n');
const permisoConEsc = [permiso, '', ' Esc to cancel · Tab to amend'].join('\n');
const salir = ['  Resume session', '  Enter to select · Esc to exit'].join('\n');

describe('detectTuiWindow', () => {
  it('no detecta nada con el prompt normal, ni con el agente trabajando («esc to interrupt»)', () => {
    expect(detectTuiWindow(idle)).toBeNull();
    expect(detectTuiWindow(trabajando)).toBeNull();
    expect(detectTuiWindow('')).toBeNull();
  });

  it('reconoce la ventana de /btw en los dos pies conocidos y la distingue de cuando aún responde', () => {
    expect(detectTuiWindow(btwLarga)).toMatchObject({ kind: 'btw', ready: true });
    expect(detectTuiWindow(btwConHistorial)).toMatchObject({ kind: 'btw', ready: true });
    expect(detectTuiWindow(btwCopiada)).toMatchObject({ kind: 'btw', ready: true });
    expect(detectTuiWindow(btwEsperando)).toMatchObject({ kind: 'btw', ready: false });
  });

  it('reconoce los menús y selectores por su pie', () => {
    for (const captura of [modelo, confianza, ayuda, salir]) expect(detectTuiWindow(captura)).toMatchObject({ kind: 'menu' });
  });

  it('reconoce un diálogo de permiso, con o sin el pie de Escape', () => {
    expect(detectTuiWindow(permiso)).toMatchObject({ kind: 'dialog' });
    expect(detectTuiWindow(permisoConEsc)).toMatchObject({ kind: 'menu' });
  });

  it('solo mira el final de la pantalla: una mención antigua más arriba no cuenta', () => {
    const antiguo = ['  Esc to cancel', ...Array.from({ length: 14 }, (_, i) => `linea ${i}`), ...PROMPT].join('\n');
    expect(detectTuiWindow(antiguo)).toBeNull();
  });
});

describe('extractBtwAnswer', () => {
  it('toma lo que hay entre la cabecera de la ventana y el pie, sin la sangría, y marca el scroll como truncado', () => {
    expect(extractBtwAnswer(btwLarga)).toEqual({
      answer: '1. El uno es el principio de toda cuenta.\n2. Dos personas pueden mantener una conversación.\n3. Un triángulo tiene tres lados.',
      truncated: true,
    });
  });

  it('con historial usa la última entrada y, sin scroll, no es truncada', () => {
    expect(extractBtwAnswer(btwConHistorial)).toEqual({
      answer:
        'tmux es un multiplexor de terminal: en una misma ventana de terminal puedes abrir varias sesiones,\n' +
        'ventanas y paneles, y esas sesiones siguen en marcha aunque te desconectes, así que luego puedes volver a\n' +
        'conectarte a ellas.',
      truncated: false,
    });
  });

  it('conserva los huecos y la sangría de dentro de la respuesta', () => {
    const c = ['  /btw p', '', '    Primero:', '', '      codigo()', '', '    Fin', '', '  ↑/↓ to scroll · c to copy · Esc to close'].join('\n');
    expect(extractBtwAnswer(c)?.answer).toBe('Primero:\n\n  codigo()\n\nFin');
  });

  it('si la cabecera ya no se ve (respuesta más alta que la pantalla) devuelve lo visible como truncado', () => {
    const c = ['    7. siete', '    8. ocho', '', '  ⇧←/→ to browse · c to copy · Esc to close'].join('\n');
    expect(extractBtwAnswer(c)).toEqual({ answer: '7. siete\n8. ocho', truncated: true });
  });

  it('null sin pie o sin respuesta', () => {
    expect(extractBtwAnswer(idle)).toBeNull();
    expect(extractBtwAnswer(btwEsperando.replace('    · Answering…', ''))).toBeNull();
  });
});

describe('extractBtwPage y mergeBtwPages', () => {
  const pie = '  ⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close';
  const pantalla = (lineas: string[], conCabecera = true) =>
    [conCabecera ? '  /btw lista' : '', ...(conCabecera ? [''] : []), ...lineas.map((l) => (l === '' ? '' : `    ${l}`)), '', pie].join('\n');
  const nums = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `${a + i}. elemento`);

  it('una pantalla es el cuerpo sin el hueco bajo la cabecera ni el de sobre el pie, y conserva los párrafos', () => {
    expect(extractBtwPage(pantalla(['uno', '', 'dos']))).toEqual(['uno', '', 'dos']);
  });

  it('null sin ventana o sin cuerpo', () => {
    expect(extractBtwPage(idle)).toBeNull();
    expect(extractBtwPage(pantalla([]))).toBeNull();
  });

  it('con historial la página es la de la última entrada', () => {
    expect(extractBtwPage(btwConHistorial)).toEqual([
      'tmux es un multiplexor de terminal: en una misma ventana de terminal puedes abrir varias sesiones,',
      'ventanas y paneles, y esas sesiones siguen en marcha aunque te desconectes, así que luego puedes volver a',
      'conectarte a ellas.',
    ]);
  });

  it('une pantallas desplazadas de 3 en 3 por solapamiento, sin duplicar ni perder líneas', () => {
    let acc = extractBtwPage(pantalla(nums(1, 18)))!;
    for (let ini = 4; ini <= 43; ini += 3) acc = mergeBtwPages(acc, extractBtwPage(pantalla(nums(ini, Math.min(60, ini + 17))))!).lines;
    expect(joinBtwLines(acc)).toBe(nums(1, 60).join('\n'));
  });

  it('conserva un hueco de párrafo que cae justo en el borde de una pantalla', () => {
    const r = mergeBtwPages(['a', 'b', 'c', ''], ['c', '', 'd', 'e']);
    expect(r).toEqual({ lines: ['a', 'b', 'c', '', 'd', 'e'], solapa: true });
  });

  it('sin solapamiento avisa de que se ha perdido un trozo', () => {
    expect(mergeBtwPages(['a', 'b'], ['x', 'y'])).toEqual({ lines: ['a', 'b', 'x', 'y'], solapa: false });
  });

  it('huecos sueltos no cuentan como solapamiento', () => {
    expect(mergeBtwPages(['a', ''], ['', 'x']).solapa).toBe(false);
  });
});

// Capturas reales de Claude Code 2.1.325 (capture-pane -p, con su relleno de espacios), en fixtures/tui/.
const captura = (nombre: string): string => readFileSync(join(import.meta.dirname, 'fixtures', 'tui', `${nombre}.txt`), 'utf8');

describe('readQuestionScreen', () => {
  it('una pregunta de selección simple: una sola pestaña sin flechas, opciones numeradas y el cursor en la primera', () => {
    const m = readQuestionScreen(captura('simple-1-inicial'));
    expect(m).toEqual({
      kind: 'menu',
      tabs: [{ header: 'Tamaño', answered: false }],
      submitTab: false,
      question: '¿Tamaño?',
      options: [
        { n: 1, label: 'Pequeño', checked: null, cursor: true },
        { n: 2, label: 'Mediano', checked: null, cursor: false },
        { n: 3, label: 'Grande', checked: null, cursor: false },
      ],
      other: { n: 4, label: 'Type something.', checked: null, cursor: false, text: '' },
      multiSelect: false,
      submit: null,
      cursorRow: 1,
      chatCursor: false,
    });
  });

  it('con el cursor en «Type something» y texto tecleado, `other.text` lo lleva', () => {
    expect(readQuestionScreen(captura('simple-3-texto'))).toMatchObject({
      kind: 'menu',
      other: { n: 4, label: 'Enorme', text: 'Enorme', cursor: true },
      cursorRow: 4,
      options: [{ n: 1 }, { n: 2 }, { n: 3 }],
    });
  });

  it('una pregunta larga que la TUI parte con «│ » en cada línea se une sin el prefijo y casa con el texto original', () => {
    const pregunta = 'La captura de gastos por voz y foto (Gemini) lleva desactivada desde la 0.2.37 y no se usa. ¿Qué hacemos con ella?';
    const m = readQuestionScreen(captura('pregunta-larga'));
    expect(m).toMatchObject({
      kind: 'menu',
      tabs: [
        { header: 'Captura IA', answered: false },
        { header: 'Limpieza', answered: false },
      ],
      multiSelect: false,
      options: [{ n: 1, label: 'Retirarla del todo (Recommended)' }, { n: 2 }, { n: 3 }],
      other: { n: 4, text: '' },
      cursorRow: 1,
    });
    expect(m).toMatchObject({ question: pregunta });
    expect(tuiTextMatches((m as { question: string }).question, pregunta)).toBe(true);
    // Un «│» suelto de otra pregunta no se confunde con el prefijo.
    expect(tuiTextMatches('│ ' + pregunta, pregunta)).toBe(false);
  });

  it('varias preguntas: pestañas con su estado, «Submit» y las flechas', () => {
    expect(readQuestionScreen(captura('multi-1-inicial'))).toMatchObject({
      kind: 'menu',
      tabs: [
        { header: 'Color', answered: false },
        { header: 'Frutas', answered: false },
      ],
      submitTab: true,
      question: '¿Color?',
      multiSelect: false,
      cursorRow: 1,
    });
    expect(readQuestionScreen(captura('multi-2-pestana-frutas'))).toMatchObject({
      tabs: [
        { header: 'Color', answered: true },
        { header: 'Frutas', answered: false },
      ],
      question: '¿Frutas?',
    });
  });

  it('selección múltiple: marcas `[ ]`/`[✔]`, la fila de texto y la fila «Submit»', () => {
    const vacia = readQuestionScreen(captura('multi-2-pestana-frutas'));
    expect(vacia).toMatchObject({
      kind: 'menu',
      multiSelect: true,
      options: [
        { n: 1, label: 'Pera', checked: false, cursor: true },
        { n: 2, label: 'Uva', checked: false },
        { n: 3, label: 'Kiwi', checked: false },
      ],
      other: { n: 4, label: 'Type something', checked: false, text: '' },
      submit: { cursor: false },
    });
    const marcadas = readQuestionScreen(captura('multi-3-marcadas'));
    expect(marcadas).toMatchObject({ options: [{ checked: true }, { checked: false }, { checked: true }], tabs: [{ answered: true }, { answered: true }] });
  });

  it('selección múltiple con texto libre: la fila lleva el texto, está marcada y tiene el cursor', () => {
    expect(readQuestionScreen(captura('multi-4-texto'))).toMatchObject({
      other: { n: 4, label: 'Mango', checked: true, cursor: true, text: 'Mango' },
      options: [{ checked: true, cursor: false }, { checked: false }, { checked: true }],
      cursorRow: 4,
    });
  });

  it('la pantalla de revisión lista las respuestas y ofrece enviar o cancelar', () => {
    expect(readQuestionScreen(captura('multi-5-revision'))).toEqual({
      kind: 'review',
      tabs: [
        { header: 'Color', answered: true },
        { header: 'Frutas', answered: true },
      ],
      submitTab: true,
      entries: [
        { question: '¿Color?', answer: 'Azul' },
        { question: '¿Frutas?', answer: 'Pera, Kiwi, Mango' },
      ],
      options: [
        { n: 1, label: 'Submit answers', checked: null, cursor: true },
        { n: 2, label: 'Cancel', checked: null, cursor: false },
      ],
    });
  });

  it('sin menú abierto no hay nada: el prompt normal, lo ya contestado, un diálogo de permiso o el menú del /model', () => {
    for (const nombre of ['simple-2-tras-pulsar', 'permiso-tras-si', 'permiso-bash']) expect(readQuestionScreen(captura(nombre)), nombre).toBeNull();
    for (const c of [idle, trabajando, btwLarga, modelo, permiso, '']) expect(readQuestionScreen(c)).toBeNull();
  });

  it('una lista de tareas «☐ …» del historial no se toma por el menú: exige la fila bajo un borde y las opciones', () => {
    const tareas = ['● Update Todos', '  ⎿  ☐ Escribir pruebas', '     ☒ Leer el código', '', ...PROMPT].join('\n');
    expect(readQuestionScreen(tareas)).toBeNull();
    const sinOpciones = [SEP, ' ☐ Tamaño', '', '¿Tamaño?', '', SEP, '  5. Chat about this'].join('\n');
    expect(readQuestionScreen(sinOpciones)).toBeNull();
    // El menú es lo más cercano al final: una fila de pestañas antigua más arriba no manda.
    const conAntiguo = [SEP, ' ☐ Viejo', '', '¿Viejo?', '', '❯ 1. A', '  2. Type something.', SEP, '  3. Chat about this', '', captura('simple-1-inicial')].join('\n');
    expect(readQuestionScreen(conAntiguo)).toMatchObject({ question: '¿Tamaño?' });
  });

  it('con el cursor bajo el separador (Chat about this) lo marca, y la fila «Submit» con el cursor también se lee', () => {
    const chat = captura('multi-2-pestana-frutas').replace('❯ 1. [ ] Pera', '  1. [ ] Pera').replace('  5. Chat about this', '❯ 5. Chat about this');
    expect(readQuestionScreen(chat)).toMatchObject({ cursorRow: null, chatCursor: true, submit: { cursor: false } });
    const submit = captura('multi-4-texto').replace('❯ 4. [✔] Mango', '  4. [✔] Mango').replace('     Submit', '❯    Submit');
    expect(readQuestionScreen(submit)).toMatchObject({ cursorRow: null, chatCursor: false, submit: { cursor: true } });
  });

  it('una sola pregunta múltiple con el cursor en «Submit» (captura real) y su revisión', () => {
    expect(readQuestionScreen(captura('multi-sola-cursor-submit'))).toMatchObject({
      tabs: [{ header: 'Frutas', answered: true }],
      multiSelect: true,
      options: [{ checked: false }, { checked: true }, { checked: false }],
      cursorRow: null,
      chatCursor: false,
      submit: { cursor: true },
    });
    expect(readQuestionScreen(captura('multi-sola-tras-submit'))).toMatchObject({
      kind: 'review',
      entries: [{ question: '¿Frutas?', answer: 'Uva' }],
    });
  });

  it('una pregunta o una respuesta de la revisión que se parte en varias líneas se une', () => {
    const revision = captura('multi-5-revision').replace(' ● ¿Frutas?\n   → Pera, Kiwi, Mango', ' ● ¿Qué frutas\n   quieres?\n   → Pera, Kiwi,\n   Mango');
    expect(readQuestionScreen(revision)).toMatchObject({ entries: [{ answer: 'Azul' }, { question: '¿Qué frutas quieres?', answer: 'Pera, Kiwi, Mango' }] });
  });

  it('la revisión también quita el «│ » de las líneas de una pregunta partida', () => {
    const revision = captura('multi-5-revision').replace(' ● ¿Frutas?\n   → Pera, Kiwi, Mango', ' ● ¿Qué frutas\n │ quieres?\n   → Pera, Kiwi, Mango');
    expect(readQuestionScreen(revision)).toMatchObject({ entries: [{ answer: 'Azul' }, { question: '¿Qué frutas quieres?', answer: 'Pera, Kiwi, Mango' }] });
  });
});

describe('readPermissionDialog', () => {
  it('lee el título, la pregunta y las opciones completas del diálogo de Bash', () => {
    expect(readPermissionDialog(captura('permiso-bash'))).toEqual({
      title: 'Bash command',
      question: 'Do you want to proceed?',
      options: [
        { n: 1, label: 'Yes', cursor: true },
        { n: 2, label: 'Yes, and always allow access to /home/u/proyecto from this project', cursor: false },
        { n: 3, label: 'Yes, and switch to auto mode · auto mode handles these prompts for you', cursor: false },
        { n: 4, label: 'No', cursor: false },
      ],
      signature: expect.stringContaining('rm -f borrame.txt'),
    });
  });

  it('une la continuación sangrada de una opción partida en una terminal estrecha', () => {
    const estrecho = [
      SEP,
      ' Bash command',
      '   rm -rf build',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. Yes, and always allow access to',
      '      /home/u/proyecto from this project',
      '   3. No',
      '',
      ' Esc to cancel · Tab to amend',
    ].join('\n');
    expect(readPermissionDialog(estrecho)).toMatchObject({
      title: 'Bash command',
      options: [
        { n: 1, label: 'Yes' },
        { n: 2, label: 'Yes, and always allow access to /home/u/proyecto from this project' },
        { n: 3, label: 'No' },
      ],
    });
  });

  describe('etiqueta partida a mitad de una ruta (pantalla de 80 columnas)', () => {
    const SEP80 = '─'.repeat(80);
    const dialogo = (...opciones: string[]): string =>
      [SEP80, ' Bash command', '   rm -rf build', ' Do you want to proceed?', ' ❯ 1. Yes', ...opciones, '   9. No', '', ' Esc to cancel · Tab to amend'].join('\n');
    const ruta = '/home/u/proyectos/un-nombre-muy-largo/otro-directorio-bastante-largo/subdirectorio/archivo-con-nombre-largo.config.ts';

    it('no mete un espacio donde la TUI cortó una palabra más larga que la caja', () => {
      // Primera línea llena hasta el ancho; la ruta sigue en la siguiente.
      const primera = `   2. Yes, and always allow access to ${ruta}`.slice(0, 80);
      const resto = `   2. Yes, and always allow access to ${ruta}`.slice(80);
      const d = readPermissionDialog(dialogo(primera, `      ${resto} from this project`));
      expect(d?.options[1]?.label).toBe(`Yes, and always allow access to ${ruta} from this project`);
    });

    it('con un corte entre palabras mantiene el espacio, aunque la línea llegue casi al ancho', () => {
      const linea = '   2. Yes, and always allow access to the whole repository and all of its asset';
      expect(linea.length).toBe(79);
      const d = readPermissionDialog(dialogo(linea, '      files for this project'));
      expect(d?.options[1]?.label).toBe('Yes, and always allow access to the whole repository and all of its asset files for this project');
    });

    it('sin líneas de guiones (no se sabe el ancho) pone siempre el espacio', () => {
      const sinBorde = dialogo('   2. Yes, and always allow access to /home/u/proyectos/un-nombre-muy-largo/otro-directorio-bastante-larg', '      o/subdirectorio/archivo.ts').replace(SEP80, '');
      expect(readPermissionDialog(sinBorde)?.options[1]?.label).toBe('Yes, and always allow access to /home/u/proyectos/un-nombre-muy-largo/otro-directorio-bastante-larg o/subdirectorio/archivo.ts');
    });
  });

  it('también lee «Would you like to …?» y un diálogo sin borde (título vacío)', () => {
    expect(readPermissionDialog(permiso)).toMatchObject({ title: '', question: 'Do you want to proceed?', options: [{ n: 1, label: 'Yes' }, { n: 2 }, { n: 3 }] });
    const plan = [SEP, ' Ready to code?', ' Would you like to proceed?', ' ❯ 1. Yes, auto-accept edits', '   2. No, keep planning'].join('\n');
    expect(readPermissionDialog(plan)).toMatchObject({ title: 'Ready to code?', question: 'Would you like to proceed?', options: [{ n: 1 }, { n: 2 }] });
  });

  it('sin diálogo, o con la pregunta sin opciones numeradas, es null; y el diálogo desaparecido tampoco sale', () => {
    for (const c of [idle, trabajando, modelo, captura('permiso-tras-si'), captura('simple-1-inicial'), '', ' Do you want to proceed?']) expect(readPermissionDialog(c)).toBeNull();
  });

  it('la firma cambia si cambia el contenido del diálogo', () => {
    const a = readPermissionDialog(captura('permiso-bash'))!;
    const b = readPermissionDialog(captura('permiso-bash').replaceAll('rm -f borrame.txt', 'rm -f otra.txt'))!;
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('tuiTextMatches y normalizeTuiText', () => {
  it('compara sin importar los espacios y acepta un comienzo recortado con «…» o la primera línea larga de una etiqueta partida', () => {
    expect(normalizeTuiText('  a   b \n c ')).toBe('a b c');
    expect(tuiTextMatches('Color', 'Color')).toBe(true);
    expect(tuiTextMatches('Tipo de…', 'Tipo de test')).toBe(true);
    expect(tuiTextMatches('Usar la rama principal del', 'Usar la rama principal del proyecto')).toBe(true);
    expect(tuiTextMatches('Usar', 'Usar la rama principal del proyecto')).toBe(false);
    expect(tuiTextMatches('Otro', 'Color')).toBe(false);
    expect(tuiTextMatches('', 'Color')).toBe(false);
  });
});

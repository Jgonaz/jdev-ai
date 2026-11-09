import { describe, expect, it } from 'vitest';
import { detectTuiWindow, extractBtwAnswer, extractBtwPage, joinBtwLines, mergeBtwPages } from './tui.ts';

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

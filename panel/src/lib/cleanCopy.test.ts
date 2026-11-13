import { describe, expect, it } from 'vitest';
import { MARGEN_AJUSTE, cleanCopiedText } from './cleanCopy.ts';

/** Ajusta un texto por palabras como lo haría Ink: `primera` y `resto` son los prefijos de la primera línea y de las demás. */
function ajusta(texto: string, ancho: number, primera = '', resto = primera): string {
  const lineas: string[] = [];
  let actual = primera;
  let vacia = true;
  for (const palabra of texto.split(' ')) {
    if (!vacia && actual.length + 1 + palabra.length > ancho) {
      lineas.push(actual);
      actual = resto + palabra;
    } else {
      actual += (vacia ? '' : ' ') + palabra;
    }
    vacia = false;
  }
  lineas.push(actual);
  return lineas.join('\n');
}

const PARRAFO =
  'He revisado el servidor y el fallo viene de que la cola de envío no se vacía cuando la sesión termina, así que el panel sigue esperando una respuesta que ya no va a llegar.';

describe('cleanCopiedText', () => {
  it('une un párrafo de Claude ajustado a 80 columnas y quita la marca y la sangría', () => {
    const copiado = ajusta(PARRAFO, 80, '⏺ ', '  ');
    expect(copiado.split('\n').length).toBeGreaterThan(2);
    expect(cleanCopiedText(copiado, 80)).toBe(PARRAFO);
  });

  it('une también con la marca «●» de Linux y con otros anchos', () => {
    for (const cols of [60, 80, 120]) {
      expect(cleanCopiedText(ajusta(PARRAFO, cols, '● ', '  '), cols)).toBe(PARRAFO);
    }
  });

  it('aguanta que Claude ajuste un par de columnas por debajo del borde', () => {
    expect(MARGEN_AJUSTE).toBe(2);
    expect(cleanCopiedText(ajusta(PARRAFO, 78, '⏺ ', '  '), 80)).toBe(PARRAFO);
  });

  it('separa los párrafos y conserva las líneas en blanco', () => {
    const copiado = `${ajusta(PARRAFO, 80, '⏺ ', '  ')}\n\n${ajusta(PARRAFO, 80, '  ')}`;
    expect(cleanCopiedText(copiado, 80)).toBe(`${PARRAFO}\n\n${PARRAFO}`);
  });

  it('une los elementos de lista que ocupan dos líneas sin mezclar unos con otros', () => {
    const uno = 'Arreglar la cola de envío para que se vacíe cuando la sesión termina de forma limpia';
    const dos = 'Añadir un test que cubra el cierre de la sesión en mitad de un envío pendiente ahora';
    const copiado = ['⏺ Pendiente:', '', ajusta(uno, 80, '  - ', '    '), ajusta(dos, 80, '  - ', '    '), '  - Corto'].join('\n');
    expect(copiado).toContain('\n    ');
    expect(cleanCopiedText(copiado, 80)).toBe(['Pendiente:', '', `- ${uno}`, `- ${dos}`, '- Corto'].join('\n'));
  });

  it('une la continuación de una lista numerada', () => {
    const uno = 'Primero se para el servidor de desarrollo para que no escriba mientras se hace la copia';
    const copiado = [ajusta(uno, 80, '  1. ', '     '), '  2. Después se copia'].join('\n');
    expect(cleanCopiedText(copiado, 80)).toBe(`1. ${uno}\n2. Después se copia`);
  });

  it('no toca el interior de un bloque de código', () => {
    const largo = 'const resultado = await servicio.procesar(entrada, { reintentos: 3, espera: 250, registro: true });';
    const copiado = ['⏺ Así queda:', '', '  ```ts', ajusta(largo, 80, '  '), '  segunda();', '  ```', '', '  Y ya está.'].join('\n');
    const limpio = cleanCopiedText(copiado, 80);
    expect(limpio).toBe(['Así queda:', '', '```ts', ...ajusta(largo, 80, '  ').split('\n').map((l) => l.slice(2)), 'segunda();', '```', '', 'Y ya está.'].join('\n'));
    // Las líneas de código siguen siendo varias, aunque la primera estuviera casi llena.
    expect(limpio.split('\n').filter((l) => l.includes('procesar') || l.includes('registro')).length).toBe(2);
  });

  it('no une líneas cortas', () => {
    const copiado = ['⏺ Resultado:', '  línea uno', '  línea dos', '  línea tres'].join('\n');
    expect(cleanCopiedText(copiado, 80)).toBe('Resultado:\nlínea uno\nlínea dos\nlínea tres');
  });

  it('no une si la siguiente tiene menos o más sangría que el texto', () => {
    const larga = 'a'.repeat(30) + ' ' + 'b'.repeat(46);
    expect(cleanCopiedText(`${larga}\n${larga.slice(0, 20)}`, 80)).toBe(`${larga}\n${larga.slice(0, 20)}`);
    expect(cleanCopiedText(`  ${larga}\nfin`, 80)).toBe(`  ${larga}\nfin`);
    expect(cleanCopiedText(`${larga}\n    sangrada`, 80)).toBe(`${larga}\n    sangrada`);
  });

  it('no une con títulos, citas, tablas, marcas ni elementos de lista', () => {
    const casi = 'x'.repeat(10) + ' ' + 'y'.repeat(66);
    for (const siguiente of ['# Título', '> cita', '| a | b |', '- otro', '* otro', '• otro', '3. otro', '⏺ otro mensaje', '```']) {
      expect(cleanCopiedText(`${casi}\n${siguiente}`, 80).split('\n').length).toBeGreaterThan(1);
    }
  });

  it('no une en tablas ni con caracteres de caja', () => {
    const tabla = ['┌─────────────┬──────────────────────────────────────────────────────┐', '│ columna uno │ valor de la segunda columna casi hasta el borde      │', '└─────────────┴──────────────────────────────────────────────────────┘'].join('\n');
    expect(cleanCopiedText(tabla, 70)).toBe(tabla);
  });

  it('no une tras el punto de una frase que acaba la línea ni con una línea corta', () => {
    const casi = 'x'.repeat(10) + ' ' + 'y'.repeat(60) + ' fin.';
    expect(cleanCopiedText(`${casi}\nOtra frase distinta`, 80)).toBe(`${casi}\nOtra frase distinta`);
    expect(cleanCopiedText(`${casi}\notra frase distinta`, 80)).toBe(`${casi} otra frase distinta`);
    expect(cleanCopiedText(`corta\n${'z'.repeat(77)}`, 80)).toBe(`corta\n${'z'.repeat(77)}`);
  });

  it('no une una URL partida a mitad de palabra', () => {
    const url = 'https://ejemplo.dev/documentacion/guias/configuracion/avanzada/del/servidor/panel';
    const copiado = `  Mira ${url.slice(0, 74)}\n  ${url.slice(74)} para más detalle`;
    expect(cleanCopiedText(copiado, 80)).toBe(`Mira ${url.slice(0, 74)}\n${url.slice(74)} para más detalle`);
  });

  it('quita la marca de resultado «⎿» y alinea sus continuaciones', () => {
    const copiado = ['⏺ Read(src/lib/chat.ts)', '  ⎿  Read 469 lines (ctrl+o to expand)', '', '⏺ Listo.'].join('\n');
    expect(cleanCopiedText(copiado, 80)).toBe('Read(src/lib/chat.ts)\n   Read 469 lines (ctrl+o to expand)\n\nListo.');
  });

  it('solo quita «●» si lleva la sangría de Claude: la salida de systemctl no cambia', () => {
    const systemctl = ['● nginx.service - A high performance web server', '     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)', '     Active: active (running)'].join('\n');
    expect(cleanCopiedText(systemctl, 80)).toBe(systemctl);
  });

  it('quita los espacios finales y la sangría común', () => {
    expect(cleanCopiedText('    uno   \n      dos\t\n    tres', 80)).toBe('uno\n  dos\ntres');
  });

  it('deja el texto normal de shell tal cual', () => {
    const shell = ['$ ls -la', 'total 12', 'drwxr-xr-x  3 jorge jorge 4096 nov 13 10:02 .', '-rw-r--r--  1 jorge jorge  220 nov 13 10:02 .bashrc', '$ echo hola', 'hola', ''].join('\n');
    expect(cleanCopiedText(shell, 80)).toBe(shell);
    // Un log con líneas casi hasta el borde: cada línea empieza con su fecha y no se une con la anterior.
    const log = ['2026-11-13 10:02:11 INFO arrancando el servidor en el puerto 7777 con config', '2026-11-13 10:02:12 INFO sesión creada'].join('\n');
    expect(cleanCopiedText(log, 80)).toBe(log);
  });

  it('conserva el salto final y el texto vacío', () => {
    expect(cleanCopiedText('hola\n', 80)).toBe('hola\n');
    expect(cleanCopiedText('', 80)).toBe('');
  });

  it('sin un ancho fiable solo limpia, no une', () => {
    const copiado = ajusta(PARRAFO, 80, '⏺ ', '  ');
    expect(cleanCopiedText(copiado, 0)).toBe(
      copiado
        .split('\n')
        .map((l) => l.replace(/^(⏺)? {1,2}/, ''))
        .join('\n'),
    );
  });

  it('cuenta los caracteres anchos como dos columnas', () => {
    // 15 palabras de 2 ideogramas ocupan 74 columnas: con «fines» (5) no caben en 80, la línea estaba llena.
    const ancha = Array(15).fill('漢漢').join(' ');
    expect(cleanCopiedText(`${ancha}\nfines del texto`, 80)).toBe(`${ancha} fines del texto`);
    // Con 15 palabras de 2 letras latinas (44 columnas) no.
    const corta = Array(15).fill('aa').join(' ');
    expect(cleanCopiedText(`${corta}\nfines del texto`, 80)).toBe(`${corta}\nfines del texto`);
  });
});

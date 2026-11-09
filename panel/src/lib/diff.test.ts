import { describe, expect, it } from 'vitest';
import { parsePatch, toSplitRows } from './diff.ts';

const parche = (...lineas: string[]) => `${lineas.join('\n')}\n`;

describe('parsePatch', () => {
  it('ignora las cabeceras de git y numera las líneas antiguas y nuevas', () => {
    const h = parsePatch(
      parche(
        'diff --git a/src/a.ts b/src/a.ts',
        'index 1234567..89abcde 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,4 +1,5 @@ function x() {',
        ' uno',
        '-dos',
        '+DOS',
        '+extra',
        ' tres',
        ' cuatro',
      ),
    );
    expect(h).toHaveLength(1);
    expect(h[0]!.header).toBe('@@ -1,4 +1,5 @@ function x() {');
    expect(h[0]!.lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text])).toEqual([
      ['ctx', 1, 1, 'uno'],
      ['del', 2, null, 'dos'],
      ['add', null, 2, 'DOS'],
      ['add', null, 3, 'extra'],
      ['ctx', 3, 4, 'tres'],
      ['ctx', 4, 5, 'cuatro'],
    ]);
  });

  it('varios bloques reinician la numeración', () => {
    const h = parsePatch(parche('@@ -1,2 +1,2 @@', ' a', '-b', '+B', '@@ -40,2 +42,2 @@', ' x', '-y', '+Y'));
    expect(h.map((b) => b.lines.map((l) => [l.oldNo, l.newNo]))).toEqual([
      [[1, 1], [2, null], [null, 2]],
      [[40, 42], [41, null], [null, 43]],
    ]);
  });

  it('una cabecera sin recuento vale 1 y un archivo nuevo o borrado numera desde 1', () => {
    expect(parsePatch(parche('@@ -0,0 +1,2 @@', '+a', '+b'))[0]!.lines.map((l) => [l.kind, l.newNo])).toEqual([['add', 1], ['add', 2]]);
    expect(parsePatch(parche('@@ -1,2 +0,0 @@', '-a', '-b'))[0]!.lines.map((l) => [l.kind, l.oldNo])).toEqual([['del', 1], ['del', 2]]);
    const h = parsePatch(parche('@@ -3 +3 @@', '-a', '+b'));
    expect(h[0]!.lines.map((l) => [l.oldNo, l.newNo])).toEqual([[3, null], [null, 3]]);
  });

  it('una línea quitada o añadida que empieza como una cabecera no se confunde con ella', () => {
    const h = parsePatch(parche('@@ -1,2 +1,2 @@', '--- viejo', '+++ nuevo'));
    expect(h).toHaveLength(1);
    expect(h[0]!.lines.map((l) => [l.kind, l.text])).toEqual([['del', '-- viejo'], ['add', '++ nuevo']]);
  });

  it('marca la línea anterior con «\\ No newline at end of file»', () => {
    const h = parsePatch(parche('@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b', '\\ No newline at end of file'));
    expect(h[0]!.lines.map((l) => [l.kind, l.noEol])).toEqual([['ctx', false], ['del', true], ['add', true]]);
    expect(h[0]!.lines).toHaveLength(3);
  });

  it('acepta una línea de contexto vacía sin el espacio inicial', () => {
    const h = parsePatch('@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n');
    expect(h[0]!.lines.map((l) => [l.kind, l.text])).toEqual([['ctx', 'a'], ['ctx', ''], ['del', 'b'], ['add', 'B']]);
  });

  it('un parche sin bloques (renombrado sin cambios, archivo vacío) no da nada', () => {
    expect(parsePatch(parche('diff --git a/a b/b', 'similarity index 100%', 'rename from a', 'rename to b'))).toEqual([]);
    expect(parsePatch('')).toEqual([]);
  });

  it('conserva sangrías, tabuladores y espacios finales', () => {
    const h = parsePatch('@@ -1 +1 @@\n-\tx  \n+    y\n');
    expect(h[0]!.lines.map((l) => l.text)).toEqual(['\tx  ', '    y']);
  });
});

describe('toSplitRows', () => {
  const filas = (p: string) => toSplitRows(parsePatch(p));
  const resumen = (p: string) =>
    filas(p).map((r) => (r.type === 'hunk' ? 'hunk' : `${r.left ? `${r.left.kind}${r.left.no}:${r.left.text}` : '·'} | ${r.right ? `${r.right.kind}${r.right.no}:${r.right.text}` : '·'}`));

  it('el contexto va en las dos columnas', () => {
    expect(resumen(parche('@@ -5,1 +7,1 @@', ' igual'))).toEqual(['hunk', 'ctx5:igual | ctx7:igual']);
  });

  it('empareja un tramo de quitadas con el de añadidas que le sigue', () => {
    expect(resumen(parche('@@ -1,4 +1,4 @@', ' a', '-b', '-c', '+B', '+C', ' d'))).toEqual([
      'hunk',
      'ctx1:a | ctx1:a',
      'del2:b | add2:B',
      'del3:c | add3:C',
      'ctx4:d | ctx4:d',
    ]);
  });

  it('rellena con huecos el lado más corto', () => {
    expect(resumen(parche('@@ -1,3 +1,2 @@', '-a', '-b', '-c', '+A', '+B'))).toEqual(['hunk', 'del1:a | add1:A', 'del2:b | add2:B', 'del3:c | ·']);
    expect(resumen(parche('@@ -1,1 +1,3 @@', '-a', '+A', '+B', '+C'))).toEqual(['hunk', 'del1:a | add1:A', '· | add2:B', '· | add3:C']);
  });

  it('solo quitadas o solo añadidas dejan hueco en el otro lado', () => {
    expect(resumen(parche('@@ -1,2 +0,0 @@', '-a', '-b'))).toEqual(['hunk', 'del1:a | ·', 'del2:b | ·']);
    expect(resumen(parche('@@ -0,0 +1,2 @@', '+a', '+b'))).toEqual(['hunk', '· | add1:a', '· | add2:b']);
  });

  it('una quitada después de añadidas abre un tramo nuevo, y el contexto cierra el tramo', () => {
    expect(resumen(parche('@@ -1,3 +1,3 @@', '-a', '+A', '-b', '+B', ' c'))).toEqual(['hunk', 'del1:a | add1:A', 'del2:b | add2:B', 'ctx3:c | ctx3:c']);
  });

  it('cada bloque empieza con su cabecera y no arrastra tramos al siguiente', () => {
    const r = filas(parche('@@ -1,1 +1,0 @@', '-a', '@@ -9,0 +8,1 @@', '+z'));
    expect(r.map((x) => x.type)).toEqual(['hunk', 'code', 'hunk', 'code']);
    expect(r[1]).toMatchObject({ left: { kind: 'del', no: 1 }, right: null });
    expect(r[3]).toMatchObject({ left: null, right: { kind: 'add', no: 8 } });
  });

  it('conserva la marca de sin salto de línea final en su lado', () => {
    const r = filas(parche('@@ -1,1 +1,1 @@', '-a', '\\ No newline at end of file', '+a'));
    expect(r[1]).toMatchObject({ left: { noEol: true }, right: { noEol: false } });
  });
});

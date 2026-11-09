// Parche unificado de git a bloques y líneas, y su conversión a filas lado a lado.
// Lógica pura: la vista (DiffView.tsx) solo la pinta.

export type DiffKind = 'ctx' | 'add' | 'del';

export type DiffLine = {
  kind: DiffKind;
  text: string;
  /** Número de línea en la versión anterior (null en las añadidas) y en la nueva (null en las quitadas). */
  oldNo: number | null;
  newNo: number | null;
  /** El archivo no termina en salto de línea en esta línea (`\ No newline at end of file`). */
  noEol: boolean;
};

export type Hunk = { header: string; lines: DiffLine[] };

const CABECERA = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Bloques de un parche de un solo archivo. Todo lo anterior al primer `@@`
 * (cabeceras de git: `diff --git`, `rename from`, `index`…) se ignora, y el
 * cuerpo de cada bloque se lee con los recuentos de su cabecera, de modo que una
 * línea que empiece por `--- ` o `+++ ` no se confunde con una cabecera.
 */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let actual: Hunk | null = null;
  let viejas = 0;
  let nuevas = 0;
  let o = 0;
  let n = 0;
  const lineas = patch.split('\n');
  // El último elemento vacío es el salto de línea final del parche.
  if (lineas[lineas.length - 1] === '') lineas.pop();
  for (const linea of lineas) {
    const c = CABECERA.exec(linea);
    if (c) {
      o = Number(c[1]);
      n = Number(c[3]);
      viejas = c[2] === undefined ? 1 : Number(c[2]);
      nuevas = c[4] === undefined ? 1 : Number(c[4]);
      actual = { header: linea, lines: [] };
      hunks.push(actual);
      continue;
    }
    if (!actual) continue;
    if (linea.startsWith('\\')) {
      const ultima = actual.lines[actual.lines.length - 1];
      if (ultima) ultima.noEol = true;
      continue;
    }
    if (viejas <= 0 && nuevas <= 0) continue;
    const k = linea[0];
    const texto = linea.slice(1);
    if (k === '-') {
      actual.lines.push({ kind: 'del', text: texto, oldNo: o++, newNo: null, noEol: false });
      viejas--;
    } else if (k === '+') {
      actual.lines.push({ kind: 'add', text: texto, oldNo: null, newNo: n++, noEol: false });
      nuevas--;
    } else {
      // Contexto: git escribe un espacio; algunas herramientas lo recortan en las líneas vacías.
      actual.lines.push({ kind: 'ctx', text: k === ' ' ? texto : linea, oldNo: o++, newNo: n++, noEol: false });
      viejas--;
      nuevas--;
    }
  }
  return hunks;
}

export type SplitSide = { kind: DiffKind; no: number; text: string; noEol: boolean };
export type SplitRow = { type: 'hunk'; header: string } | { type: 'code'; left: SplitSide | null; right: SplitSide | null };

/**
 * Filas lado a lado: el contexto va en las dos columnas; cada tramo de líneas
 * quitadas se empareja fila a fila con el tramo de añadidas que le sigue, y el
 * lado más corto se rellena con huecos (null).
 */
export function toSplitRows(hunks: readonly Hunk[]): SplitRow[] {
  const filas: SplitRow[] = [];
  let quitadas: DiffLine[] = [];
  let anadidas: DiffLine[] = [];
  const lado = (l: DiffLine | undefined, cual: 'old' | 'new'): SplitSide | null =>
    l ? { kind: l.kind, no: (cual === 'old' ? l.oldNo : l.newNo) ?? 0, text: l.text, noEol: l.noEol } : null;
  const volcar = () => {
    const max = Math.max(quitadas.length, anadidas.length);
    for (let i = 0; i < max; i++) filas.push({ type: 'code', left: lado(quitadas[i], 'old'), right: lado(anadidas[i], 'new') });
    quitadas = [];
    anadidas = [];
  };
  for (const h of hunks) {
    filas.push({ type: 'hunk', header: h.header });
    for (const l of h.lines) {
      if (l.kind === 'del') {
        // Una quitada tras añadidas abre un tramo nuevo.
        if (anadidas.length > 0) volcar();
        quitadas.push(l);
      } else if (l.kind === 'add') {
        anadidas.push(l);
      } else {
        volcar();
        filas.push({ type: 'code', left: lado(l, 'old'), right: lado(l, 'new') });
      }
    }
    volcar();
  }
  return filas;
}

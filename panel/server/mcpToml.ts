// Lector mínimo de TOML para el `config.toml` de Codex (pantalla MCPs). No es un
// parser completo: solo construye las tablas `mcp_servers.<nombre>` (con sus
// subtablas `env`, `http_headers`…) y recorre el resto del archivo sin interpretarlo,
// lo justo para no confundir un valor de varias líneas con una cabecera. Si una
// línea dentro de la tabla de un MCP no se entiende, ese MCP queda marcado como
// incompleto en lugar de inventar datos. Sin dependencias; si hiciera falta TOML
// completo, el plan B es `smol-toml`.

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
// Objetos sin prototipo: las claves vienen del archivo (`__proto__`, `constructor`…).
export type TomlTable = { [clave: string]: TomlValue };

export type TomlMcpServer = { name: string; table: TomlTable; incomplete: boolean };

const MAX_SERVERS = 500;
const MAX_DEPTH = 16;

class Fallo extends Error {}

const nuevaTabla = (): TomlTable => Object.create(null) as TomlTable;
const esTabla = (v: unknown): v is TomlTable => typeof v === 'object' && v !== null && !Array.isArray(v);

const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
const BARE_KEY = /^[A-Za-z0-9_-]+/;
const BARE_VALUE = /^[A-Za-z0-9_+\-.:]+/;
const NUMERO = /^[+-]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|(?:inf|nan)|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9][0-9_]*)?)$/;
const FECHA = /^(?:[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt][0-9:.]+(?:[Zz]|[+-][0-9:]+)?)?|[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)$/;

/**
 * Tablas `[mcp_servers.<nombre>]` de un `config.toml`, en orden de aparición.
 * Nunca lanza: lo que no se entiende se ignora o marca el MCP como incompleto.
 */
export function readMcpServersToml(texto: string): TomlMcpServer[] {
  const t = texto.replace(/^﻿/, '');
  const n = t.length;
  let i = 0;
  const servidores = new Map<string, TomlMcpServer>();

  const servidor = (nombre: string): TomlMcpServer | null => {
    const existente = servidores.get(nombre);
    if (existente) return existente;
    if (servidores.size >= MAX_SERVERS) return null;
    const nuevo: TomlMcpServer = { name: nombre, table: nuevaTabla(), incomplete: false };
    servidores.set(nombre, nuevo);
    return nuevo;
  };

  const blancosH = () => {
    while (i < n && (t[i] === ' ' || t[i] === '\t')) i++;
  };
  const comentario = () => {
    if (t[i] === '#') while (i < n && t[i] !== '\n') i++;
  };
  // Blancos, saltos de línea y comentarios (dentro de listas y entre sentencias).
  const blancos = () => {
    for (;;) {
      const antes = i;
      while (i < n && /\s/.test(t[i]!)) i++;
      comentario();
      if (i === antes) return;
    }
  };
  const finDeLinea = () => {
    blancosH();
    comentario();
    if (i < n && t[i] !== '\n' && t[i] !== '\r') throw new Fallo();
  };
  const esperar = (c: string) => {
    if (t[i] !== c) throw new Fallo();
    i++;
  };

  const cadenaBasica = (): string => {
    esperar('"');
    let r = '';
    for (;;) {
      if (i >= n || t[i] === '\n') throw new Fallo();
      const c = t[i++]!;
      if (c === '"') return r;
      if (c !== '\\') {
        r += c;
        continue;
      }
      r += escape();
    }
  };
  const escape = (): string => {
    const e = t[i++];
    if (e === undefined) throw new Fallo();
    if (Object.hasOwn(ESCAPES, e)) return ESCAPES[e]!;
    if (e === 'u' || e === 'U') {
      const len = e === 'u' ? 4 : 8;
      const hex = t.slice(i, i + len);
      if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) throw new Fallo();
      i += len;
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        throw new Fallo();
      }
    }
    throw new Fallo();
  };
  const cadenaLiteral = (): string => {
    esperar("'");
    const fin = t.indexOf("'", i);
    const r = fin === -1 ? null : t.slice(i, fin);
    if (r === null || r.includes('\n')) throw new Fallo();
    i = fin + 1;
    return r;
  };
  const cadenaMultilinea = (comilla: '"' | "'"): string => {
    const triple = comilla.repeat(3);
    i += 3;
    if (t[i] === '\r' && t[i + 1] === '\n') i += 2;
    else if (t[i] === '\n') i++;
    let r = '';
    for (;;) {
      if (i >= n) throw new Fallo();
      if (t.startsWith(triple, i)) {
        i += 3;
        // Hasta dos comillas más pegadas al cierre pertenecen al texto.
        for (let extra = 0; extra < 2 && t[i] === comilla; extra++) {
          r += comilla;
          i++;
        }
        return r;
      }
      const c = t[i++]!;
      if (comilla === '"' && c === '\\') {
        // Barra al final de línea: se descartan los blancos que siguen.
        if (/[ \t\r\n]/.test(t[i] ?? '')) {
          while (i < n && /\s/.test(t[i]!)) i++;
        } else r += escape();
        continue;
      }
      r += c;
    }
  };

  const clave = (): string[] => {
    const partes: string[] = [];
    for (;;) {
      blancosH();
      const c = t[i];
      if (c === '"') partes.push(cadenaBasica());
      else if (c === "'") partes.push(cadenaLiteral());
      else {
        const m = BARE_KEY.exec(t.slice(i, i + 256));
        if (!m) throw new Fallo();
        partes.push(m[0]);
        i += m[0].length;
      }
      blancosH();
      if (t[i] === '.') {
        i++;
        continue;
      }
      return partes;
    }
  };

  const fijar = (tabla: TomlTable, ruta: string[], valor: TomlValue): void => {
    let actual = tabla;
    for (const p of ruta.slice(0, -1)) {
      const siguiente = actual[p];
      if (siguiente === undefined) {
        const nueva = nuevaTabla();
        actual[p] = nueva;
        actual = nueva;
      } else if (esTabla(siguiente)) actual = siguiente;
      else throw new Fallo();
    }
    const ultima = ruta[ruta.length - 1]!;
    // Una clave repetida es un TOML inválido: Codex tampoco lo leería.
    if (actual[ultima] !== undefined) throw new Fallo();
    actual[ultima] = valor;
  };

  const valor = (profundidad: number): TomlValue => {
    if (profundidad > MAX_DEPTH) throw new Fallo();
    blancosH();
    const c = t[i];
    if (c === '"') return t.startsWith('"""', i) ? cadenaMultilinea('"') : cadenaBasica();
    if (c === "'") return t.startsWith("'''", i) ? cadenaMultilinea("'") : cadenaLiteral();
    if (c === '[') {
      i++;
      const lista: TomlValue[] = [];
      for (;;) {
        blancos();
        if (t[i] === ']') {
          i++;
          return lista;
        }
        lista.push(valor(profundidad + 1));
        blancos();
        if (t[i] === ',') i++;
        else if (t[i] !== ']') throw new Fallo();
      }
    }
    if (c === '{') {
      i++;
      const tabla = nuevaTabla();
      for (;;) {
        blancos();
        if (t[i] === '}') {
          i++;
          return tabla;
        }
        const k = clave();
        blancosH();
        esperar('=');
        fijar(tabla, k, valor(profundidad + 1));
        blancos();
        if (t[i] === ',') i++;
        else if (t[i] !== '}') throw new Fallo();
      }
    }
    const m = BARE_VALUE.exec(t.slice(i, i + 64));
    if (!m) throw new Fallo();
    i += m[0].length;
    if (m[0] === 'true') return true;
    if (m[0] === 'false') return false;
    if (NUMERO.test(m[0])) return Number(m[0].replace(/_/g, ''));
    if (FECHA.test(m[0])) return m[0];
    throw new Fallo();
  };

  // Tabla en curso: su ruta y si sus claves se ignoran (`[[…]]`, cabecera no entendida).
  let ruta: string[] = [];
  let ignorar = false;

  for (;;) {
    blancos();
    if (i >= n) break;
    const inicio = i;
    // El MCP al que pertenece lo que se lee, para marcarlo incompleto si falla.
    let afectado: string | null = ruta[0] === 'mcp_servers' && ruta.length >= 2 ? ruta[1]! : null;
    try {
      if (t[i] === '[') {
        const doble = t[i + 1] === '[';
        i += doble ? 2 : 1;
        ruta = [];
        ignorar = true;
        const partes = clave();
        afectado = partes[0] === 'mcp_servers' && partes.length >= 2 ? partes[1]! : null;
        blancosH();
        esperar(']');
        if (doble) esperar(']');
        finDeLinea();
        ruta = partes;
        ignorar = doble;
        if (afectado !== null) servidor(afectado);
      } else {
        const k = clave();
        blancosH();
        esperar('=');
        const v = valor(0);
        finDeLinea();
        const completa = [...ruta, ...k];
        if (!ignorar && completa[0] === 'mcp_servers' && completa.length >= 2) {
          afectado = completa[1]!;
          const s = servidor(afectado);
          if (s) {
            if (completa.length === 2) {
              if (!esTabla(v)) throw new Fallo();
              for (const [kk, vv] of Object.entries(v)) fijar(s.table, [kk], vv);
            } else fijar(s.table, completa.slice(2), v);
          }
        }
      }
    } catch (e) {
      if (!(e instanceof Fallo)) throw e;
      if (afectado !== null) {
        const s = servidor(afectado);
        if (s) s.incomplete = true;
      }
      // Se reanuda en la línea siguiente a la del error (o a la de la sentencia).
      const fin = t.indexOf('\n', Math.max(i, inicio));
      i = fin === -1 ? n : fin + 1;
    }
  }
  return [...servidores.values()];
}

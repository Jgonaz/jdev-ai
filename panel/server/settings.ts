import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './paths.ts';
import {
  ACCENTS,
  AGENTS,
  CURSORS,
  DEFAULT_PORT,
  DEFAULT_SETTINGS,
  LAYOUTS,
  LOCATIONS,
  START_SCREENS,
  THEMES,
  isSoundId,
  isValidProfileName,
  isValidRunCommand,
} from '../shared/settings-schema.ts';
import type { ProjectOverride, Settings } from '../shared/settings-schema.ts';

// La estructura y los valores por defecto viven en shared/ para que el cliente
// los comparta; aquí se reexportan para el resto del servidor.
export { ACCENTS, AGENTS, CURSORS, DEFAULT_PORT, DEFAULT_SETTINGS, LAYOUTS, LOCATIONS, START_SCREENS, THEMES };
export type { ProjectOverride, Settings };

// Esquema de validación: cada hoja devuelve true si el valor es aceptable. Los
// valores que no pasan se ignoran (se conserva el anterior), igual que las
// claves desconocidas, para que un archivo editado a mano no rompa el panel.
type Hoja = (valor: unknown) => boolean;
type Nodo = Hoja | { grupo: Record<string, Nodo> } | { registro: Record<string, Hoja> };

const enumerado =
  (...validos: readonly unknown[]): Hoja =>
  (v) =>
    validos.includes(v);
const booleano: Hoja = (v) => typeof v === 'boolean';
// Tamaños con medios puntos (p. ej. 12,5 px) dentro de un rango.
const mediaUnidad =
  (min: number, max: number): Hoja =>
  (v) =>
    typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v * 2) && v >= min && v <= max;
const entero =
  (min: number, max: number): Hoja =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
// Las fuentes acaban en una propiedad CSS: se limitan los caracteres para que
// no puedan cerrar la declaración ni inyectar otras.
const fuente: Hoja = (v) => typeof v === 'string' && v.length <= 200 && /^[\p{L}\p{N} ,'"._-]+$/u.test(v);
const monograma: Hoja = (v) => typeof v === 'string' && /^[\p{L}\p{N}]{1,2}$/u.test(v);
const color: Hoja = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
// Nombre del saludo: texto corto de una línea (sin caracteres de control ni
// separadores de línea), con la misma regla que el cliente; '' vuelve al nombre de Git.
const nombre: Hoja = isValidProfileName;
// Comando de arranque de un proyecto: una línea de hasta 500 caracteres.
const comandoArranque: Hoja = isValidRunCommand;

const ESQUEMA: Record<string, Nodo> = {
  theme: { grupo: { name: enumerado(...THEMES), followSystem: booleano, accent: enumerado(...ACCENTS) } },
  fonts: { grupo: { ui: fuente, title: fuente, terminal: fuente } },
  sizes: { grupo: { ui: entero(10, 24), title: entero(12, 40), terminal: mediaUnidad(8, 28) } },
  terminal: {
    grupo: {
      cursor: enumerado(...CURSORS),
      initialLayout: enumerado(...LAYOUTS),
      scrollback: entero(100, 100000),
      copyOnSelect: booleano,
      cleanCopy: booleano,
      tmuxBar: booleano,
      hoverPreview: booleano,
      autoOpenImages: booleano,
    },
  },
  personality: {
    grupo: { cursor: booleano, lights: booleano, ascii: booleano, greeting: booleano, grid: booleano },
  },
  inicio: { grupo: { activity: booleano } },
  notifications: {
    grupo: {
      system: booleano,
      counter: booleano,
      sound: booleano,
      onFinish: booleano,
      soundWaiting: isSoundId,
      soundFinish: isSoundId,
    },
  },
  newSession: { grupo: { agent: enumerado(...AGENTS), location: enumerado(...LOCATIONS) } },
  profile: { grupo: { name: nombre } },
  startScreen: enumerado(...START_SCREENS),
  port: entero(1024, 65535),
  projects: { registro: { mono: monograma, color, visible: booleano, run: comandoArranque } },
};

type Objeto = Record<string, unknown>;

const esObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null && !Array.isArray(v);

// Los identificadores de proyecto son nombres de carpeta; se descartan los que
// podrían tocar el prototipo o no son un nombre razonable.
const idProyectoValido = (id: string) => /^[\p{L}\p{N}._-]{1,100}$/u.test(id) && !id.startsWith('__');

// Aplica sobre `destino` solo lo válido de `parche`. Para los overrides por
// proyecto, `null` elimina el proyecto o el campo.
function aplicar(destino: Objeto, parche: unknown, esquema: Record<string, Nodo>): void {
  if (!esObjeto(parche)) return;
  for (const [clave, nodo] of Object.entries(esquema)) {
    if (!Object.hasOwn(parche, clave)) continue;
    const valor = parche[clave];
    if (typeof nodo === 'function') {
      if (nodo(valor)) destino[clave] = valor;
    } else if ('grupo' in nodo) {
      const hijo = destino[clave];
      if (esObjeto(hijo)) aplicar(hijo, valor, nodo.grupo);
    } else {
      aplicarRegistro(destino[clave] as Objeto, valor, nodo.registro);
    }
  }
}

function aplicarRegistro(destino: Objeto, parche: unknown, campos: Record<string, Hoja>): void {
  if (!esObjeto(parche)) return;
  for (const [id, entrada] of Object.entries(parche)) {
    if (!idProyectoValido(id)) continue;
    if (entrada === null) {
      delete destino[id];
      continue;
    }
    if (!esObjeto(entrada)) continue;
    const actual: Objeto = esObjeto(destino[id]) && Object.hasOwn(destino, id) ? { ...destino[id] } : {};
    for (const [campo, valida] of Object.entries(campos)) {
      if (!Object.hasOwn(entrada, campo)) continue;
      const valor = entrada[campo];
      // Un comando de arranque vacío o solo de espacios, como null, vuelve a la detección.
      const vacio = campo === 'run' && typeof valor === 'string' && valor.trim() === '';
      if (valor === null || vacio) delete actual[campo];
      else if (valida(valor)) actual[campo] = valor;
    }
    if (Object.keys(actual).length > 0) destino[id] = actual;
    else delete destino[id];
  }
}

export function settingsPath(dir: string = configDir()): string {
  return join(dir, 'panel.json');
}

// Fusión profunda de `parche` sobre `base`, ignorando lo no válido. No muta `base`.
export function mergeSettings(base: Settings, parche: unknown): Settings {
  const copia = structuredClone(base) as unknown as Objeto;
  aplicar(copia, parche, ESQUEMA);
  return copia as unknown as Settings;
}

// Lee los ajustes sobre los valores por defecto: un archivo ausente, ilegible
// o con basura devuelve los valores por defecto, y las claves nuevas del panel
// toman su valor por defecto en archivos antiguos.
export function readSettings(dir: string = configDir()): Settings {
  let crudo: unknown;
  try {
    crudo = JSON.parse(readFileSync(settingsPath(dir), 'utf8'));
  } catch {
    crudo = undefined;
  }
  return mergeSettings(DEFAULT_SETTINGS, crudo);
}

// Escritura atómica: archivo temporal en el mismo directorio y rename.
export function writeSettings(settings: Settings, dir: string = configDir()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destino = settingsPath(dir);
  const temporal = `${destino}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(temporal, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(temporal, 0o600);
  renameSync(temporal, destino);
}

// PUT parcial: fusiona sobre lo guardado, persiste y devuelve el resultado.
export function updateSettings(parche: unknown, dir: string = configDir()): Settings {
  const resultado = mergeSettings(readSettings(dir), parche);
  writeSettings(resultado, dir);
  return resultado;
}

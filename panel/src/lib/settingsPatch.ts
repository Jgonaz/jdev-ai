import type { Settings } from '../types.ts';

export type Patch = { [clave: string]: unknown };

const esObjeto = (v: unknown): v is Patch => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tipo de un parche profundo de Ajustes. */
export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] extends object
    ? K extends 'projects'
      ? Record<string, { mono?: string | null; color?: string | null; visible?: boolean | null } | null>
      : { [P in keyof Settings[K]]?: Settings[K][P] }
    : Settings[K];
};

/**
 * Fusión profunda de dos parches (el segundo gana). Sirve para acumular los
 * cambios pendientes de guardar. Respeta `null` (borrar override de proyecto).
 */
export function mergePatches(a: Patch, b: Patch): Patch {
  const salida: Patch = { ...a };
  for (const [clave, valor] of Object.entries(b)) {
    const previo = salida[clave];
    salida[clave] = esObjeto(previo) && esObjeto(valor) ? mergePatches(previo, valor) : valor;
  }
  return salida;
}

/**
 * Aplica un parche sobre los ajustes en el cliente, con la misma semántica que
 * el servidor para los overrides de proyecto: `null` borra el proyecto o el
 * campo. La validación definitiva sigue siendo del servidor.
 */
export function applyPatch(base: Settings, parche: SettingsPatch): Settings {
  const copia = structuredClone(base) as unknown as Patch;
  fusionar(copia, parche as Patch, false);
  return copia as unknown as Settings;
}

function fusionar(destino: Patch, parche: Patch, borrarNulos: boolean): void {
  for (const [clave, valor] of Object.entries(parche)) {
    if (clave === '__proto__' || clave === 'constructor') continue;
    if (valor === null && borrarNulos) {
      delete destino[clave];
      continue;
    }
    if (esObjeto(valor)) {
      const actual = destino[clave];
      const hijo: Patch = esObjeto(actual) ? actual : {};
      destino[clave] = hijo;
      // Dentro de `projects`, null elimina; fuera, no hay nulos.
      fusionar(hijo, valor, borrarNulos || clave === 'projects');
      if (borrarNulos && Object.keys(hijo).length === 0) delete destino[clave];
    } else if (valor !== undefined) {
      destino[clave] = valor;
    }
  }
}

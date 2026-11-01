// Caché de promesas con caducidad corta: la miniatura al pasar el ratón repite
// el HEAD de la misma ruta muchas veces. Caduca porque una captura puede
// sobrescribirse con el mismo nombre. Los errores no se guardan.

export type ProbeCache<T> = { get: (clave: string, cargar: () => Promise<T>) => Promise<T>; clear: () => void };

export function createProbeCache<T>(opciones: { max?: number; ttlMs?: number; now?: () => number } = {}): ProbeCache<T> {
  const { max = 40, ttlMs = 30_000, now = Date.now } = opciones;
  const entradas = new Map<string, { at: number; valor: Promise<T> }>();
  return {
    get(clave, cargar) {
      const t = now();
      const previa = entradas.get(clave);
      if (previa && t - previa.at < ttlMs) return previa.valor;
      entradas.delete(clave);
      const valor = cargar();
      entradas.set(clave, { at: t, valor });
      // Una carga fallida no se recuerda (el archivo puede aparecer o cambiar de permisos).
      valor.catch(() => {
        if (entradas.get(clave)?.valor === valor) entradas.delete(clave);
      });
      while (entradas.size > max) {
        const primera = entradas.keys().next().value;
        if (primera === undefined) break;
        entradas.delete(primera);
      }
      return valor;
    },
    clear: () => entradas.clear(),
  };
}

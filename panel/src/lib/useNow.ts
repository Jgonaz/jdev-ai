import { useEffect, useState } from 'react';
import { serverNow } from './serverClock.ts';

/** Hora actual (según el reloj del servidor) que se refresca cada `ms`, para los tiempos relativos. */
export function useNow(ms = 30_000): number {
  const [ahora, setAhora] = useState(serverNow);
  useEffect(() => {
    const t = window.setInterval(() => setAhora(serverNow()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return ahora;
}

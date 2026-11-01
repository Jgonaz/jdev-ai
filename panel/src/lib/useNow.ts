import { useEffect, useState } from 'react';

/** Hora actual que se refresca cada `ms`, para los tiempos relativos. */
export function useNow(ms = 30_000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return ahora;
}

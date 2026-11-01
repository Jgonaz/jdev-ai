import { useEffect, useState } from 'react';

/** Se mantiene al día con una media query (false si el entorno no tiene matchMedia). */
export function useMediaQuery(consulta: string): boolean {
  const [coincide, setCoincide] = useState(() => window.matchMedia?.(consulta).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(consulta);
    if (!mq) return;
    const alCambiar = () => setCoincide(mq.matches);
    alCambiar();
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, [consulta]);
  return coincide;
}

/**
 * Navegación con el teclado de un grupo de radios (patrón WAI-ARIA): las
 * flechas se mueven al siguiente o anterior habilitado, con vuelta al
 * principio, y Inicio/Fin saltan al primero/último habilitado.
 * Devuelve el nuevo índice, o null si la tecla no navega o no hay destino.
 */
export function nextRadioIndex(key: string, actual: number, deshabilitados: readonly boolean[]): number | null {
  const n = deshabilitados.length;
  const habilitado = (i: number) => !deshabilitados[i];
  const buscar = (desde: number, paso: 1 | -1): number | null => {
    for (let k = 1; k <= n; k++) {
      const i = (((desde + paso * k) % n) + n) % n;
      if (habilitado(i)) return i;
    }
    return null;
  };
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return buscar(actual, 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return buscar(actual, -1);
    case 'Home':
      return buscar(-1, 1);
    case 'End':
      return buscar(n, -1);
    default:
      return null;
  }
}

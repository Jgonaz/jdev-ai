/**
 * ¿Puede una terminal quedarse con el foco al activarse? Solo si el foco no
 * está en otro control: en el cuerpo de la página (nada enfocado) o en una
 * terminal. Así, activar pestañas con las flechas mantiene el foco en la
 * pestaña y cerrar un diálogo lo devuelve a quien lo abrió.
 */
export function terminalMayTakeFocus(activo: Element | null, cuerpo: Element | null = document.body): boolean {
  return activo === null || activo === cuerpo || activo.closest('.termbody') !== null;
}

/** Mueve el foco a la pestaña seleccionada (Ctrl+Alt+Escape). */
export function focusActiveTab(): boolean {
  const pestaña = document.querySelector<HTMLElement>('.tab[aria-selected="true"]');
  pestaña?.focus();
  return pestaña !== null;
}

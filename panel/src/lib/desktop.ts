/**
 * ¿Corre el panel dentro de la app de escritorio (Tauri)? Tauri inyecta
 * `window.__TAURI_INTERNALS__` en toda página de su ventana, también en la que se
 * carga desde http://localhost:<puerto> (la capability remota solo limita qué
 * comandos puede invocar, no la inyección). En un navegador no existe.
 */
export function isDesktop(w: object | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  return w !== undefined && '__TAURI_INTERNALS__' in w;
}

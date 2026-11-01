## 1. Harness

- [x] 1.1 `bin/session-status`: omitir los pendientes marcados `[x] ` y el apartado si no queda ninguno
- [x] 1.2 `rules/history.md`: documentar la marca de pendiente resuelto y que se conserva al actualizar
- [x] 1.3 Pruebas en `bin/check`

## 2. Servidor del panel

- [x] 2.1 `server/history.ts`: lectura tolerante, pendientes, `etag`, caché y vigilancia con evento `history`
- [x] 2.2 Endpoints de lista con filtros y de detalle, con validación de rutas
- [x] 2.3 Marcar y desmarcar pendientes con `etag` y edición mínima
- [x] 2.4 Pruebas con carpetas de historial temporales

## 3. Cliente

- [x] 3.1 Ruta y navegación de Historial
- [x] 3.2 Lista agrupada por día con filtros y «Solo con Pendiente de ti» según `Registro.dc.html`
- [x] 3.3 Lector con «Pendiente de ti» destacado, casillas de marcar y secciones con el visor de Markdown
- [x] 3.4 «Retomar desde aquí» con Nueva sesión
- [x] 3.5 Pruebas de la lógica pura
- [x] 3.6 Vista «Por fecha / Por proyecto» en la lista, con grupos por proyecto como Sesiones recientes y elección recordada

## 4. Documentación y validación

- [x] 4.1 README (pantalla Historial)
- [x] 4.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 4.3 QA de punta a punta contra el diseño aprobado

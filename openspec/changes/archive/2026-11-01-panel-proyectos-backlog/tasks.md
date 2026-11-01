## 1. Servidor

- [x] 1.1 Añadir `yaml` y `marked` a `panel/` y crear `server/backlog.ts`: lectura por estados, cabecera, formato antiguo, resumen, tiempo de lectura, `etag`, caché y vigilancia con evento `backlog`
- [x] 1.2 Endpoints de lista y detalle del backlog y recuento de cambios sin commit
- [x] 1.3 Cambio de estado: transiciones permitidas, `etag`, edición de `status` y `updated`, escritura atómica y `git mv`
- [x] 1.4 Guías (lista y contenido con validación de ruta) y datos ampliados de worktrees
- [x] 1.5 Pruebas con repositorios Git temporales

## 2. Cliente

- [x] 2.1 Ruta y navegación de Proyectos; lista de proyectos con recuentos
- [x] 2.2 Columnas por estado, tarjetas, filtros, búsqueda y estado vacío según `Proyecto.dc.html`
- [x] 2.3 Detalle: propiedades, resumen con tiempo de lectura, detalle plegable, fuente y avisos
- [x] 2.4 Visor de Markdown seguro con `marked.lexer` y componentes de React
- [x] 2.5 Mover estado («Pasar a por hacer», «Mover a»), conflicto 409, cambios sin commit y «Trabajar en esto»
- [x] 2.6 Pestañas Worktrees y Guías
- [x] 2.7 Pruebas de la lógica pura

## 3. Documentación y validación

- [x] 3.1 README (pantalla Proyectos) y spec sincronizada al archivar
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 3.3 QA de punta a punta contra el diseño aprobado

## 4. Confirmar cambios del backlog

- [x] 4.1 Servidor: vista previa (archivos, rama, remoto, mensaje propuesto) y `POST` de commit solo de `docs/backlog/` con push opcional, hooks respetados y errores con salida
- [x] 4.2 Cliente: botón «Confirmar cambios» y diálogo con mensaje editable, casilla de push recordada, progreso y errores
- [x] 4.3 Pruebas con repositorios y remotos temporales, validaciones y comprobación manual aislada

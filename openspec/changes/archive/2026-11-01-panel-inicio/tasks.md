## 1. Harness

- [x] 1.1 `bin/session-state`: campo `message` recortado en las notificaciones que dejan la sesión esperando y vacío en el resto
- [x] 1.2 Pruebas en `bin/check`

## 2. Servidor del panel

- [x] 2.1 Exponer `notice` en las sesiones a partir de `message`
- [x] 2.2 `GET /api/overview` con proyectos, recuentos, última actividad, último registro, pendientes y actividad reciente, más `gitName`
- [x] 2.3 Ajustes `profile.name` y `startScreen` en el esquema compartido con validación
- [x] 2.4 Pruebas

## 3. Cliente

- [x] 3.1 Ruta y navegación de Inicio, logo y pantalla al abrir según `startScreen`
- [x] 3.2 Saludo, resumen y chips de estado según `Inicio.dc.html`
- [x] 3.3 «Necesita tu atención» con sesiones que esperan, cerradas abiertas, pendientes del historial y estado tranquilo
- [x] 3.4 Tarjetas de proyecto por actividad con sus acciones
- [x] 3.5 Actividad reciente
- [x] 3.6 Ajustes «Tu nombre» y «Pantalla al abrir»
- [x] 3.7 Pruebas de la lógica pura

## 4. Documentación y validación

- [x] 4.1 README (pantalla Inicio, ajustes nuevos, sin pantallas «Próximamente»)
- [x] 4.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 4.3 QA de punta a punta contra el diseño aprobado, si la persona da el visto bueno

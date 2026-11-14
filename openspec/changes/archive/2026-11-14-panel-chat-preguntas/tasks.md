## 0. Proceso

- [x] 0.1 Revisión del cambio OpenSpec con la persona
- [x] 0.2 Diseño de las tarjetas en Claude Design aprobado y URL anotada en `design.md`

## 1. Servidor del panel

- [x] 1.1 Evento `question` en el modo conversación de `parseAgentLines` y `answers` en su `result`, con fixtures reales
- [x] 1.2 Lectura de pantalla en `tui.ts`: menú de preguntas (pestañas, pregunta, opciones, marcas, revisión) y diálogo de permiso con sus opciones, con capturas reales
- [x] 1.3 `GET /api/sessions/:nombre/prompt`
- [x] 1.4 `POST /api/sessions/:nombre/answer` para preguntas, con comprobación paso a paso y `tui-mismatch`
- [x] 1.5 `POST /answer` para permisos
- [x] 1.6 Pruebas de la API con tmux simulado

## 2. Cliente

- [x] 2.1 Tarjeta de pregunta pendiente y respondida en `ChatBody`, también en la búsqueda
- [x] 2.2 Tarjeta de permiso
- [x] 2.3 Estados de envío y error, y aviso de espera solo para lo que el chat no contesta
- [x] 2.4 Pruebas de `lib/chat.ts` y de los componentes

## 2b. Ajustes de la QA

- [x] 2b.1 Hooks `PreToolUse` (AskUserQuestion) y `PermissionRequest` en `bin/session-state` y `bin/agent`, con pruebas en `bin/check`
- [x] 2b.2 El servidor usa el hook como origen de la pregunta y del permiso pendientes, con la transcripción y la pantalla como respaldo
- [x] 2b.3 Preguntas largas que la TUI parte con «│ » (F3) y etiquetas partidas sin espacios de más (F4)
- [x] 2b.4 Cliente: tarjeta pendiente sin línea en la transcripción, detalle del permiso, alerta visible (F5), pastilla «Recomendada», hora en «Respondida» y plurales

## 3. Cierre

- [x] 3.1 QA con Claude real: una y varias preguntas, selección múltiple, texto libre, contestada desde la terminal, permiso de Bash y pantalla estrecha
- [x] 3.2 Documentación del panel y changelog, si el proyecto lo contempla
- [x] 3.3 `bin/check`

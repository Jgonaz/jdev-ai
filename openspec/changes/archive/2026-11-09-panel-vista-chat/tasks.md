## 0. Proceso

- [x] 0.1 Revisión del cambio OpenSpec con la persona
- [x] 0.2 Diseño de la vista chat en Claude Design aprobado y URL anotada en `design.md`

## 1. Servidor del panel

- [x] 1.1 Modo conversación en `parseAgentLines` con eventos `user` y fixtures reales
- [x] 1.2 `conversation` en `Follower` desde el `transcriptPath` del estado, con validación de ruta
- [x] 1.3 `GET /api/sessions/:nombre/conversation` con `from`
- [x] 1.4 `POST /api/sessions/:nombre/input` con pegado entre corchetes
- [x] 1.5 `chat` en `SessionInfo` y pruebas

## 2. Cliente

- [x] 2.1 Conmutador Terminal / Chat en la cabecera, con preferencia por pestaña
- [x] 2.2 `ChatBody` con mensajes, grupos de herramientas, autoscroll y estados
- [x] 2.3 Búsqueda con resaltado y navegación
- [x] 2.4 Caja de entrada y aviso de espera en la terminal
- [x] 2.5 Pruebas de `lib/chat.ts`

## 2b. Comandos

- [x] 2b.1 Comandos como items del chat con su salida local
- [x] 2b.2 `/btw` con captura de la respuesta y cierre de su ventana
- [x] 2b.3 No enviar con una ventana o un menú abiertos en la terminal

## 2c. Ajustes de la QA

- [x] 2c.1 Comillas duplicadas en el resumen de un grupo
- [x] 2c.2 Aviso de espera en castellano y limitado a la columna de la caja de entrada
- [x] 2c.3 Accesibilidad: región `status` de mensajes nuevos, Esc en el tooltip y contraste de «Chat» desactivado
- [x] 2c.4 Ajustes del pane estrecho (punto de estado, caja de una fila, sin nota)
- [x] 2c.5 Rendimiento con transcripts enormes: búsqueda con retardo, resaltado limitado y ventana de render

## 2d. Ajustes de la QA con Claude real

- [x] 2d.1 `/btw` sin pulsar `c`: respuesta del texto visible de la ventana, desplazándola con Abajo y uniendo pantallas; fuera el filtro OSC 52 y los buffers de tmux
- [x] 2d.2 Comandos `system/local_command` (`/rename`, `/resume`, `/fork`, `/login`…) como eventos `command` y `command-output`
- [x] 2d.3 Quitar el envoltorio `<pasted_content id>` de los pegados largos de la persona
- [x] 2d.4 Transcript anunciado pero sin crear: respuesta vacía válida y estado vacío en el chat
- [x] 2d.5 React #185 al pulsar Enter en ráfaga en la búsqueda: navegación agrupada por fotograma (un salto por `requestAnimationFrame`) y efectos del salto idempotentes
- [x] 2d.6 Respuesta de `/btw` como texto preformateado (sin Markdown)

## 3. Documentación y validación

- [x] 3.1 README
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test`, `build` y `openspec validate --strict`
- [x] 3.3 QA con fidelidad al diseño, si la persona da el visto bueno

## Context

- Cada pestaña de terminal es un `tmux attach` en un pty, que se pinta con xterm.js (`server/main.ts`, `TerminalBody.tsx`). El panel no interpreta la conversación.
- El hook `bin/session-state` guarda, para cada sesión de Claude, `transcriptPath` y `tmuxSession` (`server/states.ts`). El panel lo enlaza con la sesión de tmux mediante `stateByTmuxSession`.
- La pestaña de seguimiento de subagentes ya lee transcripciones de forma incremental:
  - `parseAgentLines`, `leerLineas` y `Follower` en `server/follow.ts`;
  - `FollowPane.tsx` y `lib/follow.ts` en el cliente.

  `parseAgentLines` solo emite el primer mensaje de usuario.
- `typeLine` (`server/tmux.ts`) escribe una línea con `send-keys -l`. Cada salto de línea enviaría el mensaje antes de tiempo.
- Codex no tiene hooks de estado: el panel no sabe qué rollout corresponde a cada terminal.

## Goals / Non-Goals

**Goals:**

- Leer y buscar cómodamente la conversación de una sesión de Claude y escribirle sin salir de esa vista.

**Non-Goals:**

- Codex, que irá en un cambio posterior cuando haya un vínculo fiable con su rollout.
- Responder desde el chat a permisos, menús o `/comandos` de la TUI.
- Mostrar el razonamiento (`thinking`) del agente.
- Mostrar el chat de las conversaciones archivadas que no tienen terminal.

## Decisions

### Origen de los datos

- La transcripción es la del `transcriptPath` del estado del hook de la sesión. Se valida igual que en el seguimiento: archivo regular bajo el directorio `projects/` de Claude.
- No hay estado o no es de Claude: no hay chat, y el motivo viaja en `SessionInfo` (`chat: { available, reason }`).

### Parser

- `parseAgentLines` gana un modo «conversación» que emite cada mensaje real de la persona como evento `user` con su marca de tiempo.
- Se descartan los `user` sintéticos: los `tool_result` (que ya se emparejan como `result`), los `isMeta`, los recordatorios del sistema y las salidas de comandos locales.
- Los tipos desconocidos se ignoran.

### Lectura y API

- `GET /api/sessions/:nombre/conversation?from=<byte>` devuelve los eventos y el siguiente `from`. La primera carga pide trozos hasta llegar al final, para que la búsqueda cubra la conversación entera. Después, el cliente hace polling incremental, como en el seguimiento.
- `POST /api/sessions/:nombre/input` con `{ text }`:
  - acepta hasta 64 KiB y solo sesiones `jdev-*` de Claude;
  - el texto se carga con `tmux load-buffer` y se pega con `paste-buffer -p`, en modo de pegado entre corchetes, para conservar los saltos de línea;
  - después pulsa Enter.

### Cliente

- `Pane` mantiene montado `TerminalBody` y lo oculta en la vista chat, para no reconectar el WebSocket ni perder el scroll.
- La vista elegida se guarda por pestaña en el estado del espacio de trabajo.
- La agrupación de herramientas y la búsqueda son funciones puras en `lib/chat.ts`. Al buscar, los grupos que contienen una coincidencia se despliegan.
- El texto del agente se pinta con `marked` y se sanea como en el resto del panel. El de la persona se pinta como texto plano.
- Cuando el estado de la sesión es `waiting`, aparece el aviso con el enlace a la terminal.

### Diseño

- Diseño aprobado en Claude Design: https://claude.ai/artifact/7VPh22ob5eKMgbbm67N8wJ (paneles «Vista chat · escritorio», «Estados y conmutador» y «Layout estrecho»).

## Risks / Trade-offs

- **Transcripciones de varios MB:** se mantienen los topes por línea de `leerLineas` y la carga por trozos. Si el render se resiente, se virtualiza la lista.
- **Formato interno de Claude:** el JSONL puede cambiar. Se cubre con fixtures reales y se toleran los campos desconocidos.
- **Lo que solo existe en la TUI no aparece en el chat:** se mitiga con el aviso de espera y con el conmutador siempre a mano.
- **Sesiones retomadas:** hay que verificar que el estado apunta a la transcripción vigente.

## Context

- La vista chat (cambio archivado `2026-11-09-panel-vista-chat`) lee la transcripción con `parseAgentLines` en modo conversación (`server/follow.ts`). Cada `tool_use` es un evento `tool` con un resumen (`verb`, `target`, `detail`), sin la entrada completa.
- `POST /input` (`server/chat-send.ts`) escribe en la sesión de tmux con un cerrojo por sesión. Antes de pegar, `detectTuiWindow` (`server/tui.ts`) mira la pantalla con `capture-pane` y, si hay un menú o un diálogo, responde 409 `tui-busy`.
- Cuando la sesión está en `waiting`, el chat muestra el aviso «Claude espera tu respuesta en la terminal.» con el mensaje del hook.
- Comprobado en Claude Code 2.1.325, con una sesión real en tmux:
  - El `tool_use` de `AskUserQuestion` llega a la transcripción en cuanto Claude lo lanza, con `questions[]` (`question`, `header`, `multiSelect`, `options[]` con `label` y `description`). Al contestar, la línea del `tool_result` trae `toolUseResult.answers`, un objeto `{ pregunta: "respuesta" }`. En la selección múltiple, las respuestas van unidas por «, » y el texto libre se añade tal cual.
  - El menú pinta una fila de pestañas (`←  ☐ Color  ☐ Frutas  ✔ Submit  →`, con `☒` en las contestadas), la pregunta, las opciones numeradas con su descripción, «N. Type something.», un separador, «N+1. Chat about this» y el pie `Enter to select · Tab/Arrow keys to navigate · Esc to cancel`.
  - En la selección simple, pulsar el número elige la opción y pasa a la pestaña siguiente. En la múltiple, el número marca o desmarca (`[✔]`) sin moverse, y debajo de «Type something» hay una fila «Submit».
  - El texto libre solo se escribe con el cursor sobre «Type something»: se llega con flechas y el texto se teclea en la misma fila. Si no, el texto tecleado se pierde.
  - Con varias preguntas, al final sale «Review your answers», la lista de respuestas y «Ready to submit your answers?» con `1. Submit answers` y `2. Cancel`.

## Goals / Non-Goals

**Goals:**

- Contestar desde el chat sin que una respuesta pueda ir a parar a otro sitio de la TUI.

**Non-Goals:**

- «Chat about this», cancelar la pregunta con Esc y los menús de comandos (`/model`, `/resume`…): siguen en la terminal.
- Preguntas de Codex.
- Texto libre de varias líneas: la fila de «Type something» es de una línea, así que los saltos de línea se cambian por espacios y el chat lo indica.

## Decisions

### Origen de las preguntas y los permisos: hooks de Claude

La QA con Claude real (2.1.325) desmintió una premisa inicial: la línea `assistant` con el `tool_use` de `AskUserQuestion` (o de la herramienta que pide permiso) casi nunca llega a la transcripción hasta que se contesta (9 de 11 preguntas). Su `timestamp` es de cuando Claude la lanzó, no de cuando se escribió. Además, el aviso del hook ya no nombra la herramienta («Claude needs your permission»). Por eso la pregunta y el permiso pendientes salen de hooks:

- `bin/session-state` atiende dos eventos más, que `bin/agent` instala en las sesiones del panel:
  - `PreToolUse` con matcher `AskUserQuestion`: trae `tool_use_id` y `tool_input.questions` completos en el momento de lanzarla;
  - `PermissionRequest`: trae `tool_name` y `tool_input` (comando, archivo, URL…), sin id. Una `AskUserQuestion` también dispara un `PermissionRequest`: se ignora, porque la pregunta ya la registró `PreToolUse`.
- Guarda el evento tal cual (JSON del hook, con tope de tamaño y escritura atómica) en `jdev-ai/prompts/<session_id>.json`, junto al directorio de estados y no dentro de él, para no confundirlo con un estado. Lo borra con `PostToolUse`, `UserPromptSubmit`, `Stop` y `SessionEnd`. El shell no interpreta el JSON anidado: lo valida y lo lee el servidor.
- El servidor (`states.ts` o un lector propio) lo asocia a la sesión y lo valida (forma, topes, `session_id` igual que el del estado). Con él:
  - la pregunta pendiente es la del hook, aunque la transcripción no la traiga aún; cuando llega el `result` a la transcripción, la tarjeta pasa a respondida como antes. En la conversación, la tarjeta pendiente se pinta al final mientras la línea no llegue, y en su sitio cuando llegue;
  - el permiso pendiente lleva la herramienta y su entrada, resumidas con `describeTool`.
- Las sesiones abiertas antes de este cambio no tienen esos hooks: siguen con la transcripción y la pantalla (lo de antes) y, si no casan, con el aviso de la terminal.
- Las opciones de un permiso siguen saliendo de la pantalla (`tui.ts`), tal como las pinta la TUI, para no inventar opciones que cambian según la herramienta.
- `GET /api/sessions/:nombre/prompt` devuelve lo que hay abierto en la terminal (`question` con las preguntas y la pestaña activa, `permission` con la herramienta, su entrada y sus opciones, `other` o nada). El cliente solo lo consulta mientras la sesión está en `waiting`.
- La pantalla sigue mandando: el panel solo contesta si lo que ve la terminal casa con lo del hook.
- **Alternativa descartada:** leer las preguntas de la pantalla. Los textos llegan recortados al ancho de la terminal y, en un permiso, el comando puede no verse entero.

### Contestar: `POST /api/sessions/:nombre/answer`

- Cuerpo: `{ kind: 'question', id, answers: [{ options: number[], text?: string }] }`, con una entrada por pregunta y en su orden, o `{ kind: 'permission', id, option: number, label: string }`.
- Usa el cerrojo por sesión de `chat-send.ts`. Solo sesiones `jdev-*` de Claude, y la pregunta o el permiso tienen que seguir pendientes (según el hook o la transcripción).
- **Preguntas:**
  1. Antes de pulsar nada, comprueba que la pantalla muestra el menú de preguntas con las mismas cabeceras en la fila de pestañas y la primera pregunta sin contestar.
  2. En cada pregunta, comprueba que su texto está en pantalla.
     - Selección simple: pulsa el número de la opción.
     - Selección múltiple: pulsa el número de cada opción y comprueba que queda `[✔]`.
     - Texto libre: baja con flechas hasta «Type something», teclea con `send-keys -l` y comprueba que la fila muestra el texto.
     - Después, avanza: con Enter en la selección simple con texto libre, y en la múltiple bajando a «Submit» y Enter.
  3. Con varias preguntas, comprueba que la pantalla de revisión lista las respuestas esperadas y pulsa `1`.
  4. Espera a que el menú desaparezca de la pantalla.
- **Permisos:** comprueba que el diálogo sigue abierto y que la opción con ese número tiene la etiqueta enviada, y pulsa su número.
- Tras cada pulsación, `capture-pane` hasta ver el cambio esperado, con un tope corto. Si no aparece o la pantalla muestra otra cosa, se para, responde 409 `tui-mismatch` y no pulsa Esc ni nada para deshacer: la persona termina en la terminal, que es donde está la verdad.
- La respuesta se da por enviada cuando el menú desaparece. La tarjeta pasa a respondida cuando llega el `result` a la transcripción, igual que si se hubiera contestado en la terminal.
- **Alternativa descartada:** navegar solo con flechas y Enter. Los números eligen sin depender de dónde esté el cursor, y son menos pulsaciones que comprobar.

### Cliente

- La tarjeta de pregunta se pinta en el lugar del `tool_use` dentro de la conversación, no como un grupo de herramientas. Pendiente, es interactiva. Respondida, muestra lo elegido y se puede buscar.
- El botón de enviar se activa cuando todas las preguntas tienen respuesta. Con `tui-mismatch`, la tarjeta sigue pendiente y aparece el aviso actual con el enlace a la terminal y un texto que explica que puede haber quedado a medias.
- El aviso de espera actual solo sale si `prompt` no es `question` ni `permission`.
- Textos de la transcripción como texto plano, nunca como HTML. Las descripciones de las opciones también.

### Diseño

- Diseño aprobado en Claude Design: https://claude.ai/artifact/RqmQFG2dYrJ4XgPst8b3o5 (tarjeta de pregunta, tarjeta de permiso y sus estados: pendiente, enviando, respondida y no se pudo, en escritorio y en el layout estrecho).

## Risks / Trade-offs

- **[Textos y teclas de la TUI de Claude Code 2.1.325]** → Cada paso se comprueba en pantalla, y ante la duda no se pulsa nada y se vuelve al aviso actual. Las pruebas usan capturas reales como fixtures, y la versión probada queda anotada en `tui.ts`.
- **[Respuesta a medias si falla un paso intermedio]** → El panel se para y lo dice. No intenta deshacer, porque Esc cancelaría la pregunta entera.
- **[Contestar a la vez en la terminal y en el chat]** → El cerrojo ordena los envíos del panel, y la comprobación de pantalla detecta que el menú ya no está o ha cambiado de pestaña.
- **[Pantalla estrecha que parte las opciones en varias líneas]** → La comprobación busca el número y el inicio de la etiqueta, no la línea entera. La fila de pestañas puede recortar cabeceras: se compara solo lo visible.
- **[Permiso de una herramienta lanzada en paralelo con otras del mismo nombre]** → Se elige el último `tool_use` pendiente de ese nombre. Si hay más de uno, el chat muestra solo la herramienta y las opciones, sin el detalle.

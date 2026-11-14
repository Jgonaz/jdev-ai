## Why

Cuando Claude pregunta algo con `AskUserQuestion` o pide permiso para usar una herramienta, la vista chat solo avisa de que espera en la terminal y obliga a cambiar de vista para contestar. Es justo el momento en que la persona necesita leer con calma las opciones y sus descripciones, y la terminal es el peor sitio para hacerlo. La transcripción ya trae la pregunta completa en cuanto Claude la lanza, y el panel ya sabe escribir en la sesión y leer su pantalla, así que puede ofrecer la respuesta dentro del chat.

## What Changes

- **Preguntas de Claude en el chat:** mientras haya un `AskUserQuestion` sin respuesta, la vista chat muestra una tarjeta con cada pregunta, su cabecera y sus opciones con descripción.
  - Selección simple, selección múltiple y texto libre («Otra respuesta»), también con varias preguntas a la vez.
  - Al enviar, el panel contesta en la terminal pulsando las teclas del menú y comprueba en la pantalla cada paso. Si lo que ve no coincide con lo esperado, no pulsa nada más y avisa con el enlace a la terminal.
  - Al contestar, la tarjeta queda en la conversación como respondida, con lo elegido.
  - «Chat about this» no se ofrece en el chat: se puede seguir haciendo desde la terminal.
- **Permisos de herramienta en el chat:** mientras Claude espere un permiso, el chat muestra qué herramienta quiere usar y con qué (comando, archivo o URL) y las opciones que ofrece la terminal, leídas de su pantalla. Elegir una la pulsa en la terminal con las mismas comprobaciones.
- **Aviso de espera actual:** se mantiene para lo que el chat no sabe contestar (menús de comandos como `/model`, diálogos desconocidos o cuando falla la comprobación de pantalla).
- Si la persona contesta desde la terminal, la tarjeta del chat se actualiza sola.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: la vista chat de una terminal permite contestar a las preguntas y a los permisos de Claude, en lugar de solo avisar.

## Impact

- **Servidor del panel:**
  - el parser de conversación expone las preguntas de `AskUserQuestion` y su respuesta, y las herramientas pendientes de permiso;
  - lectura de la pantalla (`server/tui.ts`) para reconocer el menú de preguntas, su pestaña activa, la pantalla de revisión y el diálogo de permiso con sus opciones;
  - nuevo `POST /api/sessions/:nombre/answer`, con el mismo cerrojo por sesión que `POST /input`.
- **Hooks:** `bin/session-state` registra la pregunta y el permiso pendientes con `PreToolUse` (`AskUserQuestion`) y `PermissionRequest`, y `bin/agent` los instala en las sesiones del panel; la transcripción no los trae hasta que se contestan.
- **Cliente:** tarjeta de pregunta y de permiso en `ChatBody`, con sus estados (pendiente, enviando, respondida, no se pudo).
- **Diseño:** la tarjeta y sus estados se cierran antes en Claude Design.
- Sin dependencias nuevas. Fuera del panel solo cambian los hooks de `bin/session-state` y `bin/agent`.
- **Riesgo principal:** los textos y las teclas son de la TUI de Claude Code (2.1.325) y pueden cambiar entre versiones; ante la duda el panel no pulsa nada y vuelve al aviso actual.

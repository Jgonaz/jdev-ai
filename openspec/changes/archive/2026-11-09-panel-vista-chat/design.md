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
- Responder desde el chat a permisos o menús de la TUI: se responden en la terminal y el chat lo avisa.
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

### Comandos y `/btw`

- Los comandos que dejan rastro en la transcripción (`<command-name>`, con su `<local-command-stdout>`/`-stderr`) son eventos `command` y `command-output` en el modo conversación. La salida va sin ANSI y recortada, y el cliente la une al comando anterior. Los mensajes `isMeta` (instrucciones internas, avisos) no se muestran. Claude 2.1.319 escribe `/rename`, `/resume`, `/remote-control`, `/fork`, `/login` (y a veces `/goal`) como líneas `system` con `subtype: "local_command"` y el mismo contenido: se interpretan igual (solo en modo conversación y fuera de subagentes); el resto de `system` se ignora.
- Los mensajes largos de la persona (más de ~1000 caracteres) quedan en la transcripción envueltos en `<pasted_content id="…">…</pasted_content id="…">`: se quita el envoltorio solo cuando abre y cierra con el mismo id.
- `/btw` no escribe nada en la transcripción: Claude responde en una ventana superpuesta de la TUI. `POST /input` espera a que haya respuesta (sondeo de `capture-pane`, tope de 90 s), lee el texto visible de la ventana y cierra la ventana con Escape solo si su pie sigue visible. Si no responde a tiempo, devuelve `pending` sin pulsar nada.
- **Sin pulsar `c` (QA con Claude real):** `c` hace que Claude copie también con la herramienta nativa del sistema (en WSL, `clip.exe`), fuera de tmux y de cualquier filtro de OSC 52, y pisa el portapapeles de la persona (comprobado 2 de 2). Se descarta del todo: la respuesta se obtiene del texto visible con `capture-pane -p -J`. Si no cabe (el pie dice `↑/↓ to scroll`, pero con historial dice `⇧←/→ to browse` aunque haya scroll, así que no se fía del pie), se prueba a desplazar con Abajo (3 líneas por pulsación; Av Pág no hace nada, y Ctrl+D cierra la ventana), se captura cada pantalla, se quita la cabecera fija y los huecos de relleno, y se unen por solapamiento (el mayor sufijo del acumulado que coincide con el principio de la pantalla, sin contar huecos sueltos) hasta que dos pantallas seguidas no cambian. Hay un tope de pasos (200). `truncated` solo se marca si no se confirmó el final: tope de pasos, la ventana se cerró a medias o dos pantallas no solapan (se perdió un trozo). Una respuesta que cabe entera no es truncada. Los saltos de línea de la respuesta son los que pinta la ventana (Claude ajusta el texto al ancho de la terminal), así que un párrafo largo llega partido en líneas.
- La respuesta de `/btw` se pinta como texto preformateado (`<pre>` con `white-space: pre-wrap`, fuente de la interfaz, sin pasar por `marked`): la TUI ya la maqueta (títulos, listas, código con sangría) y Markdown le quitaría los saltos de línea. Se probó también con la fuente monoespaciada: alinea mejor el código pero los párrafos, que la TUI parte al ancho de la terminal, se leen peor.
- Con esto sobran el filtro de OSC 52 del flujo del pty (`server/osc52.ts`), el contador `suppressClipboard` y la lectura y borrado de buffers de tmux: se eliminan. El decodificador OSC 52 del cliente (`src/lib/osc52.ts`) se queda, porque la copia con el ratón en la terminal depende de él.
- Antes de pegar, `capture-pane` y un detector puro (`server/tui.ts`) buscan una ventana, un menú o un diálogo abiertos: con uno, 409 `tui-busy` y no se pega. Un cerrojo por sesión ordena los envíos.
- La respuesta de `/btw` vive solo en el cliente, en memoria y por sesión, anclada al punto de la conversación donde se envió; no persiste al recargar.

### Cliente

- `Pane` mantiene montado `TerminalBody` y lo oculta en la vista chat, para no reconectar el WebSocket ni perder el scroll.
- La vista elegida se guarda por pestaña en el estado del espacio de trabajo.
- La agrupación de herramientas y la búsqueda son funciones puras en `lib/chat.ts`. Al buscar, los grupos que contienen una coincidencia se despliegan.
- El texto del agente se pinta con `marked` y se sanea como en el resto del panel. El de la persona se pinta como texto plano.
- Cuando el estado de la sesión es `waiting`, aparece el aviso con el enlace a la terminal.
- El aviso de espera usa una frase propia en castellano («Claude espera tu respuesta en la terminal.») y enseña aparte, atenuado, el mensaje del hook: se traducen solo los patrones conocidos («needs your permission to use X») y el resto se cita tal cual. Se limita a la columna de 820 px de la caja de entrada.
- Rendimiento con transcripts enormes (QA: 14 MB, 21 000 elementos): la búsqueda espera 200 ms tras la última tecla y corre en una transición; el texto buscable se normaliza una vez por elemento (caché por identidad; con la búsqueda abierta se prepara en ratos libres); se cuentan todas las coincidencias pero solo se resaltan, con `<mark>`, las 2 000 más cercanas a la actual y solo en lo que está en pantalla o cerca (el contador avisa con «resalte parcial»); y solo se pintan los últimos 400 elementos, con «Mostrar anteriores» (y carga automática al acercarse) y un tramo alrededor de una coincidencia antigua al saltar a ella. Sin dependencias nuevas.
- Navegación por coincidencias (React #185 con ráfagas de Enter): `ir()` solo acumula el índice destino y un único `requestAnimationFrame` aplica el salto (coincidencia, ventana de render y fin del seguimiento en el mismo lote), así que varias pulsaciones entre dos fotogramas son un salto. Los `setState` de los efectos del salto son idempotentes (la ventana solo cambia si el destino queda fuera; `setSeguir` solo si se seguía el final) para no encadenar efectos pasivos, y el scroll del salto se marca como programático para que `onScroll` no toque la ventana. Verificado en Chromium con 18 000 elementos y 54 000 coincidencias, tandas de 400 Enter, con 0 a 20 ms entre pulsaciones.
- Accesibilidad: el log no es una región viva; una región `status` oculta anuncia de forma agrupada «Nueva respuesta de Claude» o «N mensajes nuevos» sin leer el texto, y la pastilla de mensajes nuevos es otra región `status`. El tooltip de «Chat» desactivado se cierra con Esc sin mover el foco, y su texto usa `--fg-faint` (≥ 4,5:1 en todos los temas).
- En un pane estrecho en vista chat, el chip de estado pasa a un punto de 8 px con el estado como nombre accesible, la caja de entrada empieza en una fila y la nota «Enter envía…» solo queda para lectores de pantalla.

### Diseño

- Diseño aprobado en Claude Design: https://claude.ai/artifact/7VPh22ob5eKMgbbm67N8wJ (paneles «Vista chat · escritorio», «Estados y conmutador» y «Layout estrecho»).

## Risks / Trade-offs

- **Transcripciones de varios MB:** se mantienen los topes por línea de `leerLineas` y la carga por trozos. Si el render se resiente, se virtualiza la lista.
- **Formato interno de Claude:** el JSONL puede cambiar. Se cubre con fixtures reales y se toleran los campos desconocidos.
- **Textos de la TUI de Claude (2.1.319):** los pies de las ventanas y su forma pueden cambiar. Ante la duda no se detecta nada (se envía como siempre) y `/btw` cae en el texto visible o en «pendiente».
- **Respuestas de `/btw` muy largas:** desplazar la ventana cuesta unas decenas de milisegundos por pantalla (hasta 200 pasos, unas 600 líneas); más allá se devuelve lo leído como `truncated`. Contenido periódico (líneas idénticas repetidas a intervalo igual al desplazamiento) puede hacer que el solapamiento elija un avance menor y pierda repeticiones.
- **Transcript anunciado pero sin crear:** el estado trae `transcript_path` antes de que Claude cree el archivo. `GET /conversation` responde `events: []`, `from: 0`, `more: false` (200) si el archivo no existe pero su ruta es válida (acaba en `.jsonl`, no existe ni como enlace roto y su primer directorio existente resuelto es el de proyectos de Claude o cuelga de él); el cliente enseña el estado vacío y empieza a mostrar mensajes en cuanto aparece. Una ruta que se sale de los proyectos o un enlace roto siguen dando 404.
- **Lo que solo existe en la TUI no aparece en el chat:** se mitiga con el aviso de espera y con el conmutador siempre a mano.
- **Sesiones retomadas:** hay que verificar que el estado apunta a la transcripción vigente.

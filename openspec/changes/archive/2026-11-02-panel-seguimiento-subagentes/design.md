## Context

- `panel-statusline` registra por hooks el inicio y fin de cada subagente (`agent_id`, `agent_type`) y las tareas en segundo plano del último `Stop` (`id`, `type`, `status`, `command`/`description`). El estado de cada sesión trae `transcript_path`.
- Claude Code 2.1.316 guarda cada subagente en `<dir del transcript>/<session_id>/subagents/agent-<agent_id>.jsonl`. Junto a él hay un `.meta.json` con `agentType`, `description` y `finished`. El transcript es JSONL con mensajes:
  - `user`: el encargo como texto y luego bloques `tool_result`, con `is_error`;
  - `assistant`: bloques `tool_use` (`name`, `input`), `text` y `thinking`;
  - otros tipos internos que se ignoran.
- La salida de una shell en segundo plano va a un archivo que Claude anuncia en el `tool_result` del Bash que la lanzó: `toolUseResult.backgroundTaskId` y el texto «Output is being written to: <ruta>». La ruta queda bajo `/tmp/claude-<uid>/…/tasks/<id>.output` y no se puede deducir con fiabilidad (lleva otro id de sesión).
- Diseño aprobado: `Seguimiento.dc.html` del canvas del panel.

## Goals / Non-Goals

**Goals:**

- Ver en directo qué hace cada subagente y cada shell en segundo plano de una sesión del panel.

**Non-Goals:**

- Parar, contestar o redirigir subagentes y shells.
- Subagentes de sesiones fuera del panel o de agentes que no sean Claude.
- Mostrar el razonamiento interno (`thinking`).

## Decisions

### Localizar los archivos

- **Subagente:** el servidor parte del `transcript_path` del estado de la sesión, que ya está validado dentro del directorio de proyectos de Claude. A partir de ahí construye `<dir>/<session_id>/subagents/agent-<agent_id>.{jsonl,meta.json}`:
  - El `agent_id` debe venir de la actividad de esa sesión y cumplir `^[a-z0-9]{1,64}$`.
  - Con `realpath`, la carpeta `subagents/` de la sesión debe seguir dentro del directorio de proyectos de Claude y el archivo (y su `.meta.json`), dentro de esa carpeta: un enlace a otro archivo de los proyectos no vale.
  - Antes de abrir se hace `lstat` y se exige un archivo regular; se abre con `O_NOFOLLOW | O_NONBLOCK` y se comprueba `isFile()` sobre el descriptor. Así una tubería (FIFO) o un dispositivo con ese nombre da 404 en vez de bloquear un hilo del servidor. Lo mismo vale para el transcript de la sesión, la salida de la shell, los `.wav` de Windows y el resto de lectores del panel que abren rutas que puede cambiar otro proceso.
- **Shell:** se busca en el transcript de la sesión el `tool_result` cuyo `toolUseResult.backgroundTaskId` sea el `id` de la tarea, y se extrae la ruta del texto con una expresión estricta. Solo se acepta si cumple todo esto:
  - la ruta real está bajo `/tmp/claude-<uid>/` (o `${TMPDIR}/claude-<uid>/`);
  - el nombre es `<id>.output`;
  - el archivo es del usuario.
  
  La búsqueda se cachea por `id`.
- Lo que no se encuentre o no pase las comprobaciones da 404, y la vista lo explica.

### Lectura incremental

- El cliente pide `GET /api/sessions/:name/follow/:kind/:id?from=<byte>` (`kind` = `agent` | `shell`).
- El servidor lee desde ese byte hasta un máximo de 256 KiB por respuesta (una sola línea mayor se lee entera hasta 2 MiB y, si es más grande, se salta) y devuelve:
  - los eventos ya interpretados (agente) o el texto (shell);
  - el nuevo `from`;
  - el estado (`running` | `finished`, de `.meta.json`, de la actividad o de la última lista de tareas);
  - los metadatos.
- Si el archivo encoge (rotación o reinicio), se empieza de nuevo.
- En la primera petición de una shell se leen solo los últimos 256 KiB, de los que se muestran las últimas 2 000 líneas.
- **Sondeo:** cada 1 s mientras la pestaña está visible y el elemento sigue en marcha, y cada 10 s si ya terminó (por si acaba de cerrar). Es más simple que vigilar archivos por WebSocket y el coste es bajo, porque solo se leen bytes nuevos.

### Interpretación de los eventos del subagente (servidor)

- **Encargo:** el primer `user` con texto.
- **Herramientas:** cada `tool_use` se convierte en un evento `{tool, verb, target, detail?}`, con el verbo según la herramienta:
  - Read: «Leo».
  - Grep y Glob: «Busco».
  - Edit, Write y MultiEdit: «Edito» o «Escribo», con +/− líneas cuando se pueden calcular.
  - Bash: «Ejecuto», con la primera línea del comando.
  - Agent: «Delego».
  - WebFetch: «Consulto».
  - Otras: su nombre.
  
  El `target` (ruta relativa al cwd del subagente, patrón o comando) se recorta a 200 caracteres.
- **Resultado:** se asocia por `tool_use_id`; se marca el error con `is_error` y se resume en la primera línea, hasta 200 caracteres. En un acierto, Read muestra «N líneas», Grep y Glob «N coincidencias», Edit y Write nada y el resto la primera línea de su salida.
- **Mensajes:** los `text` del asistente y el informe de `SubagentHandback`, la herramienta con la que los agentes del harness entregan su resultado, que no se muestra como herramienta. El servidor los envía hasta 20 000 caracteres; el cliente recorta a 4 000 todos menos el último, que, si el subagente terminó, es el resultado final y se muestra completo (con «…» solo si excede los 20 000).
- `thinking` y los tipos internos se ignoran. Las líneas que no son JSON válido se ignoran.

### Cliente

- `WorkspaceContext` admite pestañas de seguimiento con la clave `follow:<sesión>:<kind>:<id>`. No son sesiones de tmux: no cuentan en «En segundo plano» ni en los avisos, y se recuerdan como el resto de pestañas, aunque al reabrir el panel se descartan si ya no existen.
- Pulsar un subagente o una shell en el desplegable del chip abre su pestaña, o la activa si ya está abierta. En columna estrecha se abre igual.
- **Vista:** sigue `Seguimiento.dc.html` con los tokens del tema.
  - El texto de los mensajes se pinta como texto, nunca como HTML.
  - La salida de la shell se muestra como texto plano: se quitan las secuencias ANSI (CSI, OSC, cadenas DCS y escapes cortos como la designación de juegos de caracteres `ESC ( B`), sin interpretar colores en esta versión.
- «Seguir al final» se decide por la posición en cada evento de scroll: cualquier scroll que no acabe abajo lo desactiva (rueda, arrastre de la barra, táctil, teclado, `scrollTo`), salvo el que hace la propia vista al seguir el final; se reactiva al marcarlo o al volver abajo. Solo baja cuando el contenido crece, y expandir el «Encargo» lo desactiva.
- Sin datos (404): la pestaña muestra «Sin datos» y la razón una sola vez, y reintenta con espera creciente (10 s, 30 s y luego 60 s) en vez de cada 10 s.
- Cuando el subagente o la shell terminan, la pestaña sigue abierta con el estado «Terminado» y la hora. Si es un subagente, se destaca su resultado final.

## Risks / Trade-offs

- **[Formato interno de Claude]** → Lectura defensiva, eventos desconocidos ignorados y pruebas con muestras reales. Si falla, la vista lo indica.
- **[Datos sensibles en pantalla]** → Solo se sirven archivos del usuario, dentro de las carpetas de Claude, de sesiones del panel y por la API autenticada.
- **[Transcripts grandes]** → Lectura incremental con límite por respuesta. El cliente conserva como máximo 2 000 eventos o líneas.

## Migration Plan

Nada que migrar. Las sesiones anteriores al cambio también funcionan si tienen actividad registrada.

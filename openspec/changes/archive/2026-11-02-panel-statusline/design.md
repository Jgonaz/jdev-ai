## Context

- `bin/agent` ya inyecta hooks de Claude con `--settings` (`bin/session-state`, título, subagentes) y exporta `JDEV_SURFACE` (`panel` en las sesiones que crea el panel).
- `bin/session-state` deja `sessions/<session_id>.json` con el estado y `tmux_session`; el servidor (`sessions.ts`) lo asocia a la sesión de tmux y avisa por `/ws/events`.
- Claude Code pasa a la `statusLine` un JSON por stdin con `model`, `effort`, `context_window`, `rate_limits`, `workspace` (incluido `git_worktree`), `worktree` y otros. No incluye subagentes ni tareas en segundo plano.
- Los hooks `SubagentStart`/`SubagentStop` avisan del inicio y fin de cada subagente; el hook `Stop` incluye `background_tasks` (tareas en marcha: shells `local_bash`, agentes, monitores, workflows); `PostToolUse` de la herramienta `Artifact` trae el enlace publicado.
- Diseño aprobado: `Statusline.dc.html` y `StatuslineEstados.dc.html` en https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU.

## Goals / Non-Goals

**Goals:**

- Ver en la cabecera de cada terminal el contexto, el modelo y el esfuerzo, la rama o el worktree, el tiempo y el trabajo en curso.
- Ver en cualquier pantalla los límites de 5 h y 7 días y el agente por defecto.
- No repetir esos datos dentro de la terminal del panel.

**Non-Goals:**

- Coste, líneas cambiadas, caché de prompts u otros campos de la statusline.
- Tocar la statusline de la persona fuera del panel o su configuración de Claude.
- Datos equivalentes para Codex u otros agentes.
- Detener subagentes o shells desde el panel.

## Decisions

### Statusline del panel: `bin/session-statusline`

- Script POSIX sh. Lee el JSON de stdin, valida `session_id` (`[A-Za-z0-9-]`, como `session-state`), rechaza entradas de más de 64 KiB y lo guarda tal cual, con escritura atómica (temporal + `mv`), en `statusline/<session_id>.json`. No imprime nada, así que Claude no dibuja statusline.
- Guardar en bruto evita interpretar JSON en sh. El servidor lo lee con `JSON.parse` y se queda solo con los campos que usa.
- `bin/agent` lo añade como `statusLine` en el `--settings` solo con `JDEV_SURFACE=panel`. En una terminal normal no se inyecta nada y sigue la statusline de la persona.
- Alternativa descartada: envolver la statusline de la persona y filtrar su salida. Obligaría a leer su configuración y a interpretar texto con colores.

### Actividad: `bin/session-activity`

- Hook de `SubagentStart`, `SubagentStop`, `Stop` y `PostToolUse` con `matcher` `Artifact`. Añade el evento recibido como una línea a `activity/<session_id>.jsonl` (con `printf >>`, sin reescribir), con permisos 0600 como el estado y la statusline (`umask 077` y `chmod 600`, que corrige también un registro anterior más abierto). Si el archivo pasa de 256 KiB, lo vacía antes de añadir. El estado se reconstruye en el siguiente evento, salvo los artifacts antiguos, una pérdida aceptable.
- El servidor lo interpreta:
  - **Subagentes activos:** los `SubagentStart` sin su `SubagentStop` (por `agent_id`), con `agent_type` y la hora de inicio. Un `SessionStart` (estado `idle` tras reanudar) o el fin de la sesión los vacía.
  - **Shells:** las tareas `local_bash` y `monitor_*` del último `Stop` con estado en marcha, con su comando o descripción. Se actualizan al acabar cada turno, no a mitad (límite de lo que publica Claude).
  - **Artifacts:** las URL `https://claude.ai/…artifact/…` de las respuestas de `PostToolUse` de `Artifact`, sin repetir, con su título si viene.
- Como el resto de hooks, nunca interrumpe al agente: ante cualquier error termina con código 0 y sin salida.

### Servidor

- Vigila `statusline/` y `activity/` como ya hace con `sessions/`, con debounce. Junta los datos con cada sesión por `session_id`, a través del archivo de estado (`tmux_session`).
- La sesión publicada por `/ws/events` gana un campo `usage` opcional: `{model, effort, context: {used, size, percent}, worktree, updatedAt}`. También gana `activity`: `{subagents: [{type, since}], shells: [{label, since?}], artifacts: [{url, title?}]}`.
- `GET /api/account` y el evento `account` devuelven los límites `{fiveHour, sevenDay}` (`percent`, `resetsAt`) de la statusline más reciente de cualquier sesión de Claude del panel, con su `updatedAt`.
- Rutas: los archivos se leen solo dentro del directorio de estado, con nombre validado y `O_NOFOLLOW`. Se ignoran los que no son JSON válido o pasan del tamaño máximo.
- El tiempo de sesión sale de `@jdev_created` (ya disponible para todos los agentes).

### Cliente

- Cabecera de la terminal según `Statusline.dc.html`:
  - La segunda fila nunca se parte: la barra de contexto va justo detrás de los datos; si no cabe, se recortan los datos antes que la barra.
  - Los chips de trabajo en curso son botones de esquinas de 6 px con un desplegable accesible (Esc, foco y clic fuera).
- Umbrales del contexto y de los límites: menos del 50 % neutro, desde el 50 % ámbar y desde el 80 % rojo con icono y texto (no solo color). El nivel se decide con el mismo valor que se muestra, ya redondeado: con 49,6 % se ve «50 %» y es ámbar; con 79,6 %, «80 %» y rojo con icono. Lo comparten la barra de contexto, el tooltip de la barra lateral y los límites.
- **Contraste:** el texto pequeño cumple 4,5:1 en los cuatro temas. El rojo del texto usa `--danger-text` (igual que `--danger`, salvo en Papel, más oscuro). Los datos desactualizados no bajan la opacidad del texto: pasan al color atenuado (`--fg-muted`) y se aclara solo la barra.
- **Datos desactualizados:** si la statusline lleva más de 15 min sin cambiar y la sesión no trabaja, se atenúa (texto en `--fg-muted` y barra más clara) y muestra «hace N min».
- **Columna estrecha** (cuadrícula de 4 o ancho menor de ~520 px): se ocultan el proyecto, el tiempo y los tokens, y el trabajo en curso pasa a contadores junto al título.
- **Cabecera global:**
  - El botón del agente por defecto abre un menú con los agentes y guarda `newSession.agent` con la API de ajustes existente.
  - El botón de límites muestra las dos minibarras y, al pulsarlo, las horas de reinicio y la antigüedad del dato.
  - **Anchos estrechos:** por debajo de 1280 px los límites van compactos, «5 h 3 %  7 d 22 %», sin minibarras; por debajo de 1024 px el botón del agente muestra solo el icono (con `aria-label` y `title` con el nombre) y «Nueva sesión» solo el «+» (con `aria-label`). La cabecera no provoca desplazamiento horizontal del documento a 700 px.
- El desplegable de subagentes no parte el tipo («general-purpose»): no se rompe en líneas y, si no cabe, lleva puntos suspensivos y `title`.
  - Si no hay datos de límites (ninguna sesión de Claude del panel aún), no se muestra.

## Risks / Trade-offs

- **[El formato del JSON de la statusline o de los hooks cambia]** → El servidor lee cada campo de forma opcional y omite lo que falte. Las pruebas usan muestras reales.
- **[Shells desactualizadas a mitad de turno]** → Se aceptan: solo se actualizan en `Stop`. Se documenta.
- **[`--settings` con `statusLine` sustituye a la de la persona en el panel]** → Es lo pedido. Fuera del panel no se inyecta.
- **[Archivos que crecen]** → Tamaño máximo por archivo y vaciado del registro de actividad. El servidor borra los de sesiones terminadas cuando borra su estado.
- **[Límites de otra cuenta o de una sesión fuera del panel]** → Solo se usan sesiones del panel. El dato muestra su antigüedad.

## Migration Plan

Las sesiones abiertas antes del cambio no tienen statusline ni actividad. Muestran la cabecera sin esos datos, como Codex, hasta que se retoman.

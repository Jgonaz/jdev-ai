## Context

- **Claude Code** guarda cada conversación en `<CLAUDE_CONFIG_DIR o ~/.claude>/projects/<slug>/<id>.jsonl` y sus subagentes en `<id>/subagents/agent-<id>.jsonl`.
  - Cada respuesta del asistente lleva `message.model`, `message.id`, `timestamp`, `cwd` y `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
  - Las herramientas aparecen como bloques `tool_use` (`name`; los subagentes, `name: "Agent"` con `input.subagent_type`).
  - Una misma respuesta puede repetir su uso en varias líneas (mismo `message.id`), así que hay que contarla una vez.
  - Volumen real: ~1,2 GB y ~30 000 respuestas en 27 días.
- **Codex** guarda sus sesiones en `<CODEX_HOME o ~/.codex>/sessions/AAAA/MM/DD/rollout-*.jsonl`, con eventos `event_msg` de tipo `token_count` (`info.last_token_usage`: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`), además de `session_meta` (`cwd`) y `turn_context` (`model`).
- **El panel** ya conoce los proyectos y sus rutas (`server/projects.ts`) y tiene un patrón de apertura segura (`server/safefile.ts`).
- **Diseño aprobado:** `Actividad.dc.html` del canvas.

## Goals / Non-Goals

**Goals:**

- Ver la actividad de la semana (o de 30 días, o de todo) al abrir Inicio, rápido y con cifras correctas, sin duplicados.

**Non-Goals:**

- Coste en dinero.
- Cursor y otros agentes.
- Exportar o compartir las estadísticas.
- Gráficos de otras pantallas.

## Decisions

### Indexado incremental

- El servidor recorre los transcripts de Claude y las sesiones de Codex y guarda, **por archivo**, `{tamaño, mtime, offset leído, agregados}` en `activity-index.json` dentro de la caché del panel (escritura atómica y versión de formato; si cambia la versión o el archivo está corrupto, se reconstruye).
- **Lectura incremental:**
  - un archivo que crece se lee desde su último offset completo, por líneas y por trozos;
  - uno que encoge o cambia de identidad se relee entero;
  - uno que desaparece sale del índice.
- **Agregados por archivo**, por día local y por clave:
  - respuestas;
  - tokens de entrada, salida, caché leída y caché escrita;
  - modelo;
  - proyecto, resuelto por el `cwd` contra las rutas de los proyectos del panel y sus worktrees; si no encaja, «Otros»;
  - recuentos de herramientas y de subagentes por tipo;
  - minutos activos.
  
  Los ids de mensaje ya contados se guardan por archivo para deduplicar dentro del archivo.
- **Deduplicación global:** el mismo `message.id` aparece en varios transcripts (sesiones retomadas, copias, subagentes; se midieron 1 376 casos reales). Se cuenta una vez con un registro global de ids; gana el archivo más antiguo. Si una repetición trae más `output_tokens`, solo se suma el incremento.
- **Horas activas:** se agrupan en intervalos las respuestas separadas por 5 minutos o menos (un hueco mayor se cuenta como 5 minutos). La cifra es la **unión** de esos intervalos de todas las sesiones, no su suma, para no duplicar el tiempo de los subagentes y de las sesiones en paralelo. Es una aproximación; el tooltip de la cifra lo explica.
- **Sesión:**
  - en Claude, cada conversación principal (los subagentes suman tokens, respuestas y herramientas, pero no sesiones);
  - en Codex, cada sesión principal: las de `thread_source` subagente o revisión suman tokens y respuestas, pero no sesiones.
- **Proyecto:** el `cwd` se guarda en la caché y se resuelve al consultar, así que cambiar la lista de proyectos no obliga a reindexar. Los worktrees de `<id>.worktrees/` cuentan para `<id>` aunque ya no existan.
- **Cuándo se indexa:**
  - al arrancar, en segundo plano y sin bloquear el panel;
  - después, cada 5 minutos y al pedir `/api/activity` si han pasado más de 60 s desde la última pasada.
  
  Una sola pasada a la vez. La primera puede tardar; mientras tanto la API responde `{indexing: true, ...}` con lo que haya y la sección muestra «Calculando…».
- **Seguridad:**
  - solo se leen archivos regulares del usuario bajo las dos raíces, con apertura segura (sin enlaces ni FIFO);
  - líneas de más de 2 MiB se saltan;
  - lo que no es JSON se ignora.

### API

`GET /api/activity?range=week|30d|all&agent=all|claude|codex` devuelve:

- `totals` del periodo y del periodo anterior equivalente: la semana en curso, de lunes a hoy, frente al mismo tramo de la semana anterior; los 30 días frente a los 30 previos; en «todo» no hay comparación;
- `days` (últimas 12 semanas) con respuestas por día;
- `streak` y `bestDay`;
- `byProject` (top 5 por tokens de salida y el resto agregado);
- `byModel`: por familia (Opus, Sonnet, Haiku y Codex) y «Otros». Cada familia se etiqueta con su versión más usada y el tooltip da el desglose. Las respuestas `<synthetic>` se ignoran;
- `agents` (top 5 subagentes);
- `tools` (top 5);
- `updatedAt` e `indexing`.

Autenticada y de solo lectura, como el resto.

### Cliente

- Sección de Inicio según el diseño, con los tokens del tema.
- **Colores:**
  - magnitudes (calendario y barras) en un solo tono, con una rampa secuencial derivada del acento de cada tema y validada;
  - modelos con cuatro colores categóricos fijos por modelo (el color sigue al modelo, no a su puesto), validados para daltonismo en cada tema;
  - cada modelo lleva además su nombre y porcentaje, así que no depende solo del color.
- **Tooltips** al pasar el ratón o con el foco en celdas del calendario, barras y segmentos. Vista en tabla del calendario.
- Los filtros se recuerdan en el navegador.
- La sección se puede ocultar desde Ajustes (Inicio › «Mostrar tu actividad», activado por defecto).

## Risks / Trade-offs

- **[Primera indexación lenta]** → En segundo plano, con progreso y sin bloquear. Las siguientes son incrementales.
- **[Formatos internos de Claude y Codex cambian]** → Lectura defensiva y pruebas con muestras reales anonimizadas. Lo desconocido se ignora.
- **[Cifras aproximadas]** (horas activas, proyecto por `cwd`) → Se explican en el tooltip.
- **[Tamaño de la caché]** → Agregados por día, no eventos. Los ids de deduplicación se guardan solo por archivo.

## Migration Plan

Nada que migrar. La caché se crea sola y se puede borrar sin perder nada.

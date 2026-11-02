## Why

Los datos útiles de una sesión de Claude (contexto usado, modelo y esfuerzo, rama o worktree, límites de la cuenta) solo se ven en la statusline, una línea de texto dentro de la terminal que el panel no puede leer. Tampoco se ve qué trabajo sigue en marcha (subagentes, shells en segundo plano, artifacts publicados). La persona quiere verlo de forma visual en el panel y que la terminal del panel deje de repetirlo.

## What Changes

Según el diseño aprobado (artboards «Estado de la sesión — cabecera de la terminal» y «Estado de la sesión — contexto, trabajo en curso, Codex, estrecho y límites» de https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU):

- **Cabecera de cada terminal** en tres filas:
  1. El título, con el estado y «⋯» a la derecha.
  2. Una sola línea con el proyecto, la rama o el worktree, el modelo y el esfuerzo, el tiempo de sesión y, a continuación, la barra de contexto con porcentaje y tokens. Neutra por debajo del 50 %, ámbar desde el 50 % y roja con icono desde el 80 %.
  3. Solo si hay trabajo en curso: chips de subagentes activos, shells en segundo plano y artifacts publicados, que despliegan el detalle.
- **Cabecera global**: el agente por defecto de las sesiones nuevas («Claude Code»), con un menú para cambiarlo, y los límites de 5 h y 7 días como dos minibarras con su hora de reinicio al pulsarlas.
- **Sin statusline de Claude en las sesiones del panel**: sus datos ya están en la cabecera. En una terminal normal la statusline de la persona no cambia.
- **Datos nuevos del harness**, solo en las sesiones del panel:
  - `bin/agent` instala como `statusLine` un script del harness que guarda el JSON que le pasa Claude y no imprime nada.
  - Un hook registra el inicio y el fin de los subagentes, las tareas en segundo plano al acabar cada turno y los artifacts publicados.
- Las sesiones de otros agentes (Codex…) muestran solo proyecto, rama y tiempo.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade el estado de la sesión en la cabecera de la terminal, el agente por defecto y los límites de la cuenta en la cabecera global, y la statusline del panel.

## Impact

- Harness: dos scripts nuevos en `bin/` (statusline y actividad), `bin/agent` los inyecta con `--settings` solo cuando `JDEV_SURFACE=panel`; `bin/check` los prueba.
- Estado local nuevo en `${XDG_STATE_HOME:-~/.local/state}/jdev-ai/` (`statusline/<id>.json` y `activity/<id>.jsonl`), fuera de los proyectos.
- Panel: el servidor lee esos archivos, los asocia a la sesión de tmux por el `session_id` del estado de los hooks y los envía por `/ws/events`; cliente con la nueva cabecera de terminal, el botón de agente y los límites.
- Sin dependencias nuevas. Los scripts siguen siendo POSIX sh sin `jq`: guardan el JSON en bruto y lo interpreta el servidor.
- El coste deja de verse en las sesiones del panel (decisión de la persona).

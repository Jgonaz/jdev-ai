## Why

La persona quiere ver al empezar cuánto y cómo ha trabajado con sus agentes:
- tokens, sesiones, respuestas y horas activas;
- en qué proyectos y con qué modelos;
- qué subagentes y herramientas ha usado.

Claude Code y Codex ya guardan esos datos en local, pero hoy solo se pueden consultar a mano.

## What Changes

Según el diseño aprobado (artboard «Inicio — tu actividad (estadísticas)» de https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU):

- **Sección «› tu actividad» en Inicio**, entre «Necesita tu atención» y «Proyectos»:
  - Filtros de periodo (esta semana, 30 días, todo) y de agente (todos, Claude, Codex).
  - Cuatro cifras con su comparación con el periodo anterior:
    - tokens de salida, con el desglose de entrada, caché leída y caché escrita;
    - sesiones, por agente;
    - respuestas, con la media por sesión;
    - horas activas, con los días activos.
  - Calendario de respuestas por día de las últimas 12 semanas, con la racha de días seguidos, el mejor día y una vista en tabla.
  - Tokens de salida por proyecto, como barras con su valor.
  - Reparto de respuestas por modelo, con leyenda y porcentajes; los modelos que no caben se agrupan en «Otros».
  - Subagentes lanzados y herramientas más usadas.
  - Detalle exacto al pasar el ratón o al llegar con el foco.
- **Fuentes de datos**: los transcripts de Claude Code (`~/.claude/projects`, incluidos los de subagentes) y las sesiones de Codex (`~/.codex/sessions`), de solo lectura. Lo que se lee se resume en una caché local para no releer gigas en cada visita.
- **Sin coste en dinero** en esta versión.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade la sección de actividad a Inicio.

## Impact

- **Servidor:** un indexador incremental de transcripts con caché en `${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/`, una ruta `GET /api/activity?range=&agent=` y la lectura segura de archivos ajenos al harness.
- **Cliente:** la sección de Inicio con sus gráficos según el diseño, en los cuatro temas.
- **Sin dependencias nuevas** (gráficos en HTML/CSS/SVG propios).
- **Privacidad:** todo se calcula y se queda en el equipo.

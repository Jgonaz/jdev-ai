## Why

En las sesiones del panel, Claude va en modo clásico (para que el historial esté en tmux) y en ese modo no recibe clics. Por eso no se pueden abrir los subagentes ni las shells en segundo plano desde su barra inferior, como sí se hace en una terminal normal. La cabecera de la terminal dice qué subagentes y shells hay, pero no qué están haciendo.

## What Changes

Según el diseño aprobado (artboard «Seguimiento — subagente y shell en directo» de https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU):

- **Pestañas de seguimiento**, de solo lectura, que se abren desde los desplegables de los chips de subagentes y shells de la cabecera de la terminal. Van junto a las de terminal (icono de ojo), se cierran con «×» y funcionan en las distribuciones de 1, 2 y 4 columnas.
- **Subagente**:
  - **Cabecera:** su descripción, su estado («Trabajando · N min» o «Terminado»), su tipo, un enlace a la sesión que lo lanzó y el número de herramientas.
  - **Cuerpo, en directo:**
    - el encargo, plegable;
    - cada herramienta con el estilo de la terminal («Leo», «Busco», «Edito», «Ejecuto»…) y un resumen de su resultado, en rojo si falla;
    - los mensajes del subagente;
    - al terminar, su resultado final destacado.

    El razonamiento interno no se muestra.
- **Shell en segundo plano**: el comando, su estado, la sesión que la lanzó y las últimas 2 000 líneas de su salida en directo.
- **Pie**: «Seguir al final» y la antigüedad de la última actualización.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade las pestañas de seguimiento de subagentes y shells en segundo plano.

## Impact

- Servidor del panel:
  - lee, solo dentro del directorio de proyectos de Claude, el transcript y los metadatos de cada subagente (`<sesión>/subagents/agent-<id>.jsonl` y `.meta.json`);
  - lee la salida de las shells (`…/tasks/<id>.output`) en la ruta que Claude anunció en el transcript de la sesión, solo bajo el directorio temporal de Claude del usuario;
  - envía los cambios en directo por un WebSocket o con sondeo.
- Cliente: un tipo nuevo de pestaña en el espacio de trabajo, la vista de seguimiento y la apertura desde los chips.
- Depende de formatos internos de Claude Code, que pueden cambiar: se leen de forma defensiva y lo que no se entienda se muestra como texto.
- Sin dependencias nuevas. Sin cambios en el harness ni en los proyectos.

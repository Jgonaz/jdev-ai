## Why

El historial de iteraciones (`.agent/history/`) es la forma de retomar un proyecto días después, pero solo se ve entrando en cada carpeta o mediante el resumen de inicio, que muestra únicamente la última entrada. Los «Pendiente de ti» de entradas anteriores se pierden de vista. La pantalla Historial del panel, ya diseñada y aprobada, reúne y filtra todas las entradas y permite cerrar esos pendientes.

## What Changes

- Pantalla **Historial** del panel gráfico (hasta ahora «Próximamente»), según el diseño aprobado (artboard «Historial — lector de registros» de https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU):
  - **Lista** de entradas de todos los proyectos y del harness, agrupadas por día, con hora, proyecto, estado, título y su primer pendiente abierto.
  - **Filtros** por proyecto y estado, y «Solo con Pendiente de ti».
  - **Lector** de una entrada: «Pendiente de ti» destacado, resumen, decisiones, referencias y continuación recomendada.
  - **Retomar desde aquí:** abre Nueva sesión en el proyecto con un prompt para ponerse al día desde esa entrada y seguir su continuación.
  - **Marcar como hecho** (y desmarcar) cada punto de «Pendiente de ti», que se marca en el propio archivo.
- **Marca de pendiente resuelto:** un punto se marca como `- [x] <texto> (hecho YYYY-MM-DD)`. `bin/session-status` deja de mostrar los puntos marcados en el resumen de inicio y `rules/history.md` documenta la marca.
- Inicio sigue como «Próximamente».

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade la pantalla Historial con lista, filtros, lector, «Retomar desde aquí» y pendientes resolubles.

## Impact

- Panel: lectura y vigilancia de `.agent/history/*.md` del checkout principal de cada proyecto y del harness, endpoints de lista, detalle y marca de pendientes, y la pantalla Historial.
- Harness: `bin/session-status` omite los pendientes marcados, `rules/history.md` documenta la marca y `bin/check` lo prueba.
- Escritura: solo en las entradas de historial, que son locales e ignoradas por Git, al marcar o desmarcar un pendiente.
- Sin dependencias nuevas: reutiliza el visor de Markdown de Proyectos.

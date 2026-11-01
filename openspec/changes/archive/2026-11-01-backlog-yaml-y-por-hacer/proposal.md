## Why

Los elementos del backlog solo se pueden leer abriendo el Markdown completo y sus metadatos son una lista libre (`- ID:`, `- Estado:`…), difícil de leer de un vistazo y de procesar con herramientas como el futuro panel gráfico del harness. Además, `pending/` mezcla dos cosas distintas: ideas que la persona aún tiene que revisar y trabajo ya elegido para abordar pronto, lo que dificulta organizarse entre varios proyectos.

## What Changes

- **BREAKING**: los metadatos de cada elemento pasan a una cabecera YAML (front matter) con claves fijas (`id`, `title`, `type`, `status`, `priority`, `created`, `updated`, `refs`) en lugar de la lista Markdown actual.
- Cada elemento incluye, justo después del título, una sección `## Resumen`: un único párrafo en lenguaje llano para la persona, de como máximo unos 2 minutos de lectura. El contenido detallado (contexto, próximo paso, criterios de cierre) va después.
- **BREAKING**: el estado `pending` se divide en dos:
  - `backlog`: elementos por revisar antes de decidir si se abordan. Es el estado por defecto de todo elemento nuevo.
  - `todo` («por hacer»): elementos revisados y elegidos para abordarse pronto. Solo se llega aquí por decisión explícita de la persona.
- Las carpetas de estado pasan a ser `backlog/`, `todo/`, `in-progress/`, `done/` y `discarded/`. La carpeta sigue siendo la fuente de verdad y `status` debe coincidir con ella.
- Migración de los backlogs existentes de los proyectos (`balanz.io`, `fitnessia`, `SmashAdvisor`, `jgonaz-portfolio`) al nuevo formato y carpetas, cada uno en su propio repositorio.
- Actualización de la regla `rules/backlog.md`, de la puesta al día de `rules/history.md` y de los README que describen el backlog.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `project-backlog`: cambia los estados y carpetas (`pending` se divide en `backlog` y `todo`), el formato obligatorio de los elementos (cabecera YAML y resumen) y el estado inicial de los elementos nuevos.

## Impact

- Harness: `rules/backlog.md`, `rules/history.md` (puesta al día), `README.es.md`, `README.md` y la spec `openspec/specs/project-backlog/spec.md`.
- Proyectos: 42 elementos repartidos en cuatro repositorios se mueven de carpeta y se reescriben al nuevo formato. Son cambios en el Git de cada proyecto que quedan sin commit hasta que la persona lo autorice. En SmashAdvisor hay un elemento sin seguimiento en Git (`BL-20261003-1924-ordenar-historial-local.md`) que se migra igual y se conserva.
- Sin dependencias nuevas ni cambios en `bin/`. El futuro panel gráfico leerá este formato; no forma parte de este cambio.

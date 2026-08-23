## Why

Durante una sesión con un agente aparecen hallazgos, tareas y oportunidades que no conviene abordar en ese momento. Si solo quedan en la conversación, se pierden o se mezclan con el historial de la sesión; el harness necesita una bandeja de trabajo diferido, compartida y versionada por cada proyecto.

## What Changes

- Definir una capacidad de backlog documental por proyecto bajo `docs/backlog/`.
- Organizar los elementos mediante las carpetas `pending/`, `in-progress/`, `done/` y `discarded/`.
- Representar cada elemento como un archivo Markdown independiente con identificador, tipo (`finding`, `todo`, `fix`, `feature` u otros), estado, prioridad, fecha, contexto y siguiente paso.
- Permitir que una instrucción explícita como «apunta un finding» registre el elemento sin interrumpir ni ampliar la tarea actual.
- Permitir consultar, abordar, mover, resolver o descartar elementos posteriormente, conservando su identificador y trazabilidad.
- Documentar la diferencia entre este backlog, la memoria, el historial de iteraciones y OpenSpec.
- Actualizar las reglas y la documentación del harness para que la convención sea aplicable a todos los proyectos.
- Mantener fuera de alcance el launcher, las dependencias nuevas, la sincronización con gestores externos y la creación de carpetas en proyectos que todavía no utilicen el backlog.

## Capabilities

### New Capabilities

- `project-backlog`: registrar y gestionar trabajo futuro específico de un proyecto mediante documentos Markdown organizados por estado.

### Modified Capabilities

Ninguna.

## Impact

- Afecta a las reglas compartidas del harness, su README y el índice de reglas.
- Añade una convención documental que se materializa en el repositorio Git de cada proyecto, no en el Git del harness.
- No modifica APIs, código de aplicación, dependencias ni integraciones externas.

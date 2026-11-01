## Why

El backlog de cada proyecto ya tiene un formato legible por herramientas (cabecera YAML, resumen y estados `backlog`, `todo`, `in-progress`, `done`, `discarded`), pero para revisarlo hay que abrir carpetas y archivos proyecto a proyecto, o pedírselo a un agente. La pantalla Proyectos del panel, ya diseñada y aprobada, permite ver, priorizar y arrancar trabajo desde un solo sitio.

## What Changes

- Pantalla **Proyectos** del panel gráfico (hasta ahora «Próximamente»), según el diseño aprobado (artboard «Proyectos — backlog, por hacer y detalle» de https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU):
  - Lista de proyectos con su número de elementos abiertos.
  - **Backlog** en columnas por estado (backlog, por hacer, en curso; hecho y descartado plegados), con tipo, prioridad y fecha, filtros por tipo y prioridad y búsqueda.
  - **Detalle** de un elemento: propiedades de la cabecera, resumen destacado con tiempo de lectura, detalle plegable y vista de la fuente.
  - **Mover estado** desde el panel: «Pasar a por hacer» y «Mover a…», que mueven el archivo con `git mv` y actualizan `status` y `updated`. Los cambios quedan sin commit y el panel avisa de los cambios pendientes del backlog.
  - **Confirmar cambios**: commit solo de `docs/backlog/` con mensaje propuesto y editable y, si se marca, push de la rama; con hooks del proyecto y sin commits sin confirmación.
  - **Trabajar en esto**: abre Nueva sesión con el proyecto y un prompt para abordar el elemento.
  - Pestañas **Worktrees** (ramas abiertas, estado y acceso a su terminal) y **Guías** (lectura de `docs/user-guides/`).
- Elementos con el formato antiguo (sin cabecera YAML) se muestran marcados como tales, sin romper la vista.
- Inicio e Historial siguen como «Próximamente»: cambios posteriores.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade la pantalla Proyectos con backlog, detalle, cambio de estado, worktrees y guías.

## Impact

- Panel: módulos de servidor para leer el backlog, las guías y los worktrees, endpoints de lectura y de cambio de estado, vigilancia de `docs/backlog/` y la pantalla Proyectos en el cliente.
- Dependencias nuevas en `panel/`: `yaml` (cabecera YAML) y `marked` (solo su analizador, para pintar Markdown como componentes sin HTML crudo).
- Escritura en los repositorios de los proyectos: al mover estados (`git mv`, dos campos de la cabecera y `git add` del destino) y, solo tras confirmación explícita, commit de `docs/backlog/` y push opcional.
- Sin cambios en `bin/` ni en las reglas: el panel aplica las transiciones de `rules/backlog.md`.

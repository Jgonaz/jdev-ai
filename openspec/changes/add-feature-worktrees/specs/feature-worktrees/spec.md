## Purpose

Esta capacidad permite que varias sesiones de agentes trabajen a la vez sobre el mismo proyecto sin pisarse. El agente propone aislar los cambios grandes en un worktree con su propia rama y, desde la misma sesión, los implementa, los integra en la rama principal cuando el usuario lo confirma y limpia el worktree.

## ADDED Requirements

### Requirement: El agente propone aislar los cambios grandes y hace todo el ciclo en la misma sesión

Al recibir una tarea en el checkout principal, el agente SHALL valorar si es un cambio grande según los criterios de `workflows/feature.md`. Si lo es, SHALL proponer aislarlo, indicando el nombre de la feature, la rama y la rama base, y SHALL esperar la confirmación explícita antes de crear nada. Si el usuario acepta, la misma sesión SHALL crear el worktree con `bin/worktree create` y SHALL trabajar en él. En Claude Code, SHALL mover la sesión al worktree con `EnterWorktree`. En las CLIs sin esa herramienta, SHALL usar las rutas del worktree y SHALL comprobar antes de cada commit que el checkout principal no tiene cambios suyos. Para los cambios pequeños, el agente SHALL trabajar en el checkout principal sin proponer worktree, salvo que el usuario lo pida.

#### Scenario: Cambio grande aceptado en Claude Code

- **WHEN** el usuario pide una funcionalidad que afecta a varias partes del sistema y acepta aislarla
- **THEN** el agente crea el worktree, entra en él con `EnterWorktree` e implementa allí sin abrir otra terminal

#### Scenario: Cambio grande aceptado en Codex

- **WHEN** el usuario acepta aislar el cambio en una sesión de Codex
- **THEN** el agente crea el worktree y edita y ejecuta comandos solo con rutas del worktree, sin modificar el checkout principal

#### Scenario: Cambio pequeño

- **WHEN** el usuario pide corregir un texto
- **THEN** el agente trabaja en el checkout principal sin proponer worktree

#### Scenario: Propuesta rechazada

- **WHEN** el usuario rechaza el aislamiento
- **THEN** el agente trabaja en el checkout principal como hasta ahora

### Requirement: El launcher permite usar worktrees

En el checkout principal de un proyecto, `bin/agent` SHALL pasar a Codex `projects/<proyecto>.worktrees/` como directorio adicional y SHALL crearlo si no existe. No SHALL hacerlo con el harness. `bin/agent <proyecto> --wt <feature>` SHALL crear o reutilizar, mediante `bin/worktree create`, la rama `feat/<feature>` y el worktree `projects/<proyecto>.worktrees/<feature>/`, y SHALL lanzar el agente con ese worktree como directorio de trabajo. Para Claude y Codex, SHALL añadir como directorios adicionales solo el `.git` común y `.agent/history/` del checkout principal. `agent .` SHALL aceptar un worktree de un proyecto de `projects/`. `--wt` SHALL NOT admitirse sobre el harness. Sin `--wt`, el launcher SHALL comportarse como hasta ahora.

#### Scenario: Primera sesión de una feature

- **WHEN** se ejecuta `agent demo --wt login` y no existen ni la rama ni el worktree
- **THEN** se crean desde el `HEAD` del checkout principal, se muestra la rama base y el agente se abre en `projects/demo.worktrees/login/`

#### Scenario: Retomar una feature

- **WHEN** se ejecuta de nuevo `agent demo --wt login` o `agent .` dentro del worktree
- **THEN** el agente se abre en el worktree existente sin crear ramas ni modificar el checkout principal

#### Scenario: Directorios adicionales acotados

- **WHEN** se ejecuta `agent demo --wt login --codex`
- **THEN** Codex recibe como directorios adicionales el `.git` común y `projects/demo/.agent/history`, pero no `projects/demo`

#### Scenario: Codex en el checkout principal

- **WHEN** se ejecuta `agent demo --codex`
- **THEN** Codex se abre en `projects/demo` y recibe `projects/demo.worktrees` como directorio adicional

### Requirement: El script valida y crea los worktrees de forma idempotente

`bin/worktree create <feature>` SHALL resolver el proyecto desde el directorio actual, sea el checkout principal o un worktree suyo, y SHALL exigir que pertenezca a `projects/`. El nombre SHALL contener solo `[a-z0-9._-]`, SHALL NOT empezar por `.` o `-` y SHALL NOT contener `..`. La operación SHALL ser idempotente y SHALL fallar sin efectos si la rama está en uso en otra ruta o si la ruta existe y no es ese worktree. `bin/worktree list` SHALL mostrar los worktrees del proyecto.

#### Scenario: Nombre inválido o rama ocupada

- **WHEN** el nombre es `../x` o la rama está en uso en otra ruta
- **THEN** el script termina con error sin crear ramas ni directorios

### Requirement: Los archivos no versionados declarados se copian sin sobrescribir

Cuando exista `<checkout principal>/.agent/worktree-files`, `create` SHALL copiar al worktree cada ruta relativa listada que exista en el checkout principal y falte en el worktree. SHALL ignorar las líneas vacías y los comentarios, SHALL rechazar las rutas absolutas o que contengan `..`, SHALL NOT sobrescribir archivos y SHALL NOT ejecutar comandos del proyecto.

#### Scenario: Copiar el archivo de entorno

- **WHEN** `.agent/worktree-files` lista `.env` y el worktree no lo tiene
- **THEN** `.env` se copia y el script informa de la copia

#### Scenario: Archivo ya presente

- **WHEN** el worktree ya tiene `.env`
- **THEN** el archivo del worktree no cambia

### Requirement: El trabajo en el worktree se limita a su rama

Mientras trabaja en un worktree, el agente SHALL hacer todas las ediciones, comandos y validaciones en el worktree. SHALL NOT modificar el checkout principal, otros worktrees ni otras ramas, salvo el historial local y el merge confirmado. Aceptar el worktree, o abrir la sesión con `--wt`, SHALL autorizar commits por hitos en `feat/<feature>` con Conventional Commits. SHALL NOT autorizar el merge, la limpieza, el push ni la apertura de PR.

#### Scenario: Hito completado

- **WHEN** el agente completa y valida un hito de la feature
- **THEN** hace un commit en `feat/<feature>` sin tocar la rama principal

### Requirement: La integración se hace con merge sin fast-forward tras confirmación

Cuando la feature esté lista, el agente SHALL proponer integrarla, indicando la rama destino. Tras la confirmación, SHALL integrar primero la rama destino en el worktree, resolver allí los conflictos y repetir las validaciones. Después, SHALL ejecutar `bin/worktree merge <feature>`. El script SHALL exigir el worktree limpio y SHALL ejecutar `git merge --no-ff feat/<feature>` en el checkout principal. Ante un conflicto o un cambio local que lo bloquee, SHALL abortar el merge y dejar el checkout principal como estaba.

#### Scenario: Integración limpia

- **WHEN** el usuario confirma la integración y la rama está al día con la rama destino
- **THEN** se crea un commit de merge en la rama del checkout principal

#### Scenario: Conflicto

- **WHEN** el merge en el checkout principal produce conflictos
- **THEN** el script aborta el merge, el checkout principal queda como antes y se indica que se resuelva en el worktree

### Requirement: La limpieza no pierde trabajo

`bin/worktree remove <feature>` SHALL eliminar el worktree sin forzar y SHALL borrar la rama solo si está integrada. SHALL rechazar ejecutarse desde dentro del worktree que elimina. Tras el merge confirmado, el agente SHALL volver al checkout principal (con `ExitWorktree` y `keep` en Claude Code) y SHALL ejecutar la limpieza en la misma sesión. La confirmación del merge SHALL incluir la limpieza.

#### Scenario: Worktree con cambios

- **WHEN** el worktree tiene cambios sin confirmar
- **THEN** el script termina con error y no elimina nada

#### Scenario: Rama no integrada

- **WHEN** el worktree está limpio pero la rama no está integrada
- **THEN** se elimina el worktree, se conserva la rama y se avisa

#### Scenario: Desde el propio worktree

- **WHEN** se ejecuta `bin/worktree remove login` dentro de `projects/demo.worktrees/login/`
- **THEN** el script termina con error sin eliminar nada

### Requirement: El historial es único y el panel informa de los worktrees

El historial local SHALL escribirse en `.agent/history/` del checkout principal, también desde un worktree, e SHALL indicar la feature. El panel de sesión SHALL leer ese historial. En un worktree, SHALL mostrar la feature y la rama activas. En el checkout principal, SHALL listar los worktrees abiertos del proyecto.

#### Scenario: Panel en un worktree

- **WHEN** se abre una sesión en `projects/demo.worktrees/login/` y el proyecto tiene historial en `projects/demo/.agent/history/`
- **THEN** el panel muestra la última entrada de ese historial y el worktree `login` con su rama

#### Scenario: Retomar desde el checkout principal

- **WHEN** se abre `agent demo` con el worktree `login` abierto
- **THEN** el panel lista `login` para retomarlo con `agent demo --wt login`

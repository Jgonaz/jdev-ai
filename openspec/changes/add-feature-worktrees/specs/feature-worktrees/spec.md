## Purpose

Esta capacidad permite que varias sesiones de agentes trabajen a la vez sobre el mismo proyecto sin pisarse. El agente propone aislar los cambios grandes en un worktree y una rama propios, trabaja allí y los integra en la rama principal cuando el usuario lo confirma. Las sesiones se siguen abriendo con el launcher habitual.

## ADDED Requirements

### Requirement: El agente propone un worktree para los cambios grandes

Al recibir una tarea en el checkout principal, el agente SHALL valorar si es un cambio grande según los criterios de `workflows/feature.md`. Si lo es, SHALL proponer trabajar en un worktree, indicando el nombre de la feature, la rama y la rama base, y SHALL esperar la confirmación explícita antes de crearlo. Para los cambios pequeños, el agente SHALL trabajar en el checkout principal sin proponer worktree, salvo que el usuario lo pida.

#### Scenario: Cambio grande

- **WHEN** el usuario pide en una sesión nueva una funcionalidad que afecta a varias partes del sistema
- **THEN** el agente propone un worktree `feat/<feature>` y no modifica archivos ni crea ramas hasta recibir la confirmación

#### Scenario: Cambio pequeño

- **WHEN** el usuario pide corregir un texto
- **THEN** el agente trabaja en el checkout principal sin proponer worktree

#### Scenario: Propuesta rechazada

- **WHEN** el usuario rechaza el worktree
- **THEN** el agente trabaja en el checkout principal como hasta ahora

### Requirement: El script crea o reutiliza el worktree

`bin/worktree create <feature>` SHALL usar la rama `feat/<feature>` y el worktree `projects/<proyecto>.worktrees/<feature>/`, resolviendo el proyecto desde el directorio actual, sea el checkout principal o un worktree suyo. El nombre SHALL contener solo `[a-z0-9._-]`, SHALL NOT empezar por `.` o `-` y SHALL NOT contener `..`. La operación SHALL ser idempotente.

#### Scenario: Primera creación

- **WHEN** no existen ni la rama ni el worktree
- **THEN** se crea la rama desde el `HEAD` del checkout principal, se crea el worktree, se muestra la rama base y se imprime la ruta del worktree

#### Scenario: Reutilización

- **WHEN** el worktree ya existe para esa rama
- **THEN** se reutiliza sin crear ramas ni modificar el checkout principal

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

### Requirement: El agente trabaja solo dentro del worktree

Tras la confirmación, el agente SHALL hacer todas las ediciones, comandos y validaciones en el worktree. SHALL NOT modificar el checkout principal ni otros worktrees, salvo el historial local. Aceptar el worktree SHALL autorizar commits por hitos en `feat/<feature>` con Conventional Commits. SHALL NOT autorizar el merge, la limpieza, el push ni la apertura de PR.

#### Scenario: Hito completado

- **WHEN** el agente completa y valida un hito de la feature
- **THEN** hace un commit en `feat/<feature>` sin tocar la rama principal

### Requirement: El launcher permite escribir en los worktrees

`bin/agent` SHALL seguir abriendo el checkout principal. Al lanzar Claude o Codex, SHALL añadir `projects/<proyecto>.worktrees/` como directorio de trabajo adicional y SHALL crearlo si no existe. Las demás opciones y argumentos SHALL NOT cambiar.

#### Scenario: Lanzamiento habitual

- **WHEN** se ejecuta `agent demo --codex`
- **THEN** Codex se abre en `projects/demo` con `projects/demo.worktrees` como directorio adicional

### Requirement: La integración se hace con merge sin fast-forward tras confirmación

Cuando la feature esté lista, el agente SHALL proponer integrarla, indicando la rama destino. Tras la confirmación, SHALL integrar primero la rama destino en el worktree, resolver allí los conflictos y repetir las validaciones. Después, SHALL ejecutar `bin/worktree merge <feature>`. El script SHALL exigir el worktree limpio y SHALL ejecutar `git merge --no-ff feat/<feature>` en el checkout principal. Ante un conflicto o un cambio local que lo bloquee, SHALL abortar el merge y dejar el checkout principal como estaba.

#### Scenario: Integración limpia

- **WHEN** el usuario confirma la integración y la rama está al día con la rama destino
- **THEN** se crea un commit de merge en la rama del checkout principal

#### Scenario: Conflicto

- **WHEN** el merge en el checkout principal produce conflictos
- **THEN** el script aborta el merge, el checkout principal queda como antes y se indica que se resuelva en el worktree

### Requirement: La limpieza no pierde trabajo

`bin/worktree remove <feature>` SHALL eliminar el worktree sin forzar y SHALL borrar la rama solo si está integrada. El agente SHALL ejecutarlo solo tras confirmación, que puede pedirse junto con la del merge.

#### Scenario: Worktree con cambios

- **WHEN** el worktree tiene cambios sin confirmar
- **THEN** el script termina con error y no elimina nada

#### Scenario: Rama no integrada

- **WHEN** el worktree está limpio pero la rama no está integrada
- **THEN** se elimina el worktree, se conserva la rama y se avisa

### Requirement: El historial es único y el panel muestra los worktrees

El historial local SHALL escribirse en `.agent/history/` del checkout principal, también cuando se trabaja en un worktree, e SHALL indicar la feature. El panel de sesión SHALL listar los worktrees activos del proyecto con su rama.

#### Scenario: Retomar desde otra terminal

- **WHEN** se abre una sesión nueva con un worktree `login` activo
- **THEN** el panel muestra `login` y su rama, y el agente puede retomarlo con `bin/worktree create login`

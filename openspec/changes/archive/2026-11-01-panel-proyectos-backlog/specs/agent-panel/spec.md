## ADDED Requirements

### Requirement: Pantalla Proyectos con el backlog por estados

El panel SHALL ofrecer una pantalla Proyectos con la lista de proyectos (los de `projects/` y el harness) y, para el elegido, sus elementos de `docs/backlog/` del checkout principal agrupados en columnas por estado: backlog, por hacer, en curso, y hecho y descartado plegados. Cada tarjeta SHALL mostrar título, tipo, prioridad y fecha de creación. La persona SHALL poder filtrar por tipo y prioridad y buscar por texto en título, identificador y resumen. Un proyecto sin `docs/backlog/` SHALL mostrar un estado vacío. La vista SHALL actualizarse sola cuando cambien los archivos del backlog.

#### Scenario: Ver el backlog de un proyecto

- **WHEN** la persona abre Proyectos y elige balanz.io
- **THEN** ve sus elementos repartidos por estado según la carpeta en la que está cada archivo

#### Scenario: Cambio externo

- **WHEN** un agente mueve o crea un elemento del backlog mientras la pantalla está abierta
- **THEN** la columna correspondiente se actualiza sin recargar

#### Scenario: Elemento con formato antiguo

- **WHEN** un elemento no tiene cabecera YAML
- **THEN** se muestra con el título del documento, el estado de su carpeta y una marca de formato antiguo, sin romper la vista

### Requirement: Detalle de un elemento

Al elegir un elemento, el panel SHALL mostrar su identificador, título, propiedades de la cabecera, el resumen destacado con su tiempo estimado de lectura, el resto del documento plegable y una vista de la fuente Markdown. El Markdown SHALL pintarse sin interpretar HTML incrustado. Si el campo `status` no coincide con la carpeta, el panel SHALL indicarlo, tomando la carpeta como estado válido.

#### Scenario: Leer el resumen

- **WHEN** la persona abre un elemento con `## Resumen`
- **THEN** ve el resumen destacado antes del detalle, con su tiempo de lectura

### Requirement: Cambiar el estado desde el panel

La persona SHALL poder mover un elemento abierto a otro estado desde el detalle: «Pasar a por hacer» para los de backlog y «Mover a» con los estados permitidos por `rules/backlog.md`. El panel SHALL mover el archivo a la carpeta destino con `git mv` si está en seguimiento (o renombrarlo si no), SHALL actualizar solo los campos `status` y `updated` de la cabecera conservando el resto del archivo y SHALL NOT hacer commit. Si el archivo cambió en disco desde que la persona lo abrió, SHALL rechazar el movimiento y recargar el elemento. El panel SHALL mostrar en el proyecto cuántos cambios del backlog quedan sin commit.

#### Scenario: Elegir un elemento para abordarlo pronto

- **WHEN** la persona pulsa «Pasar a por hacer» en un elemento de backlog
- **THEN** el archivo pasa a `docs/backlog/todo/`, su cabecera dice `status: todo` con la fecha de hoy en `updated`, y el proyecto muestra un cambio sin commit

#### Scenario: Archivo modificado mientras tanto

- **WHEN** un agente edita el elemento después de que la persona lo abriera y la persona intenta moverlo
- **THEN** el panel no lo mueve, avisa de que ha cambiado y muestra la versión actual

#### Scenario: Elemento con formato antiguo

- **WHEN** la persona intenta mover un elemento sin cabecera YAML
- **THEN** el panel no lo mueve y explica que debe migrarse antes al formato actual

### Requirement: Trabajar en un elemento

El detalle SHALL ofrecer «Trabajar en esto», que abre el diálogo Nueva sesión con el proyecto del elemento y un prompt que pide abordar ese elemento por su identificador y ruta. El panel SHALL NOT mover el elemento por sí mismo: según `rules/backlog.md`, lo mueve el agente al empezar.

#### Scenario: Arrancar el trabajo

- **WHEN** la persona pulsa «Trabajar en esto» en un elemento de fitnessia
- **THEN** se abre Nueva sesión con fitnessia y un prompt con el identificador y la ruta del elemento, listo para revisar y lanzar

### Requirement: Worktrees y guías del proyecto

La pantalla Proyectos SHALL incluir una pestaña Worktrees con los worktrees del proyecto, su rama, commits por delante y por detrás de la rama principal, si tienen cambios sin commit y las sesiones del panel que trabajan en ellos, con acceso a su terminal o a abrir una sesión nueva en ese worktree. SHALL incluir una pestaña Guías con los documentos de `docs/user-guides/` del proyecto, para leerlos con el mismo visor de Markdown.

#### Scenario: Ir a la terminal de un worktree

- **WHEN** la persona pulsa la sesión de un worktree en la pestaña Worktrees
- **THEN** el panel abre esa terminal en la pantalla Terminales

### Requirement: Confirmar los cambios del backlog

Cuando un proyecto tenga cambios sin commit en `docs/backlog/`, el panel SHALL ofrecer «Confirmar cambios», que abre un diálogo con los archivos afectados, la rama actual y un mensaje de commit propuesto en Conventional Commits con un punto por archivo, editable. Al confirmar, el panel SHALL hacer un commit que incluya solo `docs/backlog/`, aunque haya otros cambios en el índice, respetando los hooks del proyecto. Si la persona lo marca (marcado por defecto), SHALL subir después la rama a su remoto. Si el commit o el push fallan, el panel SHALL mostrar la salida del error y SHALL NOT reintentar con opciones que salten los hooks. El panel SHALL NOT hacer commits ni pushes sin esta confirmación explícita.

#### Scenario: Confirmar y subir

- **WHEN** la persona pulsa «Confirmar cambios», revisa el mensaje y confirma con «Subir también al remoto» marcado
- **THEN** se crea un commit solo con los cambios de `docs/backlog/`, se sube la rama y el aviso de cambios sin commit desaparece

#### Scenario: Otros cambios en el proyecto

- **WHEN** el proyecto tiene además cambios en el índice fuera de `docs/backlog/`
- **THEN** el commit no los incluye y siguen pendientes como estaban

#### Scenario: Falla un hook

- **WHEN** el hook de pre-commit o de pre-push del proyecto falla
- **THEN** el panel muestra su salida, no reintenta saltándose el hook y, si falló el push, indica que el commit sí quedó hecho en local

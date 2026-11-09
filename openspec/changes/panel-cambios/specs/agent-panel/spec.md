## MODIFIED Requirements

### Requirement: Pantallas de worktrees y guías del proyecto

El menú «Proyectos» de la cabecera SHALL ofrecer tres pantallas independientes: Backlog, Cambios y Guías, con ruta propia (`#/backlog/<proyecto>[/<elemento>]`, `#/cambios/<proyecto>[/main[/<archivo>]|/wt/<worktree>[/<archivo>]]` y `#/guias/<proyecto>[/<guía>]`), cada una con su cabecera (monograma, nombre del proyecto y la carpeta que muestra) y una barra lateral de proyectos común que mantiene la pantalla en curso al elegir otro proyecto. Las rutas antiguas `#/proyectos…` y `#/worktrees…` SHALL redirigirse a las de cada pantalla. La pantalla Cambios SHALL mostrar, para el checkout principal del proyecto (también del propio harness) y para cada uno de sus worktrees, su rama, sus commits por delante y por detrás, si tiene cambios sin commit, las sesiones del panel que trabajan en él, con acceso a su terminal, la opción de abrir una sesión nueva ahí y sus cambios, según el requisito «Cambios del checkout principal y de los worktrees». La pantalla Guías SHALL mostrar los documentos de `docs/user-guides/` del proyecto, para leerlos con el mismo visor de Markdown.

#### Scenario: Ir a la terminal de un worktree

- **WHEN** la persona elige la pestaña de un worktree en la pantalla Cambios y pulsa una de sus sesiones
- **THEN** el panel abre esa terminal en la pantalla Terminales

#### Scenario: Cambiar de proyecto sin cambiar de pantalla

- **WHEN** la persona está en Cambios de un proyecto y elige otro en la barra lateral
- **THEN** el panel muestra los Cambios del otro proyecto, con su propia cabecera, y no vuelve a Backlog

#### Scenario: Enlace antiguo

- **WHEN** la persona abre `#/proyectos/balanz.io/worktrees` o `#/worktrees/balanz.io`
- **THEN** el panel sustituye la dirección por `#/cambios/balanz.io` sin añadir una entrada al historial del navegador

#### Scenario: Enlace antiguo a un worktree

- **WHEN** la persona abre `#/worktrees/balanz.io/typescript-7`
- **THEN** el panel sustituye la dirección por `#/cambios/balanz.io/wt/typescript-7` sin añadir una entrada al historial

### Requirement: Proyecto por defecto de Worktrees

Al abrir Cambios sin proyecto en la ruta, el panel SHALL mostrar el primer proyecto visible con cambios en su checkout principal o en alguno de sus worktrees; si ninguno tiene, SHALL mostrar el último proyecto usado en Cambios o, si no lo hay, el primer proyecto visible. Backlog y Guías SHALL seguir mostrando el último proyecto usado.

#### Scenario: Un proyecto con worktrees

- **WHEN** la persona abre Proyectos › Cambios y solo balanz.io tiene cambios (en su checkout principal o en sus worktrees)
- **THEN** se muestran los cambios de balanz.io

#### Scenario: Ninguno con worktrees

- **WHEN** ningún proyecto tiene cambios y la persona no ha usado Cambios antes
- **THEN** se muestra el primer proyecto visible

#### Scenario: Lo escogido por defecto no se recuerda

- **WHEN** la persona abre Backlog de ccc, luego Proyectos › Cambios (que abre bbb, el único con cambios) y después Proyectos › Backlog
- **THEN** Backlog muestra ccc

#### Scenario: Backlog no cambia

- **WHEN** la persona abre Proyectos › Backlog sin proyecto en la ruta
- **THEN** se muestra el backlog del último proyecto usado

## ADDED Requirements

### Requirement: Cambios del checkout principal y de los worktrees

La pantalla Cambios SHALL mostrar directamente los cambios del checkout principal del proyecto y SHALL permitir elegir, con una pestaña por lugar, el checkout principal o cualquiera de sus worktrees. Cada pestaña SHALL indicar cuántos archivos cambiados tiene. La barra lateral SHALL indicar cuántos archivos cambiados tiene cada proyecto entre su checkout principal y sus worktrees.

Los cambios de cada lugar SHALL ser:

- **Checkout principal:** lo que aún no está en su rama remota: los commits locales sin subir, los cambios sin commit y los archivos nuevos sin seguimiento. Si la rama no tiene rama remota, SHALL ser solo lo que no tiene commit.
- **Worktree:** todo lo que aporta frente a la rama principal: los cambios entre el punto en que su rama se separó de la rama principal (merge-base) y su carpeta de trabajo, lo que incluye los commits de su rama, los cambios sin commit y los archivos nuevos sin seguimiento.

Para el lugar elegido, la pantalla SHALL mostrar:

1. Un árbol de los archivos cambiados, con carpetas plegables, carpetas de un solo hijo compactadas en una sola fila, la letra de estado de cada archivo (añadido, modificado, borrado, renombrado o sin seguimiento) y sus líneas añadidas y quitadas. El árbol SHALL poder recorrerse con el teclado.
2. El diff del archivo elegido, lado a lado (versión anterior a la izquierda y nueva a la derecha) o unificado (una columna), con números de línea y las líneas añadidas y quitadas distinguidas por algo más que el color. La persona SHALL poder cambiar entre ambos formatos; el formato por defecto SHALL ser lado a lado y el panel SHALL recordar la elección en ese navegador. Cuando no haya anchura suficiente para dos columnas, el panel SHALL mostrar el formato unificado.

Para un archivo binario o un diff que supere el límite de tamaño, el panel SHALL indicarlo en lugar del diff. Si el lugar no tiene cambios, SHALL decirlo.

El servidor SHALL ofrecer la lista de cambios y el diff de un archivo solo para el checkout principal o para worktrees del proyecto identificados por su nombre, y solo para archivos que estén en esa lista, y SHALL NOT modificar el repositorio.

#### Scenario: Entrar en Cambios de un proyecto

- **WHEN** la persona abre Cambios de balanz.io, que tiene un archivo modificado sin commit en su checkout principal y el worktree `typescript-7` con 10 archivos cambiados
- **THEN** el panel muestra las pestañas `main · 1` y `typescript-7 · 10`, con `main` elegida y el diff de su archivo

#### Scenario: Commits sin subir

- **WHEN** la rama `main` del checkout principal tiene un commit local que modifica `README.md` y no se ha subido
- **THEN** `README.md` aparece entre los cambios del checkout principal

#### Scenario: Sin rama remota

- **WHEN** la rama del checkout principal no tiene rama remota
- **THEN** solo aparecen los cambios sin commit y los archivos nuevos, y la barra indica que no hay rama remota

#### Scenario: El propio harness

- **WHEN** la persona abre Cambios de jdev-ai
- **THEN** ve los cambios de su checkout principal, sin pestañas de worktrees

#### Scenario: Ver los cambios de un worktree

- **WHEN** la persona elige la pestaña `typescript-7`, cuyo worktree tiene un commit que modifica `src/app.ts` y un archivo nuevo sin seguimiento `src/lib/nuevo.ts`
- **THEN** la dirección pasa a `#/cambios/balanz.io/wt/typescript-7` y el árbol muestra `src` con `app.ts` (M) y `lib/nuevo.ts` (U), con el diff del primer archivo

#### Scenario: Abrir un archivo

- **WHEN** la persona elige `src/app.ts` en el árbol
- **THEN** el panel muestra su diff lado a lado y la dirección pasa a `#/cambios/balanz.io/wt/typescript-7/src/app.ts`

#### Scenario: Cambiar a diff unificado

- **WHEN** la persona pulsa «Unificado» y después abre otro archivo o vuelve otro día
- **THEN** el panel muestra los diffs en una sola columna hasta que vuelva a elegir «Lado a lado»

#### Scenario: Cambios de la rama principal posteriores

- **WHEN** la rama principal ha recibido commits después de crear el worktree
- **THEN** esos commits no aparecen como cambios del worktree

#### Scenario: Archivo binario

- **WHEN** la persona elige una imagen modificada
- **THEN** el panel indica que es un archivo binario en lugar de mostrar el diff

#### Scenario: Diff demasiado grande

- **WHEN** el diff de un archivo supera el límite de tamaño
- **THEN** el panel indica que es demasiado grande para mostrarlo

#### Scenario: Lugar sin cambios

- **WHEN** el lugar elegido no tiene cambios
- **THEN** la vista dice que no hay cambios

#### Scenario: Worktree que ya no existe

- **WHEN** la persona abre `#/cambios/balanz.io/wt/borrado` y ese worktree no existe
- **THEN** el panel sustituye la dirección por `#/cambios/balanz.io` sin añadir una entrada al historial

#### Scenario: Archivo fuera de la lista

- **WHEN** se pide al servidor el diff de una ruta que no está entre los cambios del lugar, como `../../.ssh/id_rsa`
- **THEN** el servidor responde 404 sin leer el archivo

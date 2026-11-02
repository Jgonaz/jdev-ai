# agent-panel Specification

## Purpose
Panel gráfico local del harness para lanzar, ver y usar en un solo sitio las terminales de agente de todos los proyectos, con su estado, título y ajustes visuales.
## Requirements
### Requirement: El panel se ejecuta solo en local y con token

El panel SHALL arrancarse con `bin/panel`, SHALL escuchar únicamente en `127.0.0.1` y SHALL exigir un token de acceso en cada petición HTTP y conexión WebSocket. El token SHALL generarse en el primer arranque, guardarse con permisos solo para el usuario y poder regenerarse. El servidor SHALL rechazar conexiones WebSocket cuyo origen no sea el propio panel.

#### Scenario: Arranque

- **WHEN** la persona ejecuta `bin/panel`
- **THEN** el panel arranca en `127.0.0.1` en el puerto configurado y muestra la URL de acceso con el token

#### Scenario: Petición sin token

- **WHEN** llega una petición o conexión sin token válido
- **THEN** el servidor la rechaza sin ejecutar ninguna acción

#### Scenario: Dependencias ausentes

- **WHEN** se ejecuta `bin/panel` sin Node, sin las dependencias del panel instaladas o sin tmux
- **THEN** termina con un mensaje que indica qué falta y cómo instalarlo, sin instalar nada por su cuenta

### Requirement: Las terminales viven en tmux

Cada terminal del panel SHALL corresponder a una sesión de tmux con un nombre reconocible por el panel. Cerrar el panel o el navegador SHALL NOT terminar las sesiones. El panel SHALL listar al arrancar las sesiones de tmux del panel que sigan vivas y SHALL permitir terminarlas de forma explícita.

#### Scenario: Reapertura del panel

- **WHEN** la persona cierra el navegador o detiene el panel y lo vuelve a abrir
- **THEN** las sesiones siguen vivas y aparecen en la barra lateral con su contenido

#### Scenario: Uso fuera del panel

- **WHEN** la persona ejecuta `tmux attach` sobre una sesión del panel desde otra terminal
- **THEN** trabaja en la misma sesión que muestra el panel

#### Scenario: Terminar una sesión

- **WHEN** la persona elige terminar una sesión desde el panel y lo confirma
- **THEN** el panel cierra esa sesión de tmux y la retira de la barra lateral

### Requirement: Nueva sesión mediante el lanzador

El diálogo Nueva sesión SHALL permitir elegir proyecto (incluido el propio harness), agente (Claude, Codex, Copilot u OpenCode), dónde trabaja (checkout principal, worktree nuevo con nombre de feature o worktree existente) y un prompt inicial opcional. El panel SHALL ejecutar `bin/agent` con las opciones equivalentes dentro de una sesión de tmux nueva y SHALL mostrar el comando antes de ejecutarlo. Las opciones que `bin/agent` no admite, como un worktree sobre el harness, SHALL no ofrecerse.

#### Scenario: Sesión en worktree nuevo

- **WHEN** la persona elige balanz.io, Claude, worktree nuevo con la feature `typescript-7` y confirma
- **THEN** se abre una terminal nueva que ejecuta `bin/agent balanz.io --wt typescript-7` y aparece en la barra lateral bajo balanz.io

#### Scenario: Harness sin worktree

- **WHEN** la persona elige el proyecto jdev-ai
- **THEN** el diálogo no ofrece crear ni usar un worktree

### Requirement: La barra lateral muestra sesiones con título y estado

La barra lateral SHALL agrupar las sesiones por proyecto y SHALL mostrar de cada una su título, agente, rama o worktree, tiempo desde el último cambio y estado. Los estados SHALL ser: te espera (el agente necesita una respuesta o un permiso), trabajando, en reposo y cerrada (título con la marca `[Closed]`). Los estados SHALL distinguirse por forma y texto además de por color. Para agentes que no informan del estado, el panel SHALL mostrar solo si la sesión está viva.

#### Scenario: Agente pide permiso

- **WHEN** Claude Code en una sesión del panel pide permiso para ejecutar un comando
- **THEN** la sesión pasa a «te espera» en la barra lateral, en su pestaña y en el contador de la cabecera

#### Scenario: La persona responde

- **WHEN** la persona envía un mensaje o concede el permiso
- **THEN** la sesión pasa a «trabajando» y, al terminar el turno del agente, a «en reposo»

#### Scenario: Título actualizado por el agente

- **WHEN** el agente cambia el título de la sesión con `bin/session-title`
- **THEN** el panel muestra el título nuevo sin recargar

#### Scenario: Agente sin hooks de estado

- **WHEN** una sesión ejecuta Copilot u OpenCode
- **THEN** el panel muestra la sesión como viva o terminada, sin estados de turno

### Requirement: Renombrar sesiones desde el panel

El panel SHALL permitir renombrar una sesión desde un menú contextual (clic derecho o teclado) de la barra lateral y de las pestañas, con un título de hasta 80 caracteres sin caracteres de control. Para una sesión de Claude con transcript dentro del directorio de proyectos de Claude, el panel SHALL añadir al transcript una línea `custom-title` con el mismo formato que `bin/session-title`, conservando la marca `[Closed]` si la tenía, y SHALL rechazar un transcript fuera de ese directorio. Para el resto, el panel SHALL guardar el título en la propia sesión de tmux. El título nuevo SHALL mostrarse sin recargar.

#### Scenario: Renombrar una sesión de Claude

- **WHEN** la persona elige «Renombrar…» en el menú contextual de una sesión de Claude y guarda «Revisar login»
- **THEN** el transcript recibe una línea `custom-title` con ese título y la barra lateral y la pestaña lo muestran

#### Scenario: Renombrar una sesión sin transcript

- **WHEN** la persona renombra una sesión de Codex
- **THEN** el panel guarda el título en la sesión de tmux y lo muestra en lugar del título por defecto

### Requirement: El estado de sesión se registra fuera del panel

El harness SHALL proporcionar `bin/session-state`, que el lanzador registra como hook de Claude Code y que escribe el estado de la sesión, su identificador, proyecto, agente, ruta del transcript y sesión de tmux en un archivo por sesión bajo el directorio de estado del usuario. El script SHALL funcionar aunque el panel no esté arrancado, SHALL NOT bloquear ni alterar el turno del agente ante un error y SHALL escribir el archivo de forma atómica.

#### Scenario: Panel detenido

- **WHEN** una sesión cambia de estado mientras el panel no está en marcha
- **THEN** el archivo de estado se actualiza y el panel lo muestra correctamente al arrancar

#### Scenario: Error al escribir el estado

- **WHEN** `bin/session-state` no puede escribir su archivo
- **THEN** termina sin salida ni código de error que interrumpa al agente

### Requirement: Distribución de terminales

El panel SHALL permitir ver una terminal, dos en columnas o cuatro en cuadrícula, abrir sesiones en pestañas y cambiar de terminal con atajos de teclado. Cada terminal SHALL ser plenamente interactiva (teclado, ratón, redimensionado y copiar y pegar) y SHALL ajustar el tamaño de la sesión de tmux al de su panel.

#### Scenario: Cambio de distribución

- **WHEN** la persona pasa de una a dos columnas
- **THEN** se muestran dos terminales y cada sesión se redimensiona a su nuevo tamaño

### Requirement: Avisos de sesiones que esperan

Cuando una sesión pase a «te espera», el panel SHALL actualizar el contador del título de la pestaña del navegador y, si la persona lo ha activado en Ajustes y ha concedido el permiso, SHALL mostrar una notificación del sistema.

#### Scenario: Panel en segundo plano

- **WHEN** una sesión pasa a «te espera» mientras el panel no tiene el foco
- **THEN** el título de la pestaña muestra el número de sesiones que esperan y, si está activado, aparece una notificación del sistema

### Requirement: Ajustes persistentes

El panel SHALL ofrecer una pantalla de Ajustes con tema (Grafito por defecto, Fósforo, Papel y Alto contraste, y seguir el tema del sistema), color de acento, fuentes de interfaz, títulos y terminal, tamaños, opciones de terminal (cursor, distribución inicial, scroll, copiar al seleccionar), monograma, color y visibilidad por proyecto, interruptores de los detalles de personalidad, avisos y puerto. Los ajustes SHALL guardarse en un archivo de configuración del usuario fuera del repositorio y SHALL aplicarse sin reiniciar, salvo el puerto. Cuando el sistema pida reducir el movimiento, las animaciones SHALL desactivarse aunque estén activadas.

#### Scenario: Cambio de tema

- **WHEN** la persona elige el tema Papel
- **THEN** todo el panel y las terminales cambian al tema claro y la elección se conserva al reabrir

#### Scenario: Movimiento reducido

- **WHEN** el sistema operativo pide reducir el movimiento
- **THEN** el cursor del logo y las luces de estado dejan de animarse

### Requirement: Sesiones recientes que se pueden retomar en el panel

El panel SHALL listar por proyecto las sesiones recientes de Claude Code que no estén ya en el panel, a partir de los transcripts que Claude guarda para el checkout principal del proyecto y sus worktrees, con su título (el último `custom-title` o, si no hay, el último `ai-title`), worktree y fecha de última actividad. Cada una SHALL poder retomarse en una terminal nueva del panel mediante `bin/agent` con `--resume <id>`. Antes de retomar, el panel SHALL advertir que la sesión debe cerrarse en su ventana original y SHALL destacar las que tengan actividad muy reciente, porque podrían seguir abiertas.

#### Scenario: Retomar una sesión abierta fuera del panel

- **WHEN** la persona elige «Retomar en el panel» en una sesión reciente de balanz.io y confirma el aviso
- **THEN** se abre una terminal nueva que ejecuta `bin/agent balanz.io -- --resume <id>` y la sesión deja de aparecer en recientes al pasar a la lista de terminales

#### Scenario: Sesión con actividad muy reciente

- **WHEN** el transcript de una sesión reciente se ha modificado en los últimos minutos
- **THEN** el panel la marca como posiblemente abierta en otra ventana y lo indica en el aviso de confirmación

#### Scenario: Sesión ya presente en el panel

- **WHEN** una sesión reciente corresponde a una terminal que ya está en el panel
- **THEN** no aparece en la lista de recientes

### Requirement: Visor de imágenes desde la terminal

El panel SHALL convertir en enlaces las rutas de archivos de imagen (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`) que aparezcan en una terminal, tanto absolutas como relativas al directorio de trabajo de la sesión y aunque la ruta ocupe varias líneas por ajuste de la terminal. Al activar un enlace, el panel SHALL abrir un visor lateral con la imagen, su nombre, ruta, dimensiones y tamaño, controles para ajustar a la ventana, ver al 100 %, acercar, alejar, copiar la ruta y abrir en una pestaña nueva, y una tira con las imágenes enlazadas en esa terminal. Una imagen que no exista o no esté permitida SHALL mostrar un mensaje claro en el visor.

#### Scenario: Captura de QA

- **WHEN** el agente escribe `/tmp/jdev-qa/fitnessia/02-dashboard.png` en la terminal y la persona hace clic en la ruta
- **THEN** se abre el visor lateral con esa imagen ajustada a la ventana

#### Scenario: Ruta relativa

- **WHEN** aparece `docs/img/logo.png` en una sesión cuyo directorio es el checkout de un proyecto
- **THEN** el enlace abre `<checkout>/docs/img/logo.png`

#### Scenario: Ruta no permitida

- **WHEN** el enlace apunta a una imagen fuera de las carpetas permitidas
- **THEN** el visor indica que la imagen no se puede mostrar y el servidor no entrega el archivo

### Requirement: El servidor solo entrega imágenes permitidas

El servidor SHALL entregar archivos solo con token válido, solo si su extensión y su contenido son de imagen, si su tamaño no supera el límite configurado y si su ruta real, tras resolver enlaces simbólicos, está dentro de las carpetas permitidas: el harness con sus proyectos y worktrees, la carpeta de evidencias del QA, la de imágenes adjuntadas y la temporal del sistema. Los SVG SHALL entregarse con cabeceras que impidan ejecutar scripts.

#### Scenario: Intento de salir de las carpetas permitidas

- **WHEN** se pide una ruta con `..` o un enlace simbólico que apunta fuera de las carpetas permitidas
- **THEN** el servidor responde con error y no lee el archivo

### Requirement: Adjuntar imágenes al agente

La persona SHALL poder pegar una imagen del portapapeles o arrastrar un archivo de imagen sobre una terminal del panel. El panel SHALL guardarla en `${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/uploads/` con un nombre único y permisos solo para el usuario, escribir su ruta absoluta en la entrada de la terminal sin enviarla y mostrar un aviso con miniatura y opción de verla. Los archivos que no sean imagen o superen el límite SHALL rechazarse con un aviso que explique el motivo. Pegar texto SHALL seguir funcionando como siempre. El servidor SHALL borrar las imágenes adjuntadas con más de 7 días.

#### Scenario: Pegar una captura

- **WHEN** la persona copia una captura y pulsa Ctrl+V con el foco en una terminal
- **THEN** la imagen se guarda, su ruta aparece en el prompt y se muestra el aviso «Imagen adjuntada»

#### Scenario: Arrastrar un archivo que no es imagen

- **WHEN** la persona suelta un vídeo sobre la terminal
- **THEN** no se guarda nada y aparece el aviso de rechazo con los tipos y el tamaño admitidos

### Requirement: Las sesiones del panel indican su superficie

Las sesiones que crea el panel SHALL arrancar con `JDEV_SURFACE=panel`. `bin/agent` SHALL exportar `JDEV_SURFACE=terminal` cuando no venga definida y SHALL rechazar otros valores. En Claude Code, al iniciar, reanudar o compactar una sesión, un hook SHALL añadir al contexto del agente en qué superficie trabaja la persona y qué regla seguir.

#### Scenario: Sesión creada desde el panel

- **WHEN** la persona abre o retoma una sesión de Claude desde el panel
- **THEN** el agente recibe en su contexto que trabaja en el panel gráfico

#### Scenario: Sesión abierta en una terminal

- **WHEN** la persona ejecuta `bin/agent` desde una terminal
- **THEN** el agente recibe en su contexto que trabaja en una terminal sin imágenes

### Requirement: Vista previa y apertura automática de imágenes

Al pasar el ratón sobre una ruta de imagen enlazada en una terminal, el panel SHALL mostrar junto a ella una miniatura flotante con el nombre y las dimensiones, sin necesidad de clic, que desaparece al salir del enlace. El panel SHALL ofrecer en Ajustes la opción «Abrir el visor al aparecer una imagen nueva», desactivada por defecto: con ella activa, cuando una terminal visible escriba una ruta de imagen permitida que no estaba en su tira, el visor se abre con esa imagen sin quitar el foco de la terminal.

#### Scenario: Pasar el ratón por una ruta

- **WHEN** la persona pasa el ratón por `/tmp/jdev-qa/fitnessia/02-dashboard.png` en una terminal
- **THEN** aparece una miniatura de esa imagen junto al enlace y se oculta al apartar el ratón

#### Scenario: Apertura automática activada

- **WHEN** la opción está activa y el agente escribe la ruta de una captura nueva en la terminal que la persona está viendo
- **THEN** el visor lateral se abre con esa captura y el foco sigue en la terminal

#### Scenario: Apertura automática desactivada

- **WHEN** la opción está desactivada, que es su valor por defecto
- **THEN** las rutas nuevas solo se enlazan y el visor no se abre solo

### Requirement: Pantalla Backlog con el backlog por estados

El panel SHALL ofrecer una pantalla Backlog, a la que se llega desde el menú «Proyectos» de la cabecera, con la lista de proyectos (los de `projects/` y el harness) y, para el elegido, sus elementos de `docs/backlog/` del checkout principal agrupados en columnas por estado: backlog, por hacer, en curso, y hecho y descartado plegados. Cada tarjeta SHALL mostrar título, tipo, prioridad y fecha de creación. La persona SHALL poder filtrar por tipo y prioridad y buscar por texto en título, identificador y resumen. Un proyecto sin `docs/backlog/` SHALL mostrar un estado vacío. La vista SHALL actualizarse sola cuando cambien los archivos del backlog.

#### Scenario: Ver el backlog de un proyecto

- **WHEN** la persona abre Backlog desde el menú Proyectos y elige balanz.io
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

### Requirement: Pantallas de worktrees y guías del proyecto

El menú «Proyectos» de la cabecera SHALL ofrecer tres pantallas independientes: Backlog, Worktrees y Guías, con ruta propia (`#/backlog/<proyecto>[/<elemento>]`, `#/worktrees/<proyecto>` y `#/guias/<proyecto>[/<guía>]`), cada una con su cabecera (monograma, nombre del proyecto y la carpeta que muestra) y una barra lateral de proyectos común que mantiene la pantalla en curso al elegir otro proyecto. Las rutas antiguas `#/proyectos…` SHALL redirigirse a las de cada pantalla. La pantalla Worktrees SHALL mostrar los worktrees del proyecto, su rama, commits por delante y por detrás de la rama principal, si tienen cambios sin commit y las sesiones del panel que trabajan en ellos, con acceso a su terminal o a abrir una sesión nueva en ese worktree. La pantalla Guías SHALL mostrar los documentos de `docs/user-guides/` del proyecto, para leerlos con el mismo visor de Markdown.

#### Scenario: Ir a la terminal de un worktree

- **WHEN** la persona pulsa la sesión de un worktree en la pantalla Worktrees
- **THEN** el panel abre esa terminal en la pantalla Terminales

#### Scenario: Cambiar de proyecto sin cambiar de pantalla

- **WHEN** la persona está en Worktrees de un proyecto y elige otro en la barra lateral
- **THEN** el panel muestra los Worktrees del otro proyecto, con su propia cabecera, y no vuelve a Backlog

#### Scenario: Enlace antiguo

- **WHEN** la persona abre `#/proyectos/balanz.io/worktrees`
- **THEN** el panel sustituye la dirección por `#/worktrees/balanz.io` sin añadir una entrada al historial del navegador

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

### Requirement: Pantalla Historial con las entradas de todos los proyectos

El panel SHALL ofrecer una pantalla Historial que liste las entradas `.agent/history/*.md` del checkout principal de cada proyecto y del harness, ignorando subcarpetas y archivos que no sean Markdown, ordenadas de más reciente a más antigua y agrupadas por día o, si la persona lo elige, por proyecto. Cada entrada SHALL mostrar hora, proyecto, estado (`finalizada`, `en curso` o `bloqueada`), título y su primer pendiente abierto si lo tiene. La persona SHALL poder filtrar por proyecto, por estado y por «Solo con Pendiente de ti», que por defecto deja solo las entradas con pendientes vigentes: las que son la última entrada de su proyecto, con el mismo criterio que `bin/session-status` (fecha y hora de `Fecha:` o del nombre, no la fecha de modificación), y tienen algún pendiente sin marcar. Debajo, la opción «Incluir pendientes antiguos» SHALL ampliar el filtro a las entradas anteriores con pendientes sin marcar. Ambas opciones SHALL recordarse junto con el resto de filtros; en unos filtros guardados que no incluyan la segunda, el panel SHALL darla por desactivada. Las entradas con `Fecha:` o `Estado:` fuera del formato SHALL mostrarse con la fecha del nombre o del archivo y un estado desconocido, sin romper la vista. La lista SHALL actualizarse sola cuando cambien los archivos.

#### Scenario: Agrupar por proyecto

- **WHEN** la persona elige la vista «Por proyecto» en la lista
- **THEN** las entradas se agrupan por proyecto con su monograma y su número de entradas, mostrando las tres más recientes de cada uno y «Ver más» para el resto, con los mismos filtros aplicados, y la elección se recuerda

#### Scenario: Ver qué espera de mí

- **WHEN** la persona activa «Solo con Pendiente de ti»
- **THEN** ve solo la última entrada de cada proyecto que tenga algún pendiente sin marcar, de todos los proyectos, aunque entradas anteriores conserven pendientes sin marcar

#### Scenario: Incluir pendientes antiguos

- **WHEN** la persona activa además «Incluir pendientes antiguos»
- **THEN** ve también las entradas anteriores con pendientes sin marcar, y la elección se recuerda al volver a Historial

#### Scenario: Entrada nueva

- **WHEN** un agente registra una entrada mientras la pantalla está abierta
- **THEN** aparece en la lista sin recargar

### Requirement: Lector de una entrada

Al elegir una entrada, el panel SHALL mostrar su proyecto, ruta, título, estado y fecha, el bloque «Pendiente de ti» destacado con cada punto y su estado, y el resto de secciones (resumen, decisiones, referencias, continuación recomendada y cualquier otra) pintadas con el visor de Markdown seguro. Si la entrada no es la última de su proyecto y tiene pendientes sin marcar, el bloque SHALL incluir una nota discreta «Entrada anterior: estos pendientes no cuentan como vigentes.».

#### Scenario: Leer una entrada

- **WHEN** la persona abre una entrada con «Pendiente de ti» y «Continuación recomendada»
- **THEN** ve los pendientes destacados arriba y la continuación al final

#### Scenario: Pendientes de una entrada anterior

- **WHEN** la persona abre una entrada con pendientes sin marcar que no es la última de su proyecto
- **THEN** el bloque «Pendiente de ti» indica que esos pendientes no cuentan como vigentes, y sigue permitiendo marcarlos uno a uno

### Requirement: Marcar pendientes como hechos

Cada punto de «Pendiente de ti» SHALL poder marcarse como hecho y desmarcarse desde el lector. El panel SHALL marcarlo en el propio archivo como `- [x] <texto> (hecho YYYY-MM-DD)` y, al desmarcarlo, SHALL devolverlo a `- <texto>`, sin tocar el resto de la entrada. Si el archivo cambió desde que se abrió, SHALL rechazar la operación y recargar la entrada. `bin/session-status` SHALL omitir los puntos marcados al mostrar «Pendiente de ti» en el resumen de inicio, y SHALL omitir el apartado si no queda ninguno.

#### Scenario: Pendiente resuelto

- **WHEN** la persona marca como hecho «Reinstalar la app en el iPhone y comprobar el teclado»
- **THEN** el archivo guarda `- [x] Reinstalar la app… (hecho <fecha de hoy>)`, la entrada deja de salir con «Solo con Pendiente de ti» si no le quedan pendientes, y el resumen de inicio del proyecto ya no lo muestra

#### Scenario: Archivo modificado mientras tanto

- **WHEN** un agente actualiza la entrada después de que la persona la abriera y la persona marca un pendiente
- **THEN** el panel no lo marca, avisa y muestra la versión actual

### Requirement: Limpiar los pendientes antiguos

Historial SHALL ofrecer «Marcar como hechos los pendientes antiguos» cuando haya entradas que no son la última de su proyecto con pendientes sin marcar. La acción SHALL abarcar el proyecto elegido en el filtro o, sin proyecto elegido, todos los proyectos, y SHALL pedir antes una confirmación accesible que diga cuántos pendientes y entradas se marcarán y que no se puede deshacer en bloque, solo desmarcando uno a uno. El panel SHALL marcar cada punto con la misma edición mínima y las mismas salvaguardas que al marcar un pendiente suelto (UTF-8 estricto, sin seguir enlaces y escribiendo de forma atómica), SHALL NOT tocar la última entrada de ningún proyecto, y SHALL omitir las entradas que no pueda editar sin alterarlas, como las que no están en UTF-8, informando de ellas en el aviso del resultado.

#### Scenario: Limpiar un proyecto

- **WHEN** la persona tiene elegido el proyecto balanz.io, pulsa «Marcar como hechos los pendientes antiguos» y confirma
- **THEN** los pendientes sin marcar de las entradas anteriores de balanz.io quedan como `- [x] … (hecho <fecha de hoy>)`, su última entrada y los demás proyectos no cambian, y un aviso dice cuántos pendientes y entradas se han marcado

#### Scenario: Entrada que no se puede editar

- **WHEN** una de las entradas anteriores no está en UTF-8
- **THEN** el panel la deja intacta, marca el resto y el aviso nombra la entrada omitida y el motivo

### Requirement: Retomar desde una entrada

El lector SHALL ofrecer «Retomar desde aquí», que abre Nueva sesión con el proyecto de la entrada y un prompt que pide ponerse al día desde esa entrada (por su ruta) y seguir su continuación recomendada, sin lanzar nada hasta que la persona confirme.

#### Scenario: Retomar un trabajo en curso

- **WHEN** la persona pulsa «Retomar desde aquí» en una entrada «en curso» de balanz.io
- **THEN** se abre Nueva sesión con balanz.io y un prompt con la ruta de la entrada, listo para revisar y lanzar

### Requirement: Pantalla Inicio con el resumen de todos los proyectos

El panel SHALL ofrecer una pantalla Inicio con:

- un saludo según la hora del día con el nombre de la persona, si el ajuste de saludo está activo;
- un resumen con el número de proyectos visibles, sesiones del panel y worktrees abiertos;
- los recuentos de sesiones que esperan, trabajando y en reposo, que llevan a Terminales;
- la sección «Necesita tu atención»;
- las tarjetas de proyectos;
- la actividad reciente.

La pantalla SHALL actualizarse sola con los cambios de sesiones, backlog e historial, y SHALL NOT escribir en los proyectos ni en el historial.

#### Scenario: Abrir el panel por la mañana

- **WHEN** la persona abre Inicio con dos sesiones trabajando y una que espera
- **THEN** ve el saludo de mañana con su nombre, el resumen y los recuentos «1 te espera», «2 trabajando» y los que estén en reposo

#### Scenario: Saludo desactivado

- **WHEN** el detalle de personalidad «Saludo según la hora» está desactivado
- **THEN** Inicio muestra un título neutro sin saludo

### Requirement: Necesita tu atención

La sección SHALL listar, en este orden:

1. Las sesiones que esperan a la persona, con su título, proyecto, tiempo desde el aviso y, si se conoce, el texto de lo que piden, y la acción «Responder», que abre esa terminal en Terminales.
2. Las sesiones con la marca `[Closed]` que siguen abiertas en el panel, con la acción «Revisar», que abre su terminal.
3. Un resumen de los pendientes vigentes del historial, los sin marcar de la última entrada de cada proyecto visible («N pendientes de ti», con el subtítulo «En la última entrada del historial de cada proyecto»), que lleva a Historial con «Solo con Pendiente de ti» activado y «Incluir pendientes antiguos» desactivado. Los pendientes de entradas anteriores SHALL NOT contar.

Las sesiones que esperan SHALL aparecer y contar aunque su proyecto esté oculto en Ajustes, con una nota «proyecto oculto», con el mismo criterio en la cabecera, el título de la pestaña y el recuento «te espera» de Inicio. Las cerradas que siguen abiertas SHALL ser solo las de proyectos visibles.

Si no hay nada, SHALL mostrar un estado tranquilo.

#### Scenario: Una sesión pide permiso

- **WHEN** Claude pide permiso para ejecutar un comando en una sesión de fitnessia
- **THEN** Inicio muestra esa sesión arriba con el texto del aviso y «Responder» lleva a su terminal

#### Scenario: Sesión que espera en un proyecto oculto

- **WHEN** una sesión de un proyecto oculto en Ajustes pasa a esperar a la persona
- **THEN** aparece en «Necesita tu atención» con la nota «proyecto oculto» y cuenta en el aviso de la cabecera y en el recuento «te espera» de Inicio, mientras el proyecto sigue sin tarjeta

#### Scenario: Pendientes resueltos en una entrada posterior

- **WHEN** una entrada antigua conserva pendientes sin marcar y la última entrada del proyecto no tiene ninguno
- **THEN** Inicio no los cuenta

#### Scenario: Nada pendiente

- **WHEN** no hay sesiones que esperen, ni cerradas abiertas, ni pendientes del historial
- **THEN** la sección muestra que no hay nada que atender

### Requirement: Tarjetas de proyecto por actividad

Inicio SHALL mostrar una tarjeta por proyecto visible, ordenadas por su última actividad, que es la más reciente entre sus sesiones, su historial y su backlog. Cada tarjeta SHALL incluir:

- monograma, nombre, rama actual y tiempo desde la última actividad;
- las sesiones del panel del proyecto con su estado;
- los recuentos de elementos en backlog, por hacer y en curso, y de worktrees;
- el título y el estado del último registro del historial;
- las acciones «Abrir terminales», «Backlog» y «Nueva sesión en este proyecto».

#### Scenario: Ir al backlog de un proyecto

- **WHEN** la persona pulsa «Backlog» en la tarjeta de balanz.io
- **THEN** el panel abre Backlog con balanz.io

### Requirement: Mensaje de la notificación en el estado de sesión

`bin/session-state` SHALL guardar en el archivo de estado, cuando el evento sea una notificación que deja la sesión esperando, el texto del aviso en un campo `message` recortado a 300 caracteres. Al pasar a otro estado, el campo SHALL quedar vacío. El resto del comportamiento del script no cambia.

#### Scenario: Permiso pedido

- **WHEN** llega una notificación de permiso con el texto «Claude needs your permission to use Bash»
- **THEN** el archivo de estado tiene `state: waiting` y `message` con ese texto

### Requirement: Ajustes de nombre y pantalla inicial

Ajustes SHALL incluir «Tu nombre», que se usa en el saludo y que, si está vacío, toma el primer nombre de `git config user.name`, y «Pantalla al abrir», con las opciones Inicio y Terminales. Al abrir el panel sin ruta, SHALL mostrar la pantalla elegida.

#### Scenario: Abrir en Terminales

- **WHEN** la persona elige «Pantalla al abrir: Terminales» y abre la URL del panel sin ruta
- **THEN** el panel muestra Terminales

### Requirement: Estado de la sesión en la cabecera de la terminal

La cabecera de cada terminal del panel SHALL mostrar:

1. El título de la sesión, con su estado y el menú de acciones a la derecha.
2. En una sola línea:
   - el proyecto;
   - la rama o, en un worktree, su nombre y rama;
   - el agente o, en sesiones de Claude con datos, el modelo y el esfuerzo;
   - el tiempo desde que se creó la sesión;
   - a continuación de lo anterior, la barra de contexto con el porcentaje y los tokens usados y disponibles, si hay datos.
3. Solo cuando haya trabajo en curso: chips con el número de subagentes activos, de shells en segundo plano y de artifacts publicados en la sesión. Cada chip SHALL desplegar el detalle: tipo de subagente y desde cuándo, comando de la shell, y enlace y título del artifact.

La barra de contexto SHALL ser neutra por debajo del 50 %, ámbar desde el 50 % y roja desde el 80 %, con el porcentaje en texto y, en rojo, un icono. El color y el icono SHALL decidirse con el porcentaje mostrado (redondeado): 49,6 % se muestra «50 %» y es ámbar; 79,6 %, «80 %» y rojo.

Si los datos llevan más de 15 minutos sin cambiar y la sesión no está trabajando, SHALL mostrarse atenuados y con su antigüedad, sin que el texto pierda contraste (4,5:1).

En columnas estrechas, SHALL ocultar el proyecto, el tiempo y los tokens, y mostrar el trabajo en curso como contadores junto al título.

Los datos de modelo, esfuerzo, contexto y trabajo en curso SHALL obtenerse solo de las sesiones de Claude lanzadas desde el panel. Las demás SHALL mostrar el proyecto, la rama, el agente y el tiempo.

#### Scenario: Sesión de Claude trabajando con subagentes

- **WHEN** una sesión de Claude del panel usa el 19 % del contexto y tiene tres subagentes activos
- **THEN** su cabecera muestra la barra de contexto al 19 % al final de la línea de datos y, debajo, el chip «3 subagentes», que al pulsarlo lista sus tipos y desde cuándo funcionan

#### Scenario: Contexto casi lleno

- **WHEN** el contexto de una sesión pasa del 80 %
- **THEN** la barra y el porcentaje se muestran en rojo con un icono de aviso

#### Scenario: Sesión de Codex

- **WHEN** la persona abre una sesión de Codex en el panel
- **THEN** la cabecera muestra el proyecto, la rama, «codex» y el tiempo, sin barra de contexto ni chips

#### Scenario: Sin trabajo en curso

- **WHEN** una sesión no tiene subagentes, shells en segundo plano ni artifacts
- **THEN** la cabecera ocupa dos filas, sin la fila de chips

### Requirement: Límites de la cuenta y agente por defecto en la cabecera global

La cabecera global del panel SHALL mostrar, en todas las pantallas salvo Ajustes:

- El agente por defecto de las sesiones nuevas, con un menú para cambiarlo, que guarda el mismo ajuste que el diálogo «Nueva sesión» (por debajo de 1024 px, solo con su icono, igual que «Nueva sesión»).
- Los límites de uso de 5 horas y de 7 días de la cuenta, como dos barras con su porcentaje y los mismos umbrales que el contexto (por debajo de 1280 px, solo con el porcentaje, sin barras). Al pulsarlos, SHALL mostrar a qué hora se reinicia cada uno y la antigüedad del dato.

Los límites SHALL tomarse de la sesión de Claude del panel con datos más recientes y SHALL ocultarse si no hay ninguna.

#### Scenario: Consultar cuándo se reinicia el límite

- **WHEN** la persona pulsa los límites con la ventana de 5 horas al 91 %
- **THEN** ve la barra de 5 h en rojo y que se reinicia hoy a las 21:20

#### Scenario: Cambiar el agente por defecto

- **WHEN** la persona elige Codex en el menú del agente por defecto
- **THEN** la cabecera muestra Codex y el diálogo «Nueva sesión» lo propone como agente

### Requirement: Statusline de Claude en las sesiones del panel

Cuando `bin/agent` lance Claude con `JDEV_SURFACE=panel`, SHALL configurar como statusline un script del harness que guarde los datos que recibe en el directorio de estado del panel y no imprima nada. Así la terminal del panel no repite lo que muestra la cabecera.

Con `JDEV_SURFACE=terminal`, `bin/agent` SHALL NOT cambiar la statusline de la persona.

Los datos de subagentes, tareas en segundo plano y artifacts SHALL llegar por hooks de Claude que solo escriben en el directorio de estado y nunca interrumpen al agente.

#### Scenario: Sesión del panel

- **WHEN** la persona abre una sesión de Claude desde el panel
- **THEN** la terminal no muestra la statusline y la cabecera del panel muestra sus datos

#### Scenario: Terminal normal

- **WHEN** la persona lanza `bin/agent` desde una terminal normal
- **THEN** Claude muestra la statusline configurada por la persona, sin cambios

### Requirement: Tooltip de las conversaciones de la barra lateral

Al pasar el ratón por una sesión o una conversación de «Anteriores» de la barra lateral, o al darle el foco con el teclado, el panel SHALL mostrar un tooltip con su título completo, su proyecto, su rama o worktree y su agente.

Si la sesión está viva y tiene datos de la statusline, el tooltip SHALL añadir:

- el modelo y el esfuerzo;
- la barra de contexto con los mismos umbrales que la cabecera de la terminal;
- el tiempo de sesión;
- los subagentes, shells y artifacts en curso.

El tooltip SHALL cerrarse al salir de la fila, al perder el foco o con Esc.

#### Scenario: Título recortado

- **WHEN** la persona pasa el ratón por una sesión cuyo título no cabe en la barra
- **THEN** el tooltip muestra el título completo con su proyecto, rama y agente

#### Scenario: Sesión viva de Claude

- **WHEN** la persona pasa el ratón por una sesión de Claude viva con el contexto al 62 % y dos subagentes
- **THEN** el tooltip muestra también el modelo, el esfuerzo, la barra de contexto en ámbar, el tiempo y «2 subagentes»

### Requirement: Archivar conversaciones de la barra lateral

El menú contextual de las sesiones del panel y de las conversaciones de «Anteriores» SHALL ofrecer «Archivar». Lo archivado SHALL dejar de mostrarse en su proyecto, en «Anteriores» y en «En segundo plano», y SHALL aparecer en una sección «Archivadas (N)» plegable, debajo de «En segundo plano». Esa sección SHALL ocultarse si está vacía.

Desde «Archivadas», la persona SHALL poder abrir una sesión, retomar una conversación y desarchivarlas.

Archivar SHALL NOT terminar la sesión ni cerrar su pestaña. Una sesión archivada que espera a la persona SHALL seguir contando en los avisos de la cabecera, el título de la pestaña e Inicio. En Inicio, las demás sesiones archivadas SHALL NOT contar en los recuentos «trabajando» y «en reposo» ni en las tarjetas de proyecto.

Las conversaciones archivadas SHALL NOT contar en el límite de «Anteriores»: archivar una SHALL dejar aparecer la siguiente. Retomar una conversación archivada SHALL desarchivarla.

La lista de archivadas SHALL guardarse en la configuración del panel y conservarse al reiniciarlo. Las sesiones archivadas que dejan de existir SHALL salir de la lista.

#### Scenario: Archivar una sesión viva

- **WHEN** la persona archiva una sesión de Claude que sigue trabajando
- **THEN** desaparece de su proyecto, aparece en «Archivadas» con su luz de estado y sigue trabajando

#### Scenario: Desarchivar

- **WHEN** la persona elige «Desarchivar» en una conversación de «Archivadas»
- **THEN** vuelve a «Anteriores» de su proyecto

#### Scenario: Archivar deja aparecer la siguiente

- **WHEN** un proyecto tiene más conversaciones que el límite de «Anteriores» y la persona archiva una de ellas
- **THEN** «Anteriores» sigue mostrando el mismo número de conversaciones, con la siguiente en antigüedad

#### Scenario: Retomar una archivada

- **WHEN** la persona retoma una conversación de «Archivadas»
- **THEN** se crea la sesión en el panel y la conversación deja de estar archivada

#### Scenario: Sesión archivada que trabaja

- **WHEN** una sesión archivada está trabajando
- **THEN** Inicio no la cuenta en «trabajando» ni la muestra en la tarjeta de su proyecto

#### Scenario: Sesión archivada que espera

- **WHEN** una sesión archivada pide permiso
- **THEN** la cabecera y la pestaña cuentan «1 sesión te espera» e Inicio la muestra en «Necesita tu atención»

### Requirement: Proyecto por defecto de Worktrees

Al abrir Worktrees sin proyecto en la ruta, el panel SHALL mostrar el primer proyecto visible con worktrees abiertos o, si ninguno tiene, el primer proyecto visible. Backlog y Guías SHALL seguir mostrando el último proyecto usado.

#### Scenario: Un proyecto con worktrees

- **WHEN** la persona abre Proyectos › Worktrees y solo balanz.io tiene worktrees abiertos
- **THEN** se muestran los worktrees de balanz.io

#### Scenario: Ninguno con worktrees

- **WHEN** ningún proyecto tiene worktrees abiertos
- **THEN** se muestran los worktrees del primer proyecto visible

#### Scenario: Lo escogido por defecto no se recuerda

- **WHEN** la persona abre Backlog de ccc, luego Proyectos › Worktrees (que abre bbb) y después Proyectos › Backlog
- **THEN** Backlog muestra ccc

#### Scenario: Backlog no cambia

- **WHEN** la persona abre Proyectos › Backlog sin proyecto en la ruta
- **THEN** se muestra el backlog del último proyecto usado

### Requirement: Seguimiento de subagentes y shells en segundo plano

Desde los desplegables de los chips de subagentes y shells de la cabecera de una terminal, el panel SHALL abrir una pestaña de seguimiento de solo lectura para cada subagente o shell, junto a las de terminal. Si ya está abierta, SHALL activarla.

La pestaña de un subagente SHALL mostrar:

- su descripción;
- su estado y desde cuándo;
- su tipo;
- la sesión que lo lanzó;
- el encargo;
- cada herramienta usada, con un verbo y su objetivo y un resumen del resultado, destacado si falla;
- sus mensajes;
- al terminar, su resultado final.

SHALL NOT mostrar el razonamiento interno.

La pestaña de una shell SHALL mostrar el comando, su estado, la sesión que la lanzó y las últimas 2 000 líneas de su salida como texto plano.

Ambas SHALL actualizarse en directo mientras el elemento sigue en marcha, con la opción «Seguir al final», y SHALL seguir abiertas con el estado «Terminado» cuando acabe.

El panel SHALL leer solo archivos del usuario, dentro de las carpetas de Claude:

- el transcript de subagentes junto al de la sesión;
- la salida de la shell en la ruta anunciada por Claude bajo su directorio temporal.

El panel SHALL hacerlo solo para sesiones del panel. Lo que no encuentre SHALL explicarlo en la vista.

#### Scenario: Ver qué hace un implementer

- **WHEN** la persona pulsa «implementer» en el desplegable de «3 subagentes»
- **THEN** se abre una pestaña con su encargo y la lista en directo de las herramientas que usa y sus mensajes

#### Scenario: Una herramienta falla

- **WHEN** el subagente ejecuta un comando que devuelve error
- **THEN** la línea de ese comando se muestra en rojo con el resumen del error

#### Scenario: Salida de una shell

- **WHEN** la persona pulsa «pnpm dev» en el desplegable de «1 shell»
- **THEN** se abre una pestaña con la salida del comando, que se actualiza sola y baja al final mientras «Seguir al final» está marcado

#### Scenario: El subagente termina

- **WHEN** el subagente seguido termina
- **THEN** la pestaña muestra «Terminado», la hora y su resultado final destacado, y sigue abierta hasta que la persona la cierra

#### Scenario: Archivo no disponible

- **WHEN** el transcript o la salida no existen o están fuera de las carpetas permitidas
- **THEN** la pestaña explica que no hay datos que mostrar, sin servir el archivo


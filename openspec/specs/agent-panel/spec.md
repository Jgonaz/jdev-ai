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

### Requirement: Pantalla Historial con las entradas de todos los proyectos

El panel SHALL ofrecer una pantalla Historial que liste las entradas `.agent/history/*.md` del checkout principal de cada proyecto y del harness, ignorando subcarpetas y archivos que no sean Markdown, ordenadas de más reciente a más antigua y agrupadas por día o, si la persona lo elige, por proyecto. Cada entrada SHALL mostrar hora, proyecto, estado (`finalizada`, `en curso` o `bloqueada`), título y su primer pendiente abierto si lo tiene. La persona SHALL poder filtrar por proyecto, por estado y por «Solo con Pendiente de ti», que deja las entradas con algún pendiente sin marcar. Las entradas con `Fecha:` o `Estado:` fuera del formato SHALL mostrarse con la fecha del nombre o del archivo y un estado desconocido, sin romper la vista. La lista SHALL actualizarse sola cuando cambien los archivos.

#### Scenario: Agrupar por proyecto

- **WHEN** la persona elige la vista «Por proyecto» en la lista
- **THEN** las entradas se agrupan por proyecto con su monograma y su número de entradas, mostrando las tres más recientes de cada uno y «Ver más» para el resto, con los mismos filtros aplicados, y la elección se recuerda

#### Scenario: Ver qué espera de mí

- **WHEN** la persona activa «Solo con Pendiente de ti»
- **THEN** ve solo las entradas con algún pendiente sin marcar, de todos los proyectos

#### Scenario: Entrada nueva

- **WHEN** un agente registra una entrada mientras la pantalla está abierta
- **THEN** aparece en la lista sin recargar

### Requirement: Lector de una entrada

Al elegir una entrada, el panel SHALL mostrar su proyecto, ruta, título, estado y fecha, el bloque «Pendiente de ti» destacado con cada punto y su estado, y el resto de secciones (resumen, decisiones, referencias, continuación recomendada y cualquier otra) pintadas con el visor de Markdown seguro.

#### Scenario: Leer una entrada

- **WHEN** la persona abre una entrada con «Pendiente de ti» y «Continuación recomendada»
- **THEN** ve los pendientes destacados arriba y la continuación al final

### Requirement: Marcar pendientes como hechos

Cada punto de «Pendiente de ti» SHALL poder marcarse como hecho y desmarcarse desde el lector. El panel SHALL marcarlo en el propio archivo como `- [x] <texto> (hecho YYYY-MM-DD)` y, al desmarcarlo, SHALL devolverlo a `- <texto>`, sin tocar el resto de la entrada. Si el archivo cambió desde que se abrió, SHALL rechazar la operación y recargar la entrada. `bin/session-status` SHALL omitir los puntos marcados al mostrar «Pendiente de ti» en el resumen de inicio, y SHALL omitir el apartado si no queda ninguno.

#### Scenario: Pendiente resuelto

- **WHEN** la persona marca como hecho «Reinstalar la app en el iPhone y comprobar el teclado»
- **THEN** el archivo guarda `- [x] Reinstalar la app… (hecho <fecha de hoy>)`, la entrada deja de salir con «Solo con Pendiente de ti» si no le quedan pendientes, y el resumen de inicio del proyecto ya no lo muestra

#### Scenario: Archivo modificado mientras tanto

- **WHEN** un agente actualiza la entrada después de que la persona la abriera y la persona marca un pendiente
- **THEN** el panel no lo marca, avisa y muestra la versión actual

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
3. Un resumen de los pendientes abiertos del historial («N pendientes de ti en M entradas»), que lleva a Historial con «Solo con Pendiente de ti» activado.

Las sesiones que esperan SHALL aparecer y contar aunque su proyecto esté oculto en Ajustes, con una nota «proyecto oculto», con el mismo criterio en la cabecera, el título de la pestaña y el recuento «te espera» de Inicio. Las cerradas que siguen abiertas SHALL ser solo las de proyectos visibles.

Si no hay nada, SHALL mostrar un estado tranquilo.

#### Scenario: Una sesión pide permiso

- **WHEN** Claude pide permiso para ejecutar un comando en una sesión de fitnessia
- **THEN** Inicio muestra esa sesión arriba con el texto del aviso y «Responder» lleva a su terminal

#### Scenario: Sesión que espera en un proyecto oculto

- **WHEN** una sesión de un proyecto oculto en Ajustes pasa a esperar a la persona
- **THEN** aparece en «Necesita tu atención» con la nota «proyecto oculto» y cuenta en el aviso de la cabecera y en el recuento «te espera» de Inicio, mientras el proyecto sigue sin tarjeta

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
- **THEN** el panel abre Proyectos con balanz.io

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


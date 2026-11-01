## ADDED Requirements

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

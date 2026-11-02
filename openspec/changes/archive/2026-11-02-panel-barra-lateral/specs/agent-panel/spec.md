## ADDED Requirements

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

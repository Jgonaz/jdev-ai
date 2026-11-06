## MODIFIED Requirements

### Requirement: La barra lateral muestra sesiones con título y estado

La barra lateral SHALL agrupar las sesiones por proyecto y SHALL mostrar de cada una su título, agente, rama o worktree, tiempo desde el último cambio y estado. Los estados SHALL ser: te espera (el agente necesita una respuesta o un permiso), trabajando, en reposo y hecha (la conversación está marcada como hecha en su estado de conversación o, por compatibilidad, su título lleva la marca antigua `[Closed]`). Los estados SHALL distinguirse por forma y texto además de por color; una conversación hecha SHALL mostrarse con un check y el texto «Hecha», sin tachar el título. Para agentes que no informan del estado, el panel SHALL mostrar solo si la sesión está viva.

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

#### Scenario: Conversación marcada como hecha con la marca antigua

- **WHEN** una conversación tiene el título `[Closed] Alternativas de ejercicios` y no tiene estado de conversación
- **THEN** el panel la muestra como «Hecha» con el título `Alternativas de ejercicios`

### Requirement: Renombrar sesiones desde el panel

El panel SHALL permitir renombrar una sesión desde un menú contextual (clic derecho o teclado) de la barra lateral y de las pestañas, con un título de hasta 80 caracteres sin caracteres de control. Para una sesión de Claude con transcript dentro del directorio de proyectos de Claude, el panel SHALL añadir al transcript una línea `custom-title` con el mismo formato que `bin/session-title`, sin añadir ni conservar la marca `[Closed]`, y SHALL rechazar un transcript fuera de ese directorio. Para el resto, el panel SHALL guardar el título en la propia sesión de tmux. El título nuevo SHALL mostrarse sin recargar. El panel SHALL NOT prohibir un título que empiece por `[Closed]`: lo guardará como texto y el diálogo SHALL avisar de que el panel seguirá leyéndolo como marca antigua de «hecha».

#### Scenario: Renombrar una sesión de Claude

- **WHEN** la persona elige «Renombrar…» en el menú contextual de una sesión de Claude y guarda «Revisar login»
- **THEN** el transcript recibe una línea `custom-title` con ese título y la barra lateral y la pestaña lo muestran

#### Scenario: Renombrar una sesión sin transcript

- **WHEN** la persona renombra una sesión de Codex
- **THEN** el panel guarda el título en la sesión de tmux y lo muestra en lugar del título por defecto

#### Scenario: Renombrar una conversación hecha con la marca antigua

- **WHEN** la persona renombra una conversación cuyo título es `[Closed] Revisar login` y que no tiene estado de conversación
- **THEN** el transcript recibe el título nuevo sin la marca, la conversación deja de contar como hecha y el diálogo lo advierte antes de guardar

#### Scenario: Título que empieza por la marca antigua

- **WHEN** la persona guarda el título `[Closed] Notas`
- **THEN** el panel lo guarda como texto y el diálogo avisa de que el panel lo leerá como conversación hecha

### Requirement: Necesita tu atención

La sección SHALL listar, en este orden:

1. Las sesiones que esperan a la persona, con su título, proyecto, tiempo desde el aviso y, si se conoce, el texto de lo que piden, y la acción «Responder», que abre esa terminal en Terminales.
2. En un apartado «Hechas que siguen abiertas», las sesiones marcadas como hechas que siguen abiertas en el panel, con cuándo y quién las marcó y su nota si la tienen, con la acción «Revisar», que abre su terminal, y la acción «Terminar», que pide confirmación y termina la sesión.
3. Un resumen de los pendientes vigentes del historial, los sin marcar de la última entrada de cada proyecto visible («N pendientes de ti», con el subtítulo «En la última entrada del historial de cada proyecto»), que lleva a Historial con «Solo con Pendiente de ti» activado y «Incluir pendientes antiguos» desactivado. Los pendientes de entradas anteriores SHALL NOT contar.

Las sesiones que esperan SHALL aparecer y contar aunque su proyecto esté oculto en Ajustes, con una nota «proyecto oculto», con el mismo criterio en la cabecera, el título de la pestaña y el recuento «te espera» de Inicio. Las hechas que siguen abiertas SHALL ser solo las de proyectos visibles y no archivadas.

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

#### Scenario: Hecha que sigue abierta

- **WHEN** una sesión de un proyecto visible está marcada como hecha y sigue viva en el panel
- **THEN** Inicio la muestra en «Hechas que siguen abiertas» con «Revisar» y «Terminar», y «Revisar» abre su terminal

#### Scenario: Terminar una hecha

- **WHEN** la persona pulsa «Terminar» en una conversación hecha y confirma
- **THEN** el panel termina su sesión de tmux y la fila desaparece de «Hechas que siguen abiertas»

#### Scenario: Cancelar el cierre

- **WHEN** la persona pulsa «Terminar» y cancela el diálogo
- **THEN** la sesión sigue viva y en la lista

#### Scenario: Nada pendiente

- **WHEN** no hay sesiones que esperen, ni hechas abiertas, ni pendientes del historial
- **THEN** la sección muestra que no hay nada que atender

## ADDED Requirements

### Requirement: Estado de conversación hecha o abierta

El harness SHALL guardar, fuera del título, si cada conversación está abierta o hecha, con la fecha, quién la marcó (la persona o el agente) y una nota opcional, en el directorio de estado local del usuario.

El agente SHALL marcarla con `bin/session-done` (o reabrirla con `--open`) en lugar de renombrarla. Cuando la persona vuelva a escribir en una conversación hecha abierta con `bin/agent`, un hook SHALL reabrirla.

El panel SHALL ofrecer «Marcar como hecha» y «Reabrir» en el menú contextual de las sesiones del panel, de sus pestañas y de las conversaciones de «Anteriores». El tooltip de una conversación hecha SHALL indicar cuándo y quién la marcó y su nota. Marcar como hecha SHALL NOT terminar ni archivar la sesión.

#### Scenario: La persona marca una conversación como hecha

- **WHEN** la persona elige «Marcar como hecha» en el menú de una sesión del panel
- **THEN** la sesión se muestra con el check «Hecha», su título no cambia y el tooltip dice «por ti»

#### Scenario: El agente cierra tras integrar

- **WHEN** el agente ejecuta `bin/session-done` al integrar una feature
- **THEN** el panel muestra la conversación como hecha «por el agente» y el título en `/resume` no lleva `[Closed]`

#### Scenario: Reabrir escribiendo

- **WHEN** la persona escribe en una conversación hecha abierta con `bin/agent`
- **THEN** la conversación vuelve a estar abierta

#### Scenario: Reabrir una marcada con la marca antigua

- **WHEN** la persona elige «Reabrir» en una conversación cuyo título empieza por `[Closed] `
- **THEN** queda abierta y su título guardado deja de llevar la marca

#### Scenario: Ocultar hechas

- **WHEN** la persona activa «Ocultar hechas» en la barra lateral
- **THEN** dejan de verse las sesiones y conversaciones hechas, salvo las que esperan a la persona

#### Scenario: Preferencia anterior «Ocultar cerradas»

- **WHEN** el navegador guardaba la preferencia «Ocultar cerradas» activada de una versión anterior
- **THEN** «Ocultar hechas» aparece activada, sin que la persona tenga que volver a elegirla

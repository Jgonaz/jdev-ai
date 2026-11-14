## MODIFIED Requirements

### Requirement: Vista chat de una terminal

Cada pestaña de terminal SHALL tener un conmutador entre dos vistas: «Terminal», que es la actual, y «Chat». La vista elegida SHALL recordarse por pestaña. Al alternar, la terminal SHALL conservar su conexión y su scroll.

La vista chat SHALL construirse a partir de la transcripción de la sesión de Claude. En ella:

1. Se SHALL mostrar los mensajes de la persona y las respuestas del agente. Las respuestas se SHALL pintar con Markdown saneado.
2. Las herramientas ejecutadas seguidas se SHALL agrupar en un desplegable, cerrado por defecto, que muestre cada acción con su resultado y marque los errores.
3. La vista se SHALL actualizar en directo mientras la transcripción crece.
4. Se SHALL poder buscar texto en toda la conversación, con resaltado de las coincidencias y navegación entre ellas. Los desplegables que contienen una coincidencia se SHALL abrir.
5. Se SHALL poder escribir y enviar un mensaje, también de varias líneas, a la sesión.
6. Cuando el agente espere una respuesta en la terminal que el chat no sepa contestar, se SHALL mostrar un aviso con un enlace a la vista terminal.
7. Los comandos (`/nombre args`) enviados o escritos SHALL mostrarse como tales en la conversación, con su salida local si la tiene.
8. La respuesta de `/btw`, que Claude no guarda en la transcripción, SHALL mostrarse en el chat como una respuesta aparte que no forma parte de la conversación, y la ventana que abre en la terminal SHALL cerrarse.
9. Antes de enviar, si la terminal tiene abierta una ventana o un menú de Claude, el mensaje SHALL no enviarse y la vista SHALL explicar que hay que cerrarlo en la terminal, para que no se pierda.
10. Mientras Claude espere la respuesta a una pregunta (`AskUserQuestion`), el chat SHALL mostrar una tarjeta con cada pregunta, su cabecera y sus opciones con su descripción, y SHALL permitir contestarla: una opción en las de selección simple, varias en las de selección múltiple y un texto libre en cualquiera de ellas. La respuesta SHALL enviarse a la terminal de una vez, cuando estén contestadas todas las preguntas.
11. Mientras Claude espere un permiso para usar una herramienta, el chat SHALL mostrar la herramienta, lo que quiere hacer con ella (comando, archivo o URL) y las opciones que ofrece la terminal, y SHALL permitir elegir una.
12. Para contestar, el panel SHALL comprobar en la pantalla de la terminal que la pregunta o el permiso siguen abiertos y que cada paso queda como se espera. Si algo no coincide, SHALL dejar de pulsar teclas, no SHALL dar la respuesta por enviada y SHALL mostrar el aviso con el enlace a la terminal.
13. Cuando la pregunta tenga respuesta, se conteste desde el chat o desde la terminal, la tarjeta SHALL quedar en la conversación como respondida, con lo elegido. Un permiso contestado SHALL dejar de mostrarse como pendiente.

En las sesiones que no son de Claude, o que aún no tienen transcripción, el conmutador SHALL estar desactivado e indicar el motivo.

Lo que se muestra de la transcripción SHALL pintarse como texto o como Markdown saneado, nunca como HTML crudo.

#### Scenario: Alternar a chat y volver

- **WHEN** la persona pulsa «Chat» en una sesión de Claude y después «Terminal»
- **THEN** ve la conversación y, al volver, la terminal sigue conectada y en el mismo punto

#### Scenario: Recordar la vista

- **WHEN** la persona deja una pestaña en «Chat» y recarga el panel
- **THEN** esa pestaña se abre en «Chat» y las demás conservan su vista

#### Scenario: Herramientas plegadas

- **WHEN** el agente ejecuta varias herramientas seguidas entre dos mensajes
- **THEN** aparecen agrupadas en un desplegable cerrado que indica cuántas son, y las que fallaron se marcan

#### Scenario: Buscar un texto antiguo

- **WHEN** la persona busca una palabra que aparece al principio de una conversación larga y en el resultado de una herramienta
- **THEN** ve el número de coincidencias, puede saltar entre ellas y el desplegable que la contiene se abre

#### Scenario: En directo

- **WHEN** el agente responde mientras la vista chat está abierta
- **THEN** la respuesta aparece sin recargar, y la vista baja sola si la persona estaba al final

#### Scenario: Enviar un mensaje de varias líneas

- **WHEN** la persona escribe un mensaje de dos líneas en la caja del chat y lo envía
- **THEN** el agente lo recibe como un único mensaje y aparece en la conversación

#### Scenario: El agente espera en la terminal

- **WHEN** la terminal muestra un menú o un diálogo de Claude que el chat no reconoce
- **THEN** la vista chat muestra un aviso con un enlace que cambia a la vista terminal

#### Scenario: Contestar una pregunta desde el chat

- **WHEN** Claude pregunta con dos preguntas, una de selección simple y otra de selección múltiple, y la persona elige una opción en la primera y dos en la segunda desde el chat y envía
- **THEN** Claude recibe esas respuestas como si se hubieran dado en la terminal y la tarjeta queda en el chat como respondida, con lo elegido

#### Scenario: Respuesta con texto libre

- **WHEN** la persona escribe su propia respuesta en lugar de elegir una opción y envía
- **THEN** Claude recibe ese texto como respuesta a esa pregunta

#### Scenario: Contestada desde la terminal

- **WHEN** hay una pregunta pendiente en el chat y la persona la contesta en la terminal
- **THEN** la tarjeta del chat pasa a respondida sin recargar y ya no se puede enviar

#### Scenario: La pantalla no coincide

- **WHEN** la persona envía una respuesta y la terminal no muestra el menú que se esperaba, por ejemplo porque se ha cerrado o ha cambiado de pestaña
- **THEN** el panel no pulsa más teclas, la tarjeta sigue pendiente y el chat muestra el aviso con el enlace a la terminal

#### Scenario: Permiso desde el chat

- **WHEN** Claude pide permiso para ejecutar un comando y la persona elige «Sí» en el chat
- **THEN** el chat muestra el comando antes de elegir, Claude lo ejecuta y el permiso deja de mostrarse como pendiente

#### Scenario: Pregunta al margen con /btw

- **WHEN** la persona envía `/btw ¿qué archivo estábamos tocando?` desde el chat
- **THEN** la respuesta aparece en el chat marcada como pregunta al margen, la ventana de la terminal se cierra y el siguiente mensaje se envía con normalidad y el portapapeles del sistema no cambia

#### Scenario: Comando con salida

- **WHEN** la persona envía `/goal close` o `/compact`
- **THEN** el chat muestra el comando y su salida local

#### Scenario: Comando que abre un menú

- **WHEN** la persona envía un comando que abre un menú en la terminal, como `/model` sin argumentos
- **THEN** el chat avisa de que el comando espera en la terminal, con un enlace a esa vista, y no envía más mensajes hasta que se cierre

#### Scenario: Sesión de Codex

- **WHEN** la pestaña es una sesión de Codex o una terminal sin agente
- **THEN** el conmutador está desactivado y su ayuda explica que el chat solo está disponible para Claude

### Requirement: El estado de sesión se registra fuera del panel

El harness SHALL proporcionar `bin/session-state`, que el lanzador registra como hook de Claude Code y que escribe el estado de la sesión, su identificador, proyecto, agente, ruta del transcript y sesión de tmux en un archivo por sesión bajo el directorio de estado del usuario. El script SHALL funcionar aunque el panel no esté arrancado, SHALL NOT bloquear ni alterar el turno del agente ante un error y SHALL escribir el archivo de forma atómica.

Mientras Claude espera la respuesta a una pregunta (`AskUserQuestion`) o un permiso de herramienta, `bin/session-state` SHALL guardar, en un archivo aparte por sesión y de forma atómica, la pregunta completa o la herramienta con su entrada, tal como las da el hook, y SHALL borrarlo cuando la herramienta termina, la persona escribe, el turno acaba o la sesión termina.

#### Scenario: Panel detenido

- **WHEN** una sesión cambia de estado mientras el panel no está en marcha
- **THEN** el archivo de estado se actualiza y el panel lo muestra correctamente al arrancar

#### Scenario: Error al escribir el estado

- **WHEN** `bin/session-state` no puede escribir su archivo
- **THEN** termina sin salida ni código de error que interrumpa al agente

#### Scenario: Pregunta pendiente antes de llegar a la transcripción

- **WHEN** Claude lanza una pregunta y la transcripción todavía no la trae
- **THEN** el chat muestra la tarjeta de la pregunta y permite contestarla

#### Scenario: Permiso sin herramienta en el aviso

- **WHEN** Claude pide permiso para ejecutar un comando y el aviso solo dice «Claude needs your permission»
- **THEN** el chat muestra la herramienta y el comando antes de elegir

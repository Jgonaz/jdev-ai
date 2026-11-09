## ADDED Requirements

### Requirement: Vista chat de una terminal

Cada pestaña de terminal SHALL tener un conmutador entre dos vistas: «Terminal», que es la actual, y «Chat». La vista elegida SHALL recordarse por pestaña. Al alternar, la terminal SHALL conservar su conexión y su scroll.

La vista chat SHALL construirse a partir de la transcripción de la sesión de Claude. En ella:

1. Se SHALL mostrar los mensajes de la persona y las respuestas del agente. Las respuestas se SHALL pintar con Markdown saneado.
2. Las herramientas ejecutadas seguidas se SHALL agrupar en un desplegable, cerrado por defecto, que muestre cada acción con su resultado y marque los errores.
3. La vista se SHALL actualizar en directo mientras la transcripción crece.
4. Se SHALL poder buscar texto en toda la conversación, con resaltado de las coincidencias y navegación entre ellas. Los desplegables que contienen una coincidencia se SHALL abrir.
5. Se SHALL poder escribir y enviar un mensaje, también de varias líneas, a la sesión.
6. Cuando el agente espere una respuesta en la terminal, se SHALL mostrar un aviso con un enlace a la vista terminal.
7. Los comandos (`/nombre args`) enviados o escritos SHALL mostrarse como tales en la conversación, con su salida local si la tiene.
8. La respuesta de `/btw`, que Claude no guarda en la transcripción, SHALL mostrarse en el chat como una respuesta aparte que no forma parte de la conversación, y la ventana que abre en la terminal SHALL cerrarse.
9. Antes de enviar, si la terminal tiene abierta una ventana o un menú de Claude, el mensaje SHALL no enviarse y la vista SHALL explicar que hay que cerrarlo en la terminal, para que no se pierda.

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

- **WHEN** el agente pide un permiso
- **THEN** la vista chat muestra un aviso con un enlace que cambia a la vista terminal

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

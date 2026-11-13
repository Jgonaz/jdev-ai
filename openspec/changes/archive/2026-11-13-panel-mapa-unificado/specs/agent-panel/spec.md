## MODIFIED Requirements

### Requirement: Mapa de actividad de una sesión

El panel derecho de Terminales SHALL ser un solo panel de la sesión activa, sin selector de vistas. Mostrará, por este orden, el nombre de la sesión y su agente, el mapa de actividad, la línea de lo que se ejecuta en ese momento y dos desplegables: «Actividad reciente (N)» y «Sesión». Los dos empezarán abiertos y el panel SHALL recordar si cada uno está abierto. El panel SHALL empezar a la altura de las tarjetas de terminal, bajo la barra de pestañas. Con una pestaña de seguimiento activa, el panel SHALL ser el de la sesión que la lanzó.

«Sesión» SHALL mostrar el proyecto, la rama, el worktree, el agente y la ruta del proyecto, el comando para adjuntar la sesión desde otra terminal con un botón para copiarlo, y los enlaces al backlog y al historial del proyecto.

El mapa SHALL mostrar un núcleo central y las estaciones Tú, Modelo, Memoria, Archivos, Shell, Red, Navegador, Agentes y Skills, y SHALL reflejar en directo la conversación de la sesión:

- cada herramienta SHALL lanzar un pulso del núcleo a su estación al empezar y de vuelta al terminar, y SHALL marcarse en rojo si falla o se rechaza;
- mientras una llamada siga en marcha, su estación SHALL indicar cuánto lleva;
- varias llamadas simultáneas en una estación SHALL mostrar su número;
- los errores SHALL dejar en su estación un contador rojo hasta el siguiente mensaje de la persona;
- el radio de cada estación SHALL ser más grueso cuanto más se haya usado en la sesión;
- una ruta SHALL unir las últimas estaciones visitadas, sin contar Modelo, y SHALL desvanecerse cuando el trabajo se detenga;
- un anillo alrededor del núcleo SHALL mostrar el porcentaje de contexto, con los mismos umbrales de color que la barra de la cabecera;
- cada subagente activo SHALL verse como un punto en la estación Agentes.

«Actividad reciente» SHALL mostrar las últimas 16 filas de actividad, con su estado (en marcha, hecha o fallida) y su duración. Las llamadas terminadas y consecutivas en una misma estación SHALL agruparse en una fila. El mapa SHALL seguir actualizándose aunque el desplegable esté cerrado.

Las etiquetas SHALL mostrar solo nombres (archivo, host de una URL, nombre del comando o de la herramienta), nunca contenidos.

El mapa SHALL usar los colores del tema activo. Con movimiento reducido, SHALL prescindir de pulsos, desplazamientos y giros, y conservar los encendidos y los fundidos. SHALL NOT animarse mientras no sea visible ni cuando no haya nada en movimiento.

El mapa SHALL obtenerse solo de la conversación que el panel ya lee para la vista chat, y solo para sesiones de Claude lanzadas desde el panel. En las demás, el panel SHALL mostrar una línea con el motivo y la información de «Sesión» a la vista, sin desplegable. Sin terminal activa, SHALL mostrar solo un aviso.

#### Scenario: El agente edita un archivo

- **WHEN** la sesión activa ejecuta Edit sobre `src/App.tsx`
- **THEN** un pulso va del núcleo a Archivos, la fila «Edit App.tsx» aparece como en marcha y, al terminar, el pulso vuelve y la fila muestra su duración

#### Scenario: Un comando falla

- **WHEN** un comando de Bash devuelve error
- **THEN** el pulso y la fila se muestran en rojo y la estación Shell queda con un contador rojo hasta el siguiente mensaje de la persona

#### Scenario: Comando de red

- **WHEN** la sesión ejecuta `gh pr view 12`
- **THEN** el pulso va a Red y la fila nombra el comando `gh`, sin argumentos sensibles

#### Scenario: Subagentes en marcha

- **WHEN** la sesión lanza dos subagentes en paralelo
- **THEN** la estación Agentes muestra `×2` y dos puntos que siguen ahí hasta que cada subagente termina

#### Scenario: Movimiento reducido

- **WHEN** el sistema pide movimiento reducido y la sesión lee un archivo
- **THEN** la estación Archivos y su radio se encienden y se apagan sin pulsos que viajen

#### Scenario: Sesión de Codex

- **WHEN** la sesión activa es de Codex
- **THEN** el panel explica en una línea que el mapa solo está disponible para sesiones de Claude del panel y muestra a la vista el proyecto, la rama, el comando para adjuntar y los enlaces

#### Scenario: Ver la actividad y la sesión

- **WHEN** la persona cierra «Sesión» y recarga el panel
- **THEN** «Sesión» sigue cerrado, «Actividad reciente (11)» sigue abierto con las 11 filas y el mapa se mantiene arriba

#### Scenario: Sesión retomada

- **WHEN** la persona abre el mapa de una sesión que ya llevaba trabajo
- **THEN** el mapa muestra los radios y las últimas filas reconstruidos desde la conversación, sin pulsos de lo que ya terminó

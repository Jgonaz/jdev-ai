## Purpose

Panel gráfico local del harness para lanzar, ver y usar en un solo sitio las terminales de agente de todos los proyectos, con su estado, título y ajustes visuales.

## ADDED Requirements

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

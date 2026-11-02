## Why

La barra lateral de Terminales se llena de sesiones y conversaciones que ya no interesan ver y no hay forma de apartarlas sin terminarlas. Los títulos largos salen recortados y, para ver el estado de una sesión, hay que abrirla. Además, al abrir Worktrees se muestra el último proyecto usado, cuando la persona prefiere empezar por un proyecto con worktrees abiertos.

## What Changes

- **Tooltip en la barra lateral**: al pasar el ratón (o con el foco del teclado) por una sesión o una conversación de «Anteriores» se muestra su título completo y dónde está (proyecto, rama o worktree, agente). Si la sesión está viva, añade los datos de la cabecera de la terminal (`panel-statusline`): modelo y esfuerzo, barra de contexto, tiempo y trabajo en curso.
- **Archivar**:
  - «Archivar» en el menú contextual de las sesiones del panel (vivas o terminadas) y de las conversaciones de «Anteriores».
  - Lo archivado sale de su proyecto y de «En segundo plano» y pasa a una sección nueva, «Archivadas (N)», plegable y debajo de «En segundo plano». Desde ahí se abre o retoma y se desarchiva.
  - Una sesión viva archivada sigue funcionando y, si espera a la persona, sigue avisando en la cabecera e Inicio. En Inicio no cuenta como «trabajando» ni «en reposo», ni en las tarjetas de proyecto.
  - Las conversaciones archivadas no gastan la cuota de «Anteriores»: archivar deja aparecer las siguientes.
  - Retomar una conversación archivada la desarchiva.
  - La lista se guarda en la configuración del panel y sobrevive a los reinicios.
- **Worktrees por defecto**: al abrir Proyectos › Worktrees sin proyecto en la ruta, se muestra el primer proyecto visible con worktrees abiertos o, si ninguno tiene, el primero. Backlog y Guías siguen con el último proyecto usado.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade el tooltip y el archivado en la barra lateral, y cambia el proyecto por defecto de Worktrees.

## Impact

- Panel: archivo `~/.config/jdev-ai/archived.json` (respeta `XDG_CONFIG_HOME`) y una API para archivar y desarchivar; marca de archivado en las sesiones y en las conversaciones recientes; barra lateral, menú contextual, Inicio y pantalla Worktrees.
- Depende de `panel-statusline` para los datos del tooltip; sin esos datos, el tooltip muestra solo título y lugar.
- Sin dependencias nuevas. No cambia nada en el harness ni en los proyectos.

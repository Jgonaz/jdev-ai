## Why

La terminal de una sesión mezcla los mensajes con las herramientas, los diffs y la interfaz del agente. Cuesta leerla de pasada y buscar algo que se dijo antes. La persona quiere alternar, en cada terminal, entre la vista actual y una vista de chat más agradable, con búsqueda, que solo muestre lo que se escriben ella y el agente y deje el trabajo plegado.

## What Changes

- **Conmutador «Terminal / Chat»** en la cabecera de cada pestaña de terminal. La vista elegida se recuerda por pestaña.
- **Vista chat** de las sesiones de Claude, construida a partir de su transcripción:
  - los mensajes de la persona y las respuestas del agente, estas con Markdown;
  - las herramientas que se ejecutan seguidas, agrupadas en un desplegable con su resultado y sus errores;
  - búsqueda dentro de toda la conversación, con resaltado y navegación entre coincidencias;
  - se actualiza en directo mientras el agente trabaja;
  - una caja para escribir al agente sin salir de la vista;
  - los comandos de Claude Code (`/goal close`) con su salida local, y la respuesta de `/btw` como un bloque aparte que no forma parte de la conversación;
  - si el agente espera una respuesta que solo se puede dar en la terminal (un permiso o un menú), un aviso con un enlace a esa vista; con una ventana o un menú abiertos no se envían mensajes, para no perderlos.
- **Codex y las terminales sin agente:** el conmutador sale desactivado y explica por qué. La primera versión solo cubre Claude.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade la vista chat de una terminal.

## Impact

- **Servidor del panel:**
  - lectura de la conversación principal de una sesión, ampliando el parser de seguimiento;
  - `GET /api/sessions/:nombre/conversation`;
  - `POST /api/sessions/:nombre/input`, que pega el texto en la sesión de tmux;
  - disponibilidad del chat en la información de cada sesión.
- **Cliente:**
  - conmutador en la cabecera del pane;
  - componente de la vista chat;
  - preferencia de vista por pestaña.
- Sin dependencias nuevas: el Markdown se pinta con `marked`, que el panel ya usa.
- No cambia nada fuera del panel.

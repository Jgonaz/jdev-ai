## Why

El panel derecho de Terminales obliga a elegir entre «Contexto» y «Mapa» con un selector. La persona prefiere tener el mapa siempre en primer plano. Además, casi todo lo que muestra Contexto (proyecto, rama, agente) ya está en la cabecera de la terminal, así que no justifica una vista aparte.

## What Changes

- **Un solo panel derecho**, sin el selector «Contexto | Mapa». Arriba van el mapa y la línea de «ahora», siempre visibles.
- **«Actividad reciente (N)» pasa a un desplegable** bajo el mapa, abierto por defecto. Su estado (abierto o cerrado) se recuerda.
- **«Sesión» pasa a otro desplegable**, también abierto por defecto y con el estado recordado. Recoge lo que mostraba Contexto: proyecto, rama, worktree, agente y ruta, el comando para adjuntar con «Copiar comando», y los enlaces «Ver backlog» e «Historial del proyecto».
- **En sesiones sin mapa** (Codex, terminal sin agente o sesión de Claude sin conversación disponible), el panel muestra la sesión abierta con una línea que explica por qué no hay mapa, sin el recuadro grande. Sin terminal activa, solo se muestra el aviso.
- El panel derecho empieza a la altura de las tarjetas de terminal, bajo la barra de pestañas.
- Se retira la preferencia `rightView`, que ya no tiene uso.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: el requisito «Mapa de actividad de una sesión» deja de hablar del selector y define el panel unificado y sus desplegables.

## Impact

- **Cliente del panel:** `ContextPanel`, `MapPanel` y `ActivityMap` (la lista pasa a un desplegable), `RightViewSwitch` (se elimina), preferencias de `workspace.ts`, estilos y sus tests.
- **Servidor:** sin cambios.
- **Documentación:** `README.md` y `README.en.md`.
- Sin dependencias nuevas.

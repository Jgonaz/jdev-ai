## Why

El panel ya tiene Terminales, Proyectos, Historial y Ajustes, pero para saber qué hacer al abrirlo hay que recorrer varias pantallas: qué sesión espera, qué proyecto tiene trabajo por hacer o qué se quedó pendiente. La pantalla Inicio del diseño aprobado lo resume todo en una vista y completa el panel.

## What Changes

- Pantalla **Inicio** del panel gráfico (hasta ahora «Próximamente»), según el diseño aprobado (artboard «Inicio — todos los proyectos» de https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU):
  - **Saludo** según la hora con tu nombre (de Ajustes o, si no hay, del nombre de Git) y un resumen de proyectos, sesiones y worktrees. Los chips de sesiones que te esperan, trabajando y en reposo se pueden pulsar.
  - **Necesita tu atención:**
    - sesiones que te esperan, con lo que piden y «Responder», que lleva a su terminal;
    - sesiones cerradas (`[Closed]`) que siguen abiertas, con «Revisar»;
    - pendientes abiertos del historial, con acceso a Historial filtrado.
  - **Proyectos ordenados por actividad:** tarjetas con monograma, rama, última actividad, sesiones del panel, recuentos de backlog, por hacer, en curso y worktrees, y último registro del historial. Accesos a sus terminales, a su backlog y a una sesión nueva.
  - **Actividad reciente:** las últimas entradas del historial, con «Ver todo el historial».
- **Mensaje de la notificación:** `bin/session-state` guarda el texto de la última notificación de Claude (por ejemplo, el permiso que pide), recortado, para mostrarlo en «Necesita tu atención».
- **Ajustes:** «Tu nombre» para el saludo y «Pantalla al abrir» (Inicio o Terminales).
- Con esto ya no queda ninguna pantalla «Próximamente».

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade la pantalla Inicio, el mensaje de notificación en el estado de sesión y los ajustes de nombre y pantalla inicial.

## Impact

- Panel: endpoint agregado de resumen (proyectos con recuentos de backlog, worktrees, última actividad, último registro y pendientes del historial) que reutiliza los módulos de backlog e historial; pantalla Inicio y dos ajustes nuevos.
- Harness: `bin/session-state` añade el campo `message` en las notificaciones; `bin/check` lo prueba.
- Solo lectura: Inicio no escribe en los proyectos ni en el historial.
- Sin dependencias nuevas.

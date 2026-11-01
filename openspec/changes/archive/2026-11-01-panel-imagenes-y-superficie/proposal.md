## Why

En la terminal de WSL no se pueden ver imágenes ni pegarlas para el agente, así que capturas de QA, imágenes generadas o pantallazos del móvil obligan a salir a otra herramienta. Además, el agente no sabe si la persona le habla desde el panel gráfico o desde una terminal, y no puede adaptar cómo le enseña o le pide imágenes.

## What Changes

- **Ver imágenes en el panel**: las rutas de imagen que aparecen en una terminal se vuelven clicables y se abren en un visor lateral con zoom, ajuste, copiar ruta, abrir en pestaña y tira de imágenes de esa terminal.
- **Adjuntar imágenes al agente**: pegar o arrastrar una imagen sobre una terminal la guarda en una carpeta del usuario y escribe su ruta en el prompt; avisos de imagen adjuntada o rechazada.
- **Servir archivos de imagen**: endpoint protegido por token que solo entrega imágenes dentro de carpetas permitidas, con límite de tamaño, y endpoint de subida con límite y tipos permitidos. Limpieza de subidas antiguas.
- **Superficie de trabajo**: `bin/agent` exporta `JDEV_SURFACE` (`panel` en las sesiones que crea el panel, `terminal` en el resto) y, en Claude Code, un hook de inicio y reanudación inyecta en el contexto del agente dónde está trabajando la persona.
- **Regla nueva** `rules/surface.md`, enlazada desde `AGENTS.md`: qué cambia para el agente en el panel y en la terminal (cómo mostrar imágenes y cómo recibirlas).
- Diseño: artboards «Imágenes — visor lateral» y «Imágenes — adjuntar al agente» del lienzo aprobado (https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade el visor de imágenes, la adjunción de imágenes y la indicación de superficie a las sesiones que crea el panel.

## Impact

- Panel: nuevos endpoints `GET /api/image` y `POST /api/uploads`, proveedor de enlaces en xterm.js, visor y avisos en el cliente, variable `JDEV_SURFACE=panel` al crear sesiones.
- Harness: `bin/agent` (exporta `JDEV_SURFACE` y registra el hook de contexto), `bin/session-status` (salida de contexto para el agente), `bin/check`, `rules/surface.md`, `AGENTS.md`, `rules/README.md` y los README.
- Datos locales nuevos: `${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/uploads/`.
- Seguridad: el servidor pasa a leer archivos de imagen del disco; se acota por lista de carpetas permitidas, extensión, tamaño y token.

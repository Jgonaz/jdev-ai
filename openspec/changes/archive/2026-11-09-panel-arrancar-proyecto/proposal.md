## Why

Para probar un proyecto mientras se trabaja hay que abrir una terminal, ir a su carpeta y lanzar su servidor de desarrollo, y después acordarse de pararlo. La persona quiere arrancar y parar cada proyecto con un botón desde la barra lateral y dejarlo en segundo plano.

## What Changes

- **Botón ▶ / ■ en cada proyecto** de la barra lateral, junto al «+»:
  - **▶ Arrancar:** crea una terminal sin agente en la carpeta principal del proyecto, escribe y ejecuta su comando de arranque dentro de la shell, y la abre en una pestaña. Al cerrar la pestaña sigue en «En segundo plano».
  - **■ Parar:** manda `Ctrl+C` y, si la terminal sigue con el proceso vivo pasados unos segundos, termina la sesión.
  - La terminal se titula «dev · <proyecto>» y el botón indica que está en marcha. Solo hay una por proyecto.
- **Comando de arranque:**
  - Por defecto, el script `dev` del `package.json`, con el gestor que indique el lockfile (`pnpm dev`, `npm run dev`, `yarn dev` o `bun dev`).
  - Un comando propio por proyecto en Ajustes › Proyectos, que tiene prioridad.
  - Sin ninguno de los dos, el botón sale desactivado con un aviso que lleva a Ajustes.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: añade arrancar y parar el servidor de desarrollo de cada proyecto.

## Impact

- **Servidor del panel:**
  - detección del comando de arranque;
  - ajuste `run` por proyecto;
  - API para arrancar y parar;
  - marca `@jdev_run` en la sesión de tmux para reconocer la terminal de arranque.
- **Cliente:** botón en la barra lateral, campo en Ajustes › Proyectos y estado «en marcha».
- Sin dependencias nuevas. No cambia nada en los proyectos ni en el harness fuera del panel.

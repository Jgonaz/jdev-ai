## Context

- El panel ya crea terminales sin agente (`agent: shell`): la shell de login en la carpeta del proyecto, sin estado de hooks ni avisos (`server/tmux.ts`, `planSession`).
- La barra lateral tiene, junto al nombre de cada proyecto, un «+» que abre «Nueva sesión» (`Sidebar.tsx`).
- Los ajustes por proyecto viven en `settings.projects[id]` (`mono`, `color`, `visible`; `server/settings.ts`, `shared/settings-schema.ts`) y se editan en Ajustes › Proyectos.

## Goals / Non-Goals

**Goals:**

- Arrancar y parar el servidor de desarrollo de un proyecto con un clic, dejándolo en segundo plano, sin perder la salida.

**Non-Goals:**

- Gestionar puertos, varios comandos por proyecto, worktrees o arrancar al abrir el panel.
- Detectar comandos fuera de `package.json` (Makefile, Python…). Para eso está el comando propio.

## Decisions

### Comando de arranque

- **Detección**, que hace el servidor al pedirla:
  - lee `package.json` de la carpeta principal del proyecto (archivo regular, máximo 1 MiB, JSON válido) y comprueba que tiene `scripts.dev`;
  - el gestor sale del lockfile: `pnpm-lock.yaml` → `pnpm dev`; `bun.lockb`/`bun.lock` → `bun dev`; `yarn.lock` → `yarn dev`; si no, `npm run dev`;
  - si existe `packageManager` en `package.json`, manda sobre el lockfile.
- **Comando propio:** `settings.projects[id].run`, texto de una línea de hasta 500 caracteres, sin caracteres de control. Una cadena vacía o `null` vuelve a la detección.
- El comando se ejecuta tal cual en la shell de la persona. Es su configuración, igual que lo que escribiría a mano.

### Arrancar y parar

- `POST /api/projects/:id/run` arranca:
  - si ya hay una terminal de arranque viva de ese proyecto, la devuelve sin crear otra;
  - si no, crea una sesión `shell` en la carpeta principal del proyecto, con `@jdev_run` = el comando y el título «dev · <proyecto>» (`@jdev_title`);
  - después escribe el comando con `send-keys -l` seguido de `Enter`, así queda en el historial de la shell.
  
  Devuelve la sesión. El cliente la abre en una pestaña.
- `DELETE /api/projects/:id/run` para:
  - envía `C-c` a la terminal y espera hasta 5 s a que el proceso en primer plano del panel vuelva a ser la shell (`#{pane_current_command}` igual al nombre de la shell);
  - si no vuelve, termina la sesión de tmux. Si vuelve, también la termina, porque «parar» significa que no quede nada en marcha.
- Las dos rutas usan la misma autenticación y comprobaciones de origen y método que el resto. Responden 404 si el proyecto no existe o 409 si no hay comando de arranque.
- La terminal de arranque es una sesión normal: se puede abrir, archivar, renombrar o terminar desde su menú. Si se termina por otro camino, el botón vuelve a ▶.

### Cliente

- `SessionInfo` añade `run: string | null` (el comando si es la terminal de arranque de su proyecto). `ProjectInfo` añade `runCommand: string | null` (el comando efectivo) y `runSource: 'custom' | 'detected' | null`.
- **Botón junto al «+»:**
  - ▶ con la etiqueta «Arrancar <comando> en <proyecto>»;
  - ■ con la etiqueta «Parar …» cuando hay una terminal de arranque viva;
  - desactivado si no hay comando, con el tooltip «Configura el comando de arranque en Ajustes › Proyectos» y un enlace.
  
  Mientras arranca o para muestra un estado de espera. Un error aparece como aviso, igual que en el menú contextual.
- La fila de la terminal de arranque muestra el icono de terminal con un indicador de «en marcha», con el mismo estilo que el resto de terminales sin agente.
- **Ajustes › Proyectos:** campo «Comando de arranque» con el detectado como marcador de posición (por ejemplo, «pnpm dev, detectado»).

## Risks / Trade-offs

- **[El comando no es interactivo y no termina con `Ctrl+C`]** → A los 5 s se termina la sesión.
- **[Puerto ocupado u otro error al arrancar]** → Se ve en la salida de la terminal, que se queda abierta.
- **[`packageManager` o lockfiles ambiguos]** → Orden fijo y documentado. El comando propio siempre manda.

## Migration Plan

Nada que migrar. El ajuste es opcional.

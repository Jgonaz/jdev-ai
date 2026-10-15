## Why

Es habitual trabajar con varias sesiones de agentes a la vez (Claude, Codex u otras CLIs) sobre el mismo proyecto. Todas comparten el checkout de `projects/<nombre>/`, así que una sesión puede sobrescribir, revertir o mezclar en su diff los cambios a medio hacer de otra. Las sesiones se siguen abriendo como siempre con `agent <proyecto>`. Lo que falta es que el agente detecte cuándo un cambio es lo bastante grande para aislarlo y ofrezca hacerlo en un worktree y una rama propios, para integrarlo en la rama principal al terminar.

## What Changes

- Al recibir una tarea, el agente valora si es un cambio grande con los criterios de `workflows/feature.md`. Si lo es, propone crear un worktree con su rama y espera la confirmación antes de hacer nada.
- Nuevo script `bin/worktree`, común a todas las CLIs, con estos subcomandos:
  - `create <feature>`: crea o reutiliza la rama `feat/<feature>` y el worktree `projects/<nombre>.worktrees/<feature>/`, y copia los archivos no versionados que declare el proyecto.
  - `list`: muestra los worktrees del proyecto.
  - `merge <feature>`: integra la rama en la rama actual del checkout principal con `--no-ff`.
  - `remove <feature>`: elimina un worktree limpio y su rama si ya está integrada.
- Confirmar el worktree autoriza al agente a hacer commits por hitos, con Conventional Commits, en `feat/<feature>`. El merge, la limpieza y cualquier push o PR se piden aparte.
- `bin/agent` se lanza igual que siempre. Añade de forma transparente `projects/<nombre>.worktrees/` como directorio de trabajo adicional (`--add-dir`) para que Claude y Codex puedan escribir en él.
- El panel de sesión muestra los worktrees activos del proyecto.
- El historial local se escribe siempre en el checkout principal, porque está ignorado por Git y se perdería al eliminar el worktree.
- Se actualizan `AGENTS.md`, `workflows/feature.md`, `rules/history.md` y `README.md`.

## Capabilities

### New Capabilities

- `feature-worktrees`: proponer, crear, usar, integrar y limpiar un worktree y una rama por cambio grande, desde una sesión abierta con el launcher habitual.

### Modified Capabilities

Ninguna.

## Impact

- Se añade `bin/worktree` y se modifican `bin/agent`, `bin/session-status`, `bin/check`, `AGENTS.md`, `workflows/feature.md`, `rules/history.md` y `README.md`.
- Se crean directorios `projects/<nombre>.worktrees/` junto a los proyectos. `/projects/` ya está ignorado por el Git del harness.
- No se modifica ningún proyecto de `projects/` ni se añaden dependencias.
- Los cambios pequeños siguen haciéndose en el checkout principal, como hasta ahora.

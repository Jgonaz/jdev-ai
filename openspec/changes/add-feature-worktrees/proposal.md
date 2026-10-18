## Why

Es habitual trabajar con varias sesiones de agentes a la vez (Claude, Codex u otras CLIs) sobre el mismo proyecto. Todas comparten el checkout de `projects/<nombre>/`, así que una sesión puede sobrescribir, revertir o mezclar en su diff los cambios a medio hacer de otra. Las sesiones se siguen abriendo como siempre con `agent <proyecto>`. Lo que falta es que el agente detecte cuándo un cambio es lo bastante grande para aislarlo y que haga todo el ciclo en la misma terminal: crear el worktree y la rama, implementar, integrar en la rama principal y limpiar.

## What Changes

- Al recibir una tarea en el checkout principal, el agente valora si es un cambio grande con los criterios de `workflows/feature.md`. Si lo es, propone aislarlo en un worktree y espera la confirmación.
- Si se acepta, la misma sesión crea el worktree con `bin/worktree create` y entra en él. En Claude Code usa `EnterWorktree`, que mueve la sesión y sus subagentes al worktree. En Codex y otras CLIs trabaja con rutas absolutas y comprueba antes de cada commit que no ha tocado el checkout principal.
- Aceptar el worktree autoriza commits por hitos en `feat/<feature>` y subir esa rama a GitHub como copia de seguridad. Cuando termina, y tras confirmación, la misma sesión:
  - abre una Pull Request;
  - espera a los checks de GitHub;
  - la integra con un commit de merge;
  - borra la rama remota;
  - actualiza el checkout principal;
  - elimina el worktree y la rama local.
- Si el proyecto no tiene remoto, la integración se hace con `merge --no-ff` en local.
- Nuevo script `bin/worktree`, común a todas las CLIs, con `create`, `list`, `push`, `merge` (por PR, o en local con `--local`) y `remove`.
- `bin/agent` pasa a Codex `projects/<nombre>.worktrees/` como directorio adicional. Acepta `--wt <feature>` para abrir directamente una sesión en un worktree, útil para retomar una feature a medias. También acepta `agent .` dentro de un worktree.
- El panel de sesión muestra el worktree activo o los worktrees abiertos del proyecto, y lee el historial del checkout principal.
- Nueva regla `rules/worktrees.md`. Se actualizan `AGENTS.md`, `rules/README.md`, `workflows/feature.md`, `rules/history.md` y `README.md`.

## Capabilities

### New Capabilities

- `feature-worktrees`: proponer, crear, usar, integrar y limpiar un worktree y una rama por cambio grande desde la misma sesión del agente.

### Modified Capabilities

Ninguna.

## Impact

- Se añaden `bin/worktree` y `rules/worktrees.md`, y se modifican `bin/agent`, `bin/session-status`, `bin/check`, `AGENTS.md`, `rules/README.md`, `workflows/feature.md`, `rules/history.md` y `README.md`.
- Se crean directorios `projects/<nombre>.worktrees/` junto a los proyectos. `/projects/` ya está ignorado por el Git del harness.
- No se modifica ningún proyecto de `projects/` ni se añaden dependencias.
- Los cambios pequeños siguen haciéndose en el checkout principal.

## Why

Es habitual trabajar con varias sesiones de agentes a la vez (Claude, Codex u otras CLIs) sobre el mismo proyecto. Todas comparten el checkout de `projects/<nombre>/`, así que una sesión puede sobrescribir, revertir o mezclar en su diff los cambios a medio hacer de otra. Las sesiones se siguen abriendo como siempre con `agent <proyecto>`. Lo que falta es que el agente detecte cuándo un cambio es lo bastante grande para aislarlo y que el trabajo se haga en una sesión cuyo directorio de arranque sea el propio worktree. Si la sesión arrancara en el checkout principal, una ruta relativa, un comando o un subagente podrían seguir escribiendo en él.

## What Changes

- Al recibir una tarea en el checkout principal, el agente valora si es un cambio grande con los criterios de `workflows/feature.md`. Si lo es, propone aislarlo y, si el usuario acepta, le indica el comando para abrir una sesión nueva en un worktree, con un prompt inicial que resume la tarea. Esa sesión no implementa el cambio.
- `bin/agent` acepta `--wt <feature>`. Crea o reutiliza la rama `feat/<feature>` y el worktree `projects/<nombre>.worktrees/<feature>/`, copia los archivos no versionados que declare el proyecto y abre el agente con el worktree como directorio de trabajo. `agent .` también funciona dentro de un worktree.
- Nuevo script `bin/worktree`, común a todas las CLIs, con `create`, `list`, `merge` y `remove`. Lo usan el launcher y el agente, y también se puede usar a mano.
- Abrir una sesión con `--wt` autoriza al agente a hacer commits por hitos en `feat/<feature>`. Integrar con `merge --no-ff`, limpiar y hacer push o abrir una PR se confirman aparte.
- El launcher añade como directorios adicionales el `.git` común y el historial del checkout principal, que hacen falta para hacer commits y registrar el historial desde el worktree. El resto del checkout principal queda fuera del directorio de trabajo de la sesión.
- El panel de sesión muestra el worktree activo o los worktrees abiertos del proyecto y lee el historial del checkout principal.
- Nueva regla `rules/worktrees.md`; se actualizan `AGENTS.md`, `rules/README.md`, `workflows/feature.md`, `rules/history.md` y `README.md`.

## Capabilities

### New Capabilities

- `feature-worktrees`: aislar cada cambio grande en una sesión que arranca en su propio worktree y rama, desde la propuesta del agente hasta la integración y la limpieza.

### Modified Capabilities

Ninguna.

## Impact

- Se añaden `bin/worktree` y `rules/worktrees.md`, y se modifican `bin/agent`, `bin/session-status`, `bin/check`, `AGENTS.md`, `workflows/feature.md`, `rules/history.md` y `README.md`.
- Se crean directorios `projects/<nombre>.worktrees/` junto a los proyectos. `/projects/` ya está ignorado por el Git del harness.
- No se modifica ningún proyecto de `projects/` ni se añaden dependencias.
- Sin `--wt`, el launcher se comporta como hasta ahora. Los cambios pequeños siguen en el checkout principal.

## 1. Script de worktrees

- [x] 1.1 Crear `bin/worktree` con `create`, `list`, `merge`, `remove` y la ayuda, resolviendo el proyecto con `--git-common-dir`, validando que esté dentro de `projects/` y que el nombre sea válido.
- [x] 1.2 Implementar `create` de forma idempotente: crear la rama y el worktree, informar de la base, fallar si la rama o la ruta están ocupadas, y copiar sin sobrescribir lo que liste `.agent/worktree-files`.
- [x] 1.3 Implementar `merge`: exigir el worktree limpio, ejecutar `merge --no-ff` en el checkout principal y abortar ante un conflicto o un bloqueo.
- [x] 1.4 Implementar `remove`: eliminar el worktree sin `--force`, borrar la rama con `branch -d`, avisar si no está integrada y rechazar la ejecución desde el propio worktree.

## 2. Launcher y panel

- [x] 2.1 Añadir a `bin/agent` la opción `--wt <feature>`, que delega en `bin/worktree create` y lanza el agente en el worktree, y aceptar `agent .` dentro de un worktree. Rechazar `--wt` sobre el harness.
- [x] 2.2 Pasar a Claude y Codex, en las sesiones de worktree, `--add-dir` con el `.git` común y el `.agent/history/` del checkout principal.
- [x] 2.3 Hacer que `bin/session-status` lea el historial del checkout principal, muestre el worktree activo y liste los worktrees abiertos.

## 3. Reglas y documentación

- [x] 3.1 Crear `rules/worktrees.md` y enlazarla desde `AGENTS.md` y `rules/README.md` con cuándo proponer el aislamiento, el comando con su prompt inicial, los límites de una sesión en un worktree, y ajustar la regla de ramas y commits.
- [x] 3.2 Añadir a `workflows/feature.md` el paso de aislar los cambios grandes y el cierre con merge y limpieza.
- [x] 3.3 Indicar en `rules/history.md` que el historial va al checkout principal e incluye la feature.
- [x] 3.4 Documentar en `README.md` el flujo, `--wt`, `bin/worktree`, `.agent/worktree-files` y los límites.

## 4. Verificación y cierre

- [x] 4.1 Ampliar `bin/check` con los escenarios de la spec y dejarlo en verde.
- [x] 4.2 Validar el change con `openspec validate add-feature-worktrees`.
- [x] 4.3 Registrar la iteración en `.agent/history/` del harness.

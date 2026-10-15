## 1. Script de worktrees

- [ ] 1.1 Crear `bin/worktree` con `create`, `list`, `merge`, `remove` y la ayuda, resolviendo el proyecto con `--git-common-dir` y validando que esté dentro de `projects/` y que el nombre sea válido.
- [ ] 1.2 Implementar `create` de forma idempotente: crear la rama y el worktree, informar de la base, fallar si la rama o la ruta están ocupadas, y copiar sin sobrescribir lo que liste `.agent/worktree-files`.
- [ ] 1.3 Implementar `merge`: exigir el worktree limpio, ejecutar `merge --no-ff` en el checkout principal y abortar ante un conflicto o un bloqueo.
- [ ] 1.4 Implementar `remove`: eliminar el worktree sin `--force` y borrar la rama con `branch -d`, avisando si no está integrada.

## 2. Launcher y panel

- [ ] 2.1 Hacer que `bin/agent` cree `projects/<nombre>.worktrees/` y lo pase como `--add-dir` a Claude y Codex, sin aplicarlo al harness.
- [ ] 2.2 Hacer que `bin/session-status` muestre los worktrees activos del proyecto.

## 3. Reglas y documentación

- [ ] 3.1 Añadir a `AGENTS.md` la regla de proponer el worktree y acotar la sesión a él, y ajustar la regla de ramas y commits.
- [ ] 3.2 Añadir a `workflows/feature.md` el paso de proponer el worktree para los cambios grandes y el cierre con merge.
- [ ] 3.3 Indicar en `rules/history.md` que el historial va al checkout principal e incluye la feature.
- [ ] 3.4 Documentar en `README.md` el flujo, `bin/worktree`, `.agent/worktree-files` y los límites.

## 4. Verificación y cierre

- [ ] 4.1 Ampliar `bin/check` con los escenarios de la spec y dejarlo en verde.
- [ ] 4.2 Validar el change con `openspec validate add-feature-worktrees`.
- [ ] 4.3 Registrar la iteración en `.agent/history/` del harness.

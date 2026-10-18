## Context

`bin/agent` resuelve un proyecto de `projects/` (o el harness) y lanza el agente en la raíz del checkout con hooks del harness. Codex no puede cambiar el directorio de arranque de una sesión; Claude Code sí, con `EnterWorktree`. El sandbox de Codex (`workspace-write`) y los permisos de Claude solo dejan escribir sin fricción en ese directorio y en los que se añaden con `--add-dir`, y los subagentes heredan ese mismo directorio. Un worktree guarda sus objetos y refs en el `.git` del checkout principal. En los proyectos, `.agent/history/` está ignorado por Git y `.agent/memory/` está versionada.

## Goals / Non-Goals

**Goals:**

- Abrir sesiones como siempre y que el agente proponga el aislamiento cuando el cambio lo justifique.
- Hacer todo el ciclo en la misma sesión, sin abrir otra terminal.
- Que el trabajo en el worktree no modifique el checkout principal: con garantía en Claude Code y por disciplina en Codex.
- Que el flujo de crear, trabajar, integrar y limpiar sea idéntico en todas las CLIs.
- Que el historial siga siendo único por proyecto.

**Non-Goals:**

- Aislar puertos, bases de datos locales, cachés o servicios.
- Instalar dependencias o ejecutar el setup del proyecto.
- Hacer push, abrir PR o borrar ramas no integradas.

## Decisions

### Todo el ciclo en la misma sesión

Cuando el agente infiere que el cambio es grande y el usuario acepta aislarlo, la misma sesión ejecuta `bin/worktree create <feature>` y entra en el worktree:

- **Claude Code**: `EnterWorktree` con `path` mueve el directorio de la sesión al worktree. Los comandos, las rutas relativas y los subagentes trabajan allí, así que el aislamiento es equivalente a haber abierto la sesión en el worktree. Al terminar, `ExitWorktree` con `keep` devuelve la sesión al checkout principal. El worktree lo elimina `bin/worktree`, para que la limpieza sea la misma en todas las CLIs.
- **Codex y otras CLIs**: no pueden cambiar el directorio de la sesión. El agente usa rutas absolutas del worktree, ejecuta cada comando con el worktree como directorio de trabajo y pasa esa ruta a sus subagentes. Antes de cada commit, comprueba con `git status` que no ha modificado el checkout principal. Es un aislamiento por disciplina: el checkout principal sigue siendo escribible.

El cierre lo hace la misma sesión tras confirmación: integra la rama destino en el worktree, valida, vuelve al checkout principal, ejecuta `bin/worktree merge` y, a continuación, `bin/worktree remove`.

Alternativas descartadas:

- Exigir una sesión nueva en otra terminal para cada feature. Da un aislamiento fuerte en todas las CLIs, pero obliga a cambiar de terminal y a repetir el contexto. Se mantiene como opción con `--wt`.
- Usar solo `EnterWorktree` con sus rutas propias (`.claude/worktrees/`). Solo sirve para Claude y deja los worktrees dentro del repositorio.

Si además procede OpenSpec, se propone junto con el worktree y los artefactos se crean dentro del worktree, porque forman parte del cambio.

### El launcher crea o reutiliza el worktree con `bin/worktree`

`agent <proyecto> --wt <feature>` ejecuta `bin/worktree create <feature>` sobre el checkout principal y lanza el agente en la ruta resultante. Escribir `--wt` es la confirmación explícita de la rama. Sirve para retomar una feature a medias o para quien prefiera una sesión por worktree, y en ese caso Codex también queda aislado del checkout principal. `agent .` dentro de un worktree resuelve el proyecto con el directorio padre de `git rev-parse --git-common-dir`, que tiene que estar dentro de `projects/`. `--wt` no se admite sobre el harness.

`bin/worktree`:
- `create`: idempotente. Rama `feat/<feature>` y ruta `projects/<nombre>.worktrees/<feature>`, fuera del árbol del proyecto, para que los watchers, linters y búsquedas del checkout principal no la recorran. Crea la rama desde el `HEAD` del checkout principal y lo muestra. Falla sin tocar nada si la rama está en uso en otra ruta o si la ruta existe y no es ese worktree. El nombre solo admite `[a-z0-9._-]`, sin empezar por `.` ni `-` y sin `..`.
- `list`: muestra los worktrees del proyecto y si tienen cambios.
- `merge`: ver más abajo.
- `remove`: ver más abajo.

### Permisos de escritura

En el checkout principal de un proyecto, el launcher pasa a Codex `--add-dir projects/<nombre>.worktrees`, que crea si no existe, para que pueda crear y editar worktrees desde la misma sesión. Claude no lo necesita, porque `EnterWorktree` amplía el directorio de trabajo de la sesión.

En una sesión abierta directamente en un worktree, para hacer commits y escribir el historial, el launcher pasa a Claude y a Codex dos directorios adicionales con `--add-dir`: el `.git` común (`git rev-parse --git-common-dir`) y `<checkout principal>/.agent/history/`, que crea si no existe. El árbol del checkout principal no se añade. Copilot y OpenCode no reciben la opción y aplican sus propios permisos.

### Rama en GitHub e integración por Pull Request

Aceptar el worktree, o abrir la sesión con `--wt`, autoriza commits por hitos en `feat/<feature>`, con Conventional Commits en castellano y el formato de cuerpo de `AGENTS.md`. También autoriza subir la rama tras cada commit con `bin/worktree push`, para que el trabajo en curso tenga copia en GitHub. El cierre queda así:

1. El agente propone integrar cuando la feature está lista y validada. Indica la rama destino, que es la rama actual del checkout principal, y avisa de que abrirá una PR, la integrará y limpiará.
2. Tras la confirmación, ejecuta `git merge <rama destino>` en el worktree, resuelve allí los conflictos y repite las validaciones.
3. Abre la PR con `gh pr create`. El título y la descripción los redacta el agente, no el script.
4. Vuelve al checkout principal (`ExitWorktree` con `keep` en Claude Code) y ejecuta `bin/worktree merge <feature>`. El script:
   - sube la rama;
   - localiza la PR abierta y comprueba su base;
   - espera a sus checks con `gh pr checks --watch`;
   - la integra con `gh pr merge --merge`;
   - borra la rama remota;
   - actualiza el checkout principal con `fetch` y `merge --ff-only`.

   No usa `--delete-branch` de `gh`, porque intenta borrar la rama local, que sigue desprotegida en el worktree.
5. Si un check falla o la PR no se puede integrar, el script se detiene sin integrar. Si la PR se integra pero el checkout principal no admite el fast-forward, no lo fuerza y lo avisa.

Por qué una PR y no un merge local:
- Los tests de GitHub de los proyectos se ejecutan en `pull_request` y en `push` a `main`. Con un merge local correrían solo después de que el cambio estuviera en `main`.
- Algunos proyectos ya integran con PRs, así que cada feature queda documentada en GitHub.
- `--merge` conserva el commit de merge, equivalente a `--no-ff`.

Si el proyecto no tiene remoto `origin`, `merge` usa el modo local (`merge --no-ff` en el checkout principal y abortar ante conflictos) y lo avisa. Si tiene remoto pero falta `gh`, falla y el agente pregunta antes de usar `--local`.

### Limpieza conservadora

`bin/worktree remove <feature>` ejecuta `git worktree remove` sin `--force`, así que falla si hay cambios sin confirmar. Después borra la rama con `git branch -d`, que solo lo permite si está integrada. Si no lo está, conserva la rama y lo avisa. El script rechaza ejecutarse desde dentro del worktree que va a eliminar, así que el agente lo ejecuta después de volver al checkout principal. Si la sesión se abrió con `--wt`, no puede salir de su directorio, así que la limpieza se hace desde otra sesión o a mano.

### Archivos no versionados declarados por el proyecto

`<checkout principal>/.agent/worktree-files` lista una ruta relativa por línea. Se ignoran las líneas vacías y las que empiezan por `#`, y se rechazan las rutas absolutas o con `..`. `create` copia cada ruta que exista en el checkout principal y falte en el worktree, mantiene los permisos, no sobrescribe nada e informa de lo copiado. El setup se declara en el `AGENTS.md` del proyecto y el agente lo ejecuta en el worktree si hace falta.

### Historial único y panel informado

El historial se escribe en `<checkout principal>/.agent/history/`, incluso desde un worktree, e indica la feature y la rama. `.agent/memory/` está versionada y viaja con la rama. `bin/session-status` lee ese historial a través del common-dir. En un worktree muestra la feature y la rama activas. En el checkout principal lista los worktrees abiertos del proyecto, para retomarlos con `agent <proyecto> --wt <feature>`.

## Risks / Trade-offs

- [Codex puede escribir por error en el checkout principal] → Rutas absolutas, comprobación de `git status` en el principal antes de cada commit y la opción `--wt` cuando se quiera aislamiento fuerte.
- [Inferencia errónea del tamaño] → El agente solo propone y el usuario decide. También se puede pedir directamente «en un worktree» o «hazlo en main».
- [Permiso sobre el `.git` común] → Es necesario para hacer commits. Permite tocar refs de otras ramas, pero no archivos del checkout principal. Las reglas prohíben cambiar otras ramas salvo en el merge confirmado.
- [El sandbox de Codex trata los `.git` como protegidos] → No se ha podido verificar fuera de una sesión real si un `.git` añadido con `--add-dir` es escribible (con el perfil `:workspace` sin raíces adicionales, Git falla con «Read-only file system»). Si no lo es, los commits pedirán aprobación, igual que en una sesión normal de Codex, sin cambiar el resto del diseño.
- [Puertos, bases de datos o servicios compartidos] → Se documenta como límite. Cada proyecto puede indicar en su `AGENTS.md` cómo evitar choques.
- [Conflictos entre features] → Se resuelven en el worktree antes de integrar, nunca en el checkout principal.
- [Dependencia de GitHub y `gh`] → Sin `gh` o sin sesión iniciada, el script falla antes de integrar y el agente pregunta si se integra en local.
- [Checks lentos o que tardan en registrarse] → `merge` reintenta varias veces si aún no hay checks y después espera a que terminen. Si un check falla, no se integra.
- [Checkout principal con commits locales sin subir] → La PR se integra en GitHub, pero el fast-forward local no se fuerza. Se avisa para actualizarlo a mano.
- [Copiar secretos] → Solo se copian las rutas declaradas, dentro de `projects/`, que está fuera del Git del harness.

## Migration Plan

No hay migración. Sin `--wt`, el comportamiento es el actual. Para revertir, se retiran el script, la opción del launcher y las reglas. Los worktrees existentes se eliminan con `git worktree remove`.

## Open Questions

Ninguna que bloquee la implementación.

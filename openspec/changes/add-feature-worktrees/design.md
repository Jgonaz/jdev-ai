## Context

`bin/agent` resuelve un proyecto de `projects/` (o el harness) y lanza el agente en la raíz del checkout con hooks del harness. Una sesión no puede cambiar su directorio de arranque. El sandbox de Codex (`workspace-write`) y los permisos de Claude solo dejan escribir sin fricción en ese directorio y en los que se añaden con `--add-dir`, y los subagentes heredan ese mismo directorio. Un worktree guarda sus objetos y refs en el `.git` del checkout principal. En los proyectos, `.agent/history/` está ignorado por Git y `.agent/memory/` está versionada.

## Goals / Non-Goals

**Goals:**

- Abrir sesiones como siempre y que el agente proponga el aislamiento cuando el cambio lo justifique.
- Que la sesión que implementa un cambio grande no pueda modificar el checkout principal por accidente.
- Que el flujo de crear, trabajar, integrar y limpiar sea idéntico en todas las CLIs.
- Que el historial siga siendo único por proyecto.

**Non-Goals:**

- Mover una sesión ya abierta a un worktree.
- Aislar puertos, bases de datos locales, cachés o servicios.
- Instalar dependencias o ejecutar el setup del proyecto.
- Hacer push, abrir PR o borrar ramas no integradas.

## Decisions

### Una sesión por worktree, arrancada en él

Cuando el agente infiere que el cambio es grande y el usuario acepta aislarlo, la sesión original no implementa nada. Propone un nombre de feature y le da al usuario el comando `agent <proyecto> --wt <feature> [--codex] -- "<prompt>"`. El prompt resume la tarea, las decisiones ya tomadas y los archivos relevantes. La nueva sesión arranca en el worktree, así que:

- las rutas relativas, los comandos, las validaciones y los subagentes trabajan sobre el worktree por defecto;
- el árbol del checkout principal queda fuera de su directorio de trabajo, así que el sandbox de Codex o los permisos de Claude bloquean o piden confirmación ante cualquier escritura ahí.

Alternativas descartadas:

- Que la misma sesión trabaje en el worktree con rutas absolutas. Depende de la disciplina del agente y deja `main` escribible sin aviso.
- El modo worktree nativo de Claude. Solo existe en una CLI y guarda los worktrees dentro del repositorio.

Si además procede OpenSpec, se propone junto con el worktree y los artefactos se crean en la nueva sesión, porque forman parte del cambio.

### El launcher crea o reutiliza el worktree con `bin/worktree`

`agent <proyecto> --wt <feature>` ejecuta `bin/worktree create <feature>` sobre el checkout principal y lanza el agente en la ruta resultante. Escribir `--wt` es la confirmación explícita de la rama, así que la sesión original no necesita permisos fuera de su directorio de trabajo. `agent .` dentro de un worktree resuelve el proyecto con el directorio padre de `git rev-parse --git-common-dir`, que tiene que estar dentro de `projects/`. `--wt` no se admite sobre el harness.

`bin/worktree`:
- `create`: idempotente. Rama `feat/<feature>` y ruta `projects/<nombre>.worktrees/<feature>`, fuera del árbol del proyecto, para que los watchers, linters y búsquedas del checkout principal no la recorran. Crea la rama desde el `HEAD` del checkout principal y lo muestra. Falla sin tocar nada si la rama está en uso en otra ruta o si la ruta existe y no es ese worktree. El nombre solo admite `[a-z0-9._-]`, sin empezar por `.` ni `-` y sin `..`.
- `list`: muestra los worktrees del proyecto y si tienen cambios.
- `merge`: ver más abajo.
- `remove`: ver más abajo.

### Permisos mínimos fuera del worktree

Para hacer commits y escribir el historial, el launcher pasa a Claude y a Codex dos directorios adicionales con `--add-dir`: el `.git` común (`git rev-parse --git-common-dir`) y `<checkout principal>/.agent/history/`, que crea si no existe. El árbol del checkout principal no se añade. Copilot y OpenCode no reciben la opción y aplican sus propios permisos.

### Commits en la rama, integración con confirmación

Abrir la sesión con `--wt` autoriza commits por hitos en `feat/<feature>`, con Conventional Commits en castellano y el formato de cuerpo de `AGENTS.md`. El cierre queda así:

1. El agente propone integrar cuando la feature está lista y validada, indicando la rama destino, que es el `HEAD` del checkout principal.
2. Tras la confirmación, ejecuta `git merge <rama destino>` en el worktree, resuelve allí los conflictos y repite las validaciones.
3. Ejecuta `bin/worktree merge <feature>`. El script exige el worktree limpio y hace `git merge --no-ff feat/<feature>` en el checkout principal. Como escribe fuera del directorio de trabajo, la CLI pedirá aprobación, que coincide con la confirmación ya dada.
4. Si aparece un conflicto, o un cambio local de otra sesión lo bloquea, el script aborta el merge, deja el checkout principal como estaba e indica que hay que volver al paso 2.

`--no-ff` agrupa la feature en un commit de merge que se puede revertir entero.

### Limpieza fuera de la sesión del worktree

`bin/worktree remove <feature>` ejecuta `git worktree remove` sin `--force`, así que falla si hay cambios sin confirmar. Después borra la rama con `git branch -d`, que solo lo permite si está integrada. Si no lo está, conserva la rama y lo avisa. No se puede borrar el directorio en el que corre la propia sesión, así que el script rechaza ejecutarse desde dentro del worktree que va a eliminar. Tras el merge, el agente indica al usuario que cierre la sesión y ejecute `bin/worktree remove <feature>` desde el checkout principal, o que se lo pida a una sesión abierta allí.

### Archivos no versionados declarados por el proyecto

`<checkout principal>/.agent/worktree-files` lista una ruta relativa por línea. Se ignoran las líneas vacías y las que empiezan por `#`, y se rechazan las rutas absolutas o con `..`. `create` copia cada ruta que exista en el checkout principal y falte en el worktree, mantiene los permisos, no sobrescribe nada e informa de lo copiado. El setup se declara en el `AGENTS.md` del proyecto y el agente lo ejecuta en el worktree si hace falta.

### Historial único y panel informado

El historial se escribe en `<checkout principal>/.agent/history/`, incluso desde un worktree, e indica la feature y la rama. `.agent/memory/` está versionada y viaja con la rama. `bin/session-status` lee ese historial a través del common-dir. En un worktree muestra la feature y la rama activas. En el checkout principal lista los worktrees abiertos del proyecto, para retomarlos con `agent <proyecto> --wt <feature>`.

## Risks / Trade-offs

- [Una terminal más por feature grande] → Es el coste de un aislamiento real. El prompt inicial generado evita repetir el contexto.
- [Inferencia errónea del tamaño] → El agente solo propone y el usuario decide. También se puede pedir directamente «en un worktree» o «hazlo en main».
- [Permiso sobre el `.git` común] → Es necesario para hacer commits. Permite tocar refs de otras ramas, pero no archivos del checkout principal. Las reglas prohíben cambiar otras ramas salvo en el merge confirmado.
- [El sandbox de Codex trata los `.git` como protegidos] → No se ha podido verificar fuera de una sesión real si un `.git` añadido con `--add-dir` es escribible (con el perfil `:workspace` sin raíces adicionales, Git falla con «Read-only file system»). Si no lo es, los commits pedirán aprobación, igual que en una sesión normal de Codex, sin cambiar el resto del diseño.
- [Puertos, bases de datos o servicios compartidos] → Se documenta como límite. Cada proyecto puede indicar en su `AGENTS.md` cómo evitar choques.
- [Conflictos entre features] → Se resuelven en el worktree antes de integrar, nunca en el checkout principal.
- [Copiar secretos] → Solo se copian las rutas declaradas, dentro de `projects/`, que está fuera del Git del harness.

## Migration Plan

No hay migración. Sin `--wt`, el comportamiento es el actual. Para revertir, se retiran el script, la opción del launcher y las reglas. Los worktrees existentes se eliminan con `git worktree remove`.

## Open Questions

Ninguna que bloquee la implementación.

## Context

`bin/agent` resuelve un proyecto de `projects/` (o el harness) y lanza el agente en la raíz del checkout con hooks del harness. Una sesión no puede cambiar su directorio de arranque. Además, el sandbox de Codex (`workspace-write`) y los permisos de Claude solo permiten escribir sin fricción en ese directorio y en los que se añaden con `--add-dir`. En los proyectos, `.agent/history/` está ignorado por Git y `.agent/memory/` está versionada. Claude dispone de herramientas nativas de worktree, pero Codex y las demás CLIs no.

## Goals / Non-Goals

**Goals:**

- Abrir sesiones siempre igual, con `agent <proyecto>`.
- Que el agente infiera cuándo conviene aislar el cambio y lo proponga sin imponerlo.
- Que el flujo de crear, trabajar, integrar y limpiar sea idéntico en todas las CLIs.
- Que el historial siga siendo único por proyecto.

**Non-Goals:**

- Aislar puertos, bases de datos locales, cachés o servicios.
- Instalar dependencias o ejecutar el setup del proyecto.
- Hacer push, abrir PR o borrar ramas no integradas.
- Aislar los cambios pequeños, que siguen en el checkout principal.

## Decisions

### La decisión es del agente; la ejecución, de un script del harness

El agente aplica los criterios de `workflows/feature.md` (impacto funcional, contratos, varias partes del sistema, varias iteraciones) para decidir si el cambio es grande. Si lo es, propone el worktree con un nombre de feature y espera la confirmación. Las operaciones de Git las hace `bin/worktree`, que también puede usar una persona a mano. Así el comportamiento no depende de las herramientas propias de cada CLI y se puede probar en `bin/check`.

Si además procede OpenSpec, se proponen las dos cosas juntas y los artefactos se crean dentro del worktree, porque forman parte del cambio.

Alternativa descartada: opciones `--wt` en el launcher. Obligan a decidir antes de describir la tarea, que es justo lo que se quiere evitar.

### El agente trabaja en el worktree con rutas absolutas

Tras `bin/worktree create`, el agente hace todas las lecturas de código, ediciones, comandos y validaciones dentro de `projects/<nombre>.worktrees/<feature>/`, usando rutas absolutas o el directorio de trabajo de cada comando. No modifica el checkout principal ni otros worktrees, con una excepción: el historial local. Para que esto funcione sin pedir permisos, `bin/agent` pasa siempre `--add-dir projects/<nombre>.worktrees` a Claude y a Codex, creando el directorio si no existe. Copilot y OpenCode no reciben la opción. En ellas puede haber más avisos de permisos, sin otro cambio funcional.

Para retomar una feature en otra terminal, el panel lista los worktrees activos y el agente los reutiliza con `bin/worktree create`, que es idempotente.

### Ubicación y nombres

- Rama: `feat/<feature>`.
- Ruta: `projects/<nombre>.worktrees/<feature>`, fuera del árbol del proyecto, para que los watchers, linters y búsquedas del checkout principal no la recorran y no haga falta ignorarla.
- Nombre de la feature: solo `[a-z0-9._-]`, sin empezar por `.` ni `-` y sin `..`.
- Base de la rama: el `HEAD` del checkout principal, que el script muestra.

`create` falla sin tocar nada si la rama está en uso en otra ruta o si la ruta existe y no es ese worktree. El proyecto se resuelve desde el directorio actual, sea el checkout principal o un worktree, usando el directorio padre de `git rev-parse --git-common-dir`. Ese directorio tiene que estar dentro de `projects/`.

### Commits en la rama, integración con confirmación

Al aceptar el worktree, el usuario autoriza commits por hitos en `feat/<feature>`, con Conventional Commits en castellano y el formato de cuerpo de `AGENTS.md`. El cierre queda así:

1. El agente propone integrar cuando la feature está lista y validada.
2. Tras la confirmación, ejecuta `git merge <rama principal>` dentro del worktree, resuelve allí los conflictos y repite las validaciones.
3. Ejecuta `bin/worktree merge <feature>`, que exige el worktree limpio y hace `git merge --no-ff feat/<feature>` en el checkout principal.
4. Si aparece un conflicto, el script aborta el merge, deja el checkout principal como estaba e indica que hay que volver al paso 2.

`--no-ff` agrupa la feature en un commit de merge que se puede revertir entero. El merge respeta los cambios sin confirmar de otras sesiones en el checkout principal: Git se niega a sobrescribir archivos modificados que choquen con el merge, y en ese caso el script también aborta.

### Limpieza conservadora

`bin/worktree remove <feature>` ejecuta `git worktree remove` sin `--force`, así que falla si hay cambios sin confirmar. Después borra la rama con `git branch -d`, que solo lo permite si está integrada. Si no lo está, conserva la rama y lo avisa. El agente propone la limpieza junto con el merge y no la ejecuta sin confirmación.

### Archivos no versionados declarados por el proyecto

`<checkout principal>/.agent/worktree-files` lista una ruta relativa por línea. Se ignoran las líneas vacías y las que empiezan por `#`, y se rechazan las rutas absolutas o con `..`. `create` copia cada ruta que exista en el checkout principal y falte en el worktree, mantiene los permisos, no sobrescribe nada e informa de lo copiado. El setup se declara en el `AGENTS.md` del proyecto y el agente lo ejecuta dentro del worktree si hace falta.

### Historial único y panel informado

El historial se escribe en `<checkout principal>/.agent/history/`, incluso cuando se trabaja en un worktree, e indica la feature y la rama. `.agent/memory/` está versionada y viaja con la rama. El panel de `bin/session-status` añade una línea con los worktrees activos del proyecto (feature, rama y si tiene cambios) para retomar el trabajo desde otra terminal.

## Risks / Trade-offs

- [El agente edita por error el checkout principal] → La regla exige rutas del worktree. Las validaciones y `git status` se ejecutan en el worktree y el diff final se revisa allí antes del merge.
- [Inferencia errónea del tamaño] → El agente solo propone y el usuario decide. También se puede pedir directamente «trabaja en un worktree» o «hazlo en main».
- [Puertos, bases de datos o servicios compartidos] → Se documenta como límite. Cada proyecto puede indicar en su `AGENTS.md` cómo evitar choques.
- [Conflictos entre features] → Se resuelven en el worktree antes de integrar, nunca en el checkout principal.
- [Copiar secretos] → Solo se copian las rutas declaradas, dentro de `projects/`, que está fuera del Git del harness.
- [Checkout principal en otra rama] → `create` y `merge` muestran la rama base o destino, y el agente la incluye al pedir confirmación.

## Migration Plan

No hay migración. Sin worktrees, el comportamiento es el actual, salvo el `--add-dir` adicional. Para revertir, se retiran el script, las reglas y la opción del launcher. Los worktrees existentes se eliminan con `git worktree remove`.

## Open Questions

Ninguna que bloquee la implementación.

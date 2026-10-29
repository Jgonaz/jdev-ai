# Worktrees por feature

Varias sesiones de agentes pueden trabajar a la vez en el mismo proyecto. Para
que no se pisen, los cambios grandes se implementan en un worktree de Git con su
propia rama. Las sesiones se siguen abriendo con `agent <proyecto>`. El agente
propone el aislamiento cuando procede y hace todo el ciclo en la misma sesión:
crear el worktree, implementar, subir la rama, integrarla mediante una Pull
Request y limpiar.

## Cuándo proponerlo

Al recibir una tarea en el checkout principal de un proyecto de `projects/`,
valora si es un cambio grande con los mismos criterios que deciden OpenSpec en
[`workflows/feature.md`](../workflows/feature.md): comportamiento visible,
contratos, datos o seguridad, varias partes del sistema o varias iteraciones.
Si lo es, propón aislarlo antes de modificar nada e indica:

- el nombre de la feature (`[a-z0-9._-]`, corto y descriptivo) y la rama
  `feat/<feature>`;
- la rama base, que es la rama actual del checkout principal;
- si además propones OpenSpec, porque sus artefactos se crearán en el worktree.

Para cambios pequeños trabaja en el checkout principal sin proponerlo, salvo que
la persona lo pida. Si lo pide expresamente («crea un worktree para…»), esa
petición ya es la aceptación: no vuelvas a preguntar. Si rechaza el
aislamiento, trabaja en el checkout principal como siempre. No apliques esta
regla al propio harness.

Aceptar el worktree autoriza a crearlo, a hacer commits por hitos en
`feat/<feature>` con el formato de commits de `AGENTS.md` y a subir esa rama a
GitHub. No autoriza abrir la PR, integrar ni limpiar.

## Entrar en el worktree

1. Desde el checkout principal, ejecuta `<harness>/bin/worktree create <feature>`.
   Crea o reutiliza la rama y el worktree en
   `projects/<proyecto>.worktrees/<feature>/`, copia los archivos no versionados
   que declare el proyecto en `.agent/worktree-files` e imprime la ruta.
2. Mueve la sesión al worktree:
   - **Claude Code**: usa `EnterWorktree` con `path` igual a esa ruta. La sesión,
     sus comandos y sus subagentes pasan a trabajar en el worktree.
   - **Codex y otras CLIs sin esa herramienta**: la sesión sigue anclada en el
     checkout principal. A partir de aquí, usa la ruta absoluta del worktree en
     todas las ediciones, ejecuta cada comando con el worktree como directorio de
     trabajo y pasa esa ruta en cada encargo a un subagente.
3. Si el proyecto declara un setup en su `AGENTS.md` (dependencias, base de
   datos…) y el worktree lo necesita, ejecútalo dentro del worktree.

## Trabajar en el worktree

- Edita, ejecuta comandos, valida y haz commits solo en el worktree. Tras cada
  commit, sube la rama con `<harness>/bin/worktree push <feature>`, que sirve de
  copia de seguridad.
- No modifiques el checkout principal, otros worktrees ni otras ramas; las únicas
  excepciones son el historial local y el merge confirmado.
- Sin `EnterWorktree`, antes de cada commit comprueba con `git status` en el
  checkout principal que no le has añadido cambios. Si los hay, detente y
  avisa, sin revertir nada que pueda ser de otra sesión.
- Los worktrees no aíslan puertos, bases de datos locales, cachés ni servicios.
  Sigue las indicaciones del proyecto para no chocar con otras sesiones.

## Integrar y limpiar

Cuando la feature esté terminada y validada, propón integrarla indicando la rama
destino. Avisa de que abrirás una PR, esperarás a los checks de GitHub, la
integrarás y eliminarás el worktree y la rama, local y remota. Tras la
confirmación:

1. En el worktree, integra la rama destino actualizada
   (`git fetch origin && git merge origin/<rama destino>`; sin `origin`,
   `git merge <rama destino>`), resuelve allí los conflictos, repite las
   validaciones y haz commit.
2. Abre la PR desde el worktree con
   `gh pr create --base <rama destino> --head feat/<feature>`. El título sigue
   Conventional Commits en castellano y la descripción resume qué cambia, por
   qué y cómo se ha validado. Si ya hay una PR abierta para la rama, reutilízala.
3. Vuelve al checkout principal. En Claude Code, usa `ExitWorktree` con
   `action: "keep"`: el worktree lo borra el script, no la herramienta. Si la
   sesión se abrió con `agent <proyecto> --wt <feature>`, no hay nada de lo
   que salir: ejecuta los pasos 4 y 5 con `$JDEV_MAIN_CHECKOUT` como
   directorio de trabajo y deja el paso 5 para el final, después del 6 y del
   historial, porque borra el directorio de la sesión. Si el entorno no te
   deja escribir en el checkout principal, pide a la persona que ejecute ese
   comando en su terminal.
4. Ejecuta `<harness>/bin/worktree merge <feature>`. El script:
   - sube la rama;
   - espera a los checks de la PR;
   - la integra con un commit de merge;
   - borra la rama remota;
   - actualiza el checkout principal.

   Lánzalo siempre en segundo plano (en Claude Code, Bash con
   `run_in_background`) y avisa a la persona de que tardará lo que tarden los
   checks y de que la avisarás al terminar. Mientras espera no muestra nada, así
   que en primer plano parece colgado y bloquea la conversación. Al recibir el
   aviso de que ha terminado, informa del resultado y sigue con el paso 5.

   Si un check falla o la PR no se puede integrar, se detiene sin integrar:
   corrige en el worktree y repite. Si la PR se integra pero el checkout
   principal no se puede actualizar (porque tiene commits sin subir o cambios
   locales que chocan), informa a la persona en lugar de forzarlo.
5. Ejecuta `<harness>/bin/worktree remove <feature>`. No fuerza nada: falla si
   hay cambios sin confirmar y solo borra la rama local si ya está integrada.
6. Si la PR o el merge local se integró, marca la sesión como cerrada con
   `<harness>/bin/session-title --closed`, según
   [`session-title.md`](session-title.md).

Si el proyecto no tiene remoto `origin`, `bin/worktree merge` integra en local
con `merge --no-ff` y lo avisa. Si lo tiene pero falta `gh` o no hay sesión
iniciada, no cambies de modo por tu cuenta: informa y pregunta si se integra en
local con `bin/worktree merge --local <feature>`.

Si la persona prefiere dejar la feature a medias, sal del worktree sin
eliminarlo. Se retoma más tarde desde cualquier sesión del proyecto con
`bin/worktree create <feature>`, o abriendo directamente
`agent <proyecto> --wt <feature>`.

`bin/worktree list` muestra los worktrees del proyecto y si tienen cambios.

## Archivos no versionados

Un proyecto puede versionar `.agent/worktree-files` con una ruta relativa por
línea; admite líneas vacías y comentarios con `#`. Al crear o reutilizar un
worktree, se copian las rutas que existan en el checkout principal y falten en
el worktree, sin sobrescribir nada. Sirve para archivos como `.env`; no lo uses
para dependencias o artefactos que se puedan regenerar. Si esos archivos no
están ignorados por Git, `bin/worktree remove` no podrá eliminar el worktree
hasta quitarlos.

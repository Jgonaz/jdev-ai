# Worktrees por feature

Varias sesiones de agentes pueden trabajar a la vez en el mismo proyecto. Para
que no se pisen, los cambios grandes se implementan en un worktree de Git con su
propia rama. Las sesiones se siguen abriendo con `agent <proyecto>`. El agente
propone el aislamiento cuando procede y hace todo el ciclo en la misma sesión:
crear el worktree, implementar, integrar y limpiar.

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
la persona lo pida. Si rechaza el aislamiento, trabaja en el checkout principal
como siempre. No apliques esta regla al propio harness.

Aceptar el worktree autoriza a crearlo y a hacer commits por hitos en
`feat/<feature>`, con el formato de commits de `AGENTS.md`. No autoriza el
merge, la limpieza, el push ni la apertura de una PR.

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

- Edita, ejecuta comandos, valida y haz commits solo en el worktree. No
  modifiques el checkout principal, otros worktrees ni otras ramas; las únicas
  excepciones son el historial local y el merge confirmado.
- Sin `EnterWorktree`, antes de cada commit comprueba con `git status` en el
  checkout principal que no le has añadido cambios. Si los hay, detente y
  avisa, sin revertir nada que pueda ser de otra sesión.
- Los worktrees no aíslan puertos, bases de datos locales, cachés ni servicios.
  Sigue las indicaciones del proyecto para no chocar con otras sesiones.

## Integrar y limpiar

Cuando la feature esté terminada y validada, propón integrarla indicando la rama
destino, y avisa de que después se eliminarán el worktree y la rama. Tras la
confirmación:

1. En el worktree, integra la rama destino (`git merge <rama destino>`), resuelve
   allí los conflictos y repite las validaciones.
2. Vuelve al checkout principal. En Claude Code, usa `ExitWorktree` con
   `action: "keep"`: el worktree lo borra el script, no la herramienta.
3. Ejecuta `<harness>/bin/worktree merge <feature>`, que exige el worktree limpio
   y hace `git merge --no-ff` en el checkout principal. Si falla por un conflicto
   o por cambios locales de otra sesión, deja el checkout principal como estaba.
   En ese caso, vuelve al worktree y al paso 1, o informa del bloqueo.
4. Ejecuta `<harness>/bin/worktree remove <feature>`. No fuerza nada: falla si
   hay cambios sin confirmar y solo borra la rama si ya está integrada.

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

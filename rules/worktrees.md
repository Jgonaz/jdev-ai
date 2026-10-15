# Worktrees por feature

Varias sesiones de agentes pueden trabajar a la vez en el mismo proyecto. Para
que no se pisen, los cambios grandes se implementan en una sesión propia que
arranca en un worktree de Git con su rama. Las sesiones se siguen abriendo con
`agent <proyecto>`; el aislamiento lo propone el agente cuando procede.

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

## Abrir la sesión del worktree

Si la persona acepta, no implementes el cambio en la sesión actual. Dale un
comando listo para copiar en otra terminal, con la CLI que esté usando:

```sh
agent <proyecto> --wt <feature> [--codex] -- "<prompt inicial>"
```

El prompt inicial resume la tarea, las decisiones ya tomadas y los archivos o
documentos relevantes, para que la nueva sesión no dependa de esta
conversación. Evita comillas dobles dentro del prompt o escápalas.

El launcher crea o reutiliza la rama y el worktree en
`projects/<proyecto>.worktrees/<feature>/`, copia los archivos no versionados
que declare el proyecto en `.agent/worktree-files` y abre el agente allí.

## Trabajar en el worktree

En una sesión abierta en un worktree (el panel lo indica y existe
`JDEV_WORKTREE`):

- Edita, ejecuta comandos y valida solo dentro del worktree. No modifiques el
  checkout principal, otros worktrees ni otras ramas; la única excepción es el
  historial local y el merge confirmado.
- Abrir la sesión con `--wt` autoriza commits por hitos en `feat/<feature>`,
  con el formato de commits de `AGENTS.md`. No autoriza el merge, la limpieza,
  el push ni la apertura de una PR.
- Si el proyecto declara un setup en su `AGENTS.md` (dependencias, base de
  datos…) y el worktree lo necesita, ejecútalo dentro del worktree.
- Recuerda que los worktrees no aíslan puertos, bases de datos locales, cachés
  ni servicios: sigue las indicaciones del proyecto para no chocar con otras
  sesiones.

## Integrar y limpiar

Cuando la feature esté terminada y validada, propón integrarla indicando la rama
destino. Tras la confirmación:

1. Integra la rama destino en el worktree (`git merge <rama destino>`), resuelve
   allí los conflictos y repite las validaciones.
2. Ejecuta `<harness>/bin/worktree merge <feature>`, que exige el worktree
   limpio y hace `git merge --no-ff` en el checkout principal. Si falla por un
   conflicto o por cambios locales de otra sesión, deja el checkout principal
   como estaba: vuelve al paso 1 o informa del bloqueo.
3. Indica a la persona que cierre la sesión y elimine el worktree desde el
   checkout principal con `bin/worktree remove <feature>`, o que se lo pida a
   una sesión abierta allí. Una sesión no puede borrar el directorio en el que
   corre.

`bin/worktree remove` no fuerza nada: falla si hay cambios sin confirmar y solo
borra la rama si ya está integrada. Ejecútalo únicamente con confirmación.

`bin/worktree list` muestra los worktrees del proyecto y si tienen cambios.

## Archivos no versionados

Un proyecto puede versionar `.agent/worktree-files` con una ruta relativa por
línea (se admiten líneas vacías y comentarios con `#`). Al crear o reutilizar un
worktree se copian las rutas que existan en el checkout principal y falten en el
worktree, sin sobrescribir nada. Sirve para archivos como `.env`; no lo uses
para dependencias o artefactos que se puedan regenerar.

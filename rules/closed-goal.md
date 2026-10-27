# Cierre autónomo de la conversación

La persona puede delegar una conversación completa hasta su cierre con la frase
«Continúa hasta dar esta conversación por closed», normalmente como objetivo de
`/goal` en Claude Code. La forma abreviada `/goal Close` (un objetivo que
consiste solo en «Close», sin distinguir mayúsculas) equivale a la frase
completa. Reconoce también variantes evidentes de la frase (sin tilde, con
«cerrada» en lugar de «closed», con otra puntuación). Se aplica a cualquier
proyecto y al propio harness.

## Qué significa

Sigue trabajando, sin detenerte a preguntar, hasta cumplir **todo** el objetivo
de la conversación: lo pedido al principio y lo acordado después. La
conversación está cerrada solo cuando se cumple todo lo que aplique:

- el trabajo está implementado y pasan las validaciones que define el proyecto;
- la documentación, el changelog y el historial afectados están al día;
- si hay worktree, la rama se ha integrado en la rama principal con
  `bin/worktree merge` y se ha eliminado el worktree con `bin/worktree remove`,
  según [`worktrees.md`](worktrees.md);
- si se ha trabajado directamente en el checkout principal, los cambios tienen
  commit en la rama principal y, si esta sigue una rama remota, están subidos.
  Si hay otra rama o PR abierta de la conversación, también está integrada en
  la rama principal y borrada;
- no queda nada en curso que dependa de esta sesión;
- la sesión está marcada como cerrada con `<harness>/bin/session-title --closed`
  según [`session-title.md`](session-title.md). Hazlo siempre como último paso,
  haya o no worktree, y solo cuando lo anterior se cumpla.

## Autorización que concede

La frase es la autorización explícita de la persona para todo lo que el
`AGENTS.md` global y las reglas condicionan a su confirmación, mientras sirva al
objetivo y no sea peligroso ni destructivo:

- usar OpenSpec y crear un worktree cuando lo justifiquen sus criterios;
- hacer commits, subir ramas, abrir la PR, integrarla en la rama principal y
  borrar el worktree y la rama ya integrada;
- registrar backlog, crear guías o generar imágenes si aportan al objetivo;
- lanzar las pruebas mutables del QA en el entorno de desarrollo;
- decidir sobre el diseño previo en lugar de esperar: si no hay diseño cerrado
  en Claude Design, implementa siguiendo el estilo existente del proyecto.

Ante cualquier duda o ambigüedad (requisitos, nombres, enfoque, alcance de
detalle), elige la opción más razonable, reversible y coherente con el proyecto
y continúa. No inventes decisiones de producto de alto impacto que no se
deduzcan del objetivo: toma la variante mínima que lo cumpla y anótalo.

## Límites

La autorización no cubre acciones peligrosas o destructivas. Para estas,
detente y pregunta aunque el modo esté activo:

- reescribir o borrar historial publicado (`push --force`, `reset --hard` sobre
  trabajo ajeno, borrar ramas no integradas);
- descartar o sobrescribir cambios locales que no sean de esta sesión;
- borrar datos, bases de datos o archivos fuera de lo que la propia tarea creó;
- desplegar a producción, tocar servicios externos con efectos reales, gastar
  dinero o manejar secretos;
- modificar otros proyectos de `projects/`;
- saltarse validaciones (`--no-verify`, desactivar tests o checks) para cerrar.

Si un check falla o el merge no es posible, corrige y repite; no fuerces la
integración. Si algo bloquea de verdad el cierre (credenciales, `gh` sin sesión,
una acción de las anteriores), deja todo en un estado limpio y retomable y
explica exactamente qué falta.

## Al terminar

Registra el historial según [`history.md`](history.md) con una sección
«Decisiones» que recoja las asunciones tomadas sin preguntar, para que la
persona pueda revisarlas. La respuesta final resume lo hecho, esas decisiones y
la evidencia del cierre (validaciones, PR o commit integrado, worktree
eliminado, sesión marcada con `[Closed]`).

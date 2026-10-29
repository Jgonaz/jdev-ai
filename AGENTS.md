# Instrucciones globales de jdev-ai

## Rutas y ámbito

- `<harness>` es el directorio que contiene este archivo. Las rutas
  `<harness>/rules/`, `<harness>/workflows/` y `<harness>/adapters/` siempre
  apuntan al harness, también cuando trabajes desde `<harness>/projects/<nombre>/`.
- El resto de rutas (`AGENTS.md` del proyecto, `openspec/`, `docs/backlog/`,
  `docs/user-guides/`, `.agent/memory/`, `.agent/history/` y el changelog) se
  refieren a la raíz del **proyecto afectado**.
- Cuando trabajes en un proyecto, nunca escribas sus artefactos en el harness.
  Solo cuando la tarea modifica el propio harness, el harness es el proyecto
  afectado y usa sus propios `openspec/` y `.agent/history/`. Su validación
  es `<harness>/bin/check`.

## Reglas

- Comunícate en castellano de España, también en la documentación, los commits
  y los comentarios, salvo que el proyecto o el contexto indiquen otro idioma.
- Antes de trabajar en un proyecto, lee su `AGENTS.md` si existe; sus
  instrucciones prevalecen sobre estas. El dominio, la arquitectura, el stack y
  las validaciones son de cada proyecto: no asumas stack, gestor de paquetes ni
  comandos comunes.
- No modifiques otros proyectos de `<harness>/projects/` distintos del solicitado.
- Preserva los cambios locales del usuario; no los sobrescribas ni reviertas sin permiso.
- No inventes requisitos, contratos, modelos de datos ni decisiones de producto:
  pregunta. Usa una asunción declarada solo si es reversible y de bajo riesgo.
- No añadas dependencias ni herramientas sin justificarlo. Evita documentación,
  abstracciones y procesos sin un valor claro.
- Explica el porqué de las decisiones y señala los riesgos, efectos secundarios
  y edge cases relevantes. Comenta solo la intención de la lógica no obvia.
- Antes de terminar, ejecuta únicamente las validaciones definidas por el proyecto afectado.
- Mantén al día la documentación afectada; crea documentación nueva solo si
  aporta un valor claro. Si el cambio es visible para los usuarios o
  consumidores del proyecto (funcionalidad, comportamiento, contrato o
  configuración), actualiza el changelog que defina; los refactors, tests y
  ajustes internos no lo requieren salvo que el proyecto diga otra cosa. No
  crees un changelog si el proyecto no lo contempla.
- Al acabar cada iteración, termina la respuesta con `Siguiente paso recomendado: ...`.

## Procesos

Lee cada regla cuando se dé su caso:

- Cambios grandes o funcionalmente relevantes: `<harness>/workflows/feature.md`
  decide si propones, sin esperar a que te lo pidan, OpenSpec, un worktree o
  cerrar antes el diseño en Claude Design. Ninguno empieza sin visto bueno
  explícito ni se aplica a cambios pequeños.
- Planificación con una implementación relevante: `<harness>/rules/delegation.md`;
  no delegues trabajo trivial.
- Antes de terminar una iteración relevante (su apartado «Cuándo registrar»),
  registra el historial según `<harness>/rules/history.md`. Para ponerse al día
  o retomar el proyecto, sigue su apartado «Puesta al día».
- Memoria auxiliar del proyecto: `<harness>/rules/memory.md`, solo con contexto
  histórico relevante y nunca en lugar de las fuentes autoritativas.
- Trabajo futuro fuera del alcance y con evidencia clara: propónlo según
  `<harness>/rules/backlog.md` y regístralo solo tras confirmación explícita.
- Funcionalidad que necesite explicarse o recordarse sin contexto previo:
  guías según `<harness>/rules/user-guides.md`.
- Imágenes que el proyecto no tenga: propón generarlas sin esperar a que te lo
  pidan, según `<harness>/rules/images.md`, y genéralas solo tras confirmación.
- En Claude Code, título de la sesión y marca `[Closed]` según
  `<harness>/rules/session-title.md`.

## Autorizaciones

- Sin petición explícita, no hagas commits, pushes, merges ni acciones
  destructivas, y no crees ni cambies de rama ni abras Pull Requests.
- Commits con Conventional Commits y, en el cuerpo, un bullet por archivo
  modificado con qué cambió y por qué. Usa `--no-verify` solo cuando esté
  justificado y deja constancia del motivo.
- Worktrees (`<harness>/rules/worktrees.md`): aceptar el worktree, o abrir la
  sesión con `--wt`, autoriza a crearlo, a hacer commits en su rama y a
  subirla. Confirmar la integración autoriza a abrir la PR, integrarla en la
  rama destino y borrar el worktree y la rama. Mientras trabajes en él, no
  modifiques el checkout principal ni otros worktrees.
- Cierre autónomo (`<harness>/rules/closed-goal.md`): «Continúa hasta dar esta
  conversación por closed», o `/goal Close`, autoriza todo lo anterior salvo
  acciones peligrosas o destructivas. Trabaja sin pedir confirmación hasta
  cumplir todo el objetivo, incluida la integración en la rama principal y el
  borrado del worktree.

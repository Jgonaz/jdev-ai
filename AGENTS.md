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

- Comunícate por defecto en castellano de España, incluida la documentación, salvo que el contexto justifique otro idioma.
- Antes de trabajar en un proyecto, lee su `AGENTS.md` si existe. Sus instrucciones específicas prevalecen sobre estas.
- Este harness contiene procesos compartidos; cada proyecto contiene su dominio, arquitectura, stack y reglas.
- Para cambios grandes o funcionalmente relevantes, revisa `<harness>/workflows/feature.md` y determina si procede OpenSpec. Si procede, propón su uso y espera el visto bueno explícito del desarrollador antes de instalarlo, inicializarlo o crear/modificar sus artefactos; no lo trates como requisito para cambios pequeños.
- Para tareas que requieran planificación y una implementación relevante, aplica `<harness>/rules/delegation.md`; evita delegar trabajo trivial.
- Usa la memoria auxiliar de cada proyecto según `<harness>/rules/memory.md`; consúltala o actualízala solo cuando exista contexto histórico relevante y nunca como sustituto de las fuentes autoritativas.
- Antes de terminar una iteración relevante, registra un resumen compacto en el historial local del proyecto afectado según `<harness>/rules/history.md`. Una iteración es relevante cuando cumple los criterios de su apartado «Cuándo registrar»; omite las interacciones triviales. Si el usuario pide ponerse al día o retomar el proyecto, sigue su apartado «Puesta al día».
- Detecta y, cuando exista evidencia clara, propone el trabajo futuro que no deba abordarse en la tarea actual según `<harness>/rules/backlog.md`; solo lo registra en `docs/backlog/` del proyecto afectado tras confirmación explícita y sin ampliar el alcance en curso.
- Valora crear o actualizar guías didácticas para personas según `<harness>/rules/user-guides.md` cuando una funcionalidad necesite explicarse o recordarse sin contexto previo.
- Cuando un desarrollo necesite imágenes que el proyecto no tenga, propón generarlas sin esperar a que te lo pidan, según `<harness>/rules/images.md`; genéralas solo tras confirmación explícita.
- No modifiques otros proyectos de `<harness>/projects/` distintos del solicitado.
- No asumas un stack, gestor de paquetes ni comandos de validación comunes.
- Preserva los cambios locales del usuario; no los sobrescribas ni reviertas sin permiso.
- No inventes requisitos, contratos, modelos de datos ni decisiones de producto. Si falta información relevante, pregunta al usuario; utiliza una asunción declarada únicamente cuando sea reversible y de bajo riesgo.
- No añadas dependencias ni herramientas que no existan en el proyecto sin justificarlo.
- Explica el porqué de las decisiones y señala los riesgos, efectos secundarios y edge cases relevantes.
- Comenta únicamente la intención de la lógica no obvia; evita comentarios que repitan el código.
- Antes de terminar, ejecuta únicamente las validaciones definidas por el proyecto afectado.
- Evita documentación, abstracciones y procesos sin un valor claro.
- No hagas commits, pushes, merges ni acciones destructivas sin petición explícita del usuario.
- Crea o cambia de rama y abre una Pull Request únicamente cuando el usuario lo
  solicite de forma explícita; en caso contrario, conserva la rama actual.
- Cuando el usuario solicite un commit, usa Conventional Commits y redacta el
  mensaje en castellano salvo que el proyecto indique otro idioma. En el cuerpo,
  añade un bullet por cada archivo modificado indicando qué cambió y por qué.
- Antes de cerrar un cambio que el proyecto afectado presente a sus usuarios o
  consumidores (funcionalidad, comportamiento, contrato o configuración
  visibles), actualiza el changelog que defina ese proyecto. Los refactors,
  tests y ajustes internos no lo requieren salvo que el proyecto indique otra
  cosa. No registres cambios de un proyecto en el harness ni crees un
  changelog si el proyecto no lo contempla.
- Usa `--no-verify` solo cuando esté justificado y deja constancia del motivo.
- Mantén actualizada la documentación existente afectada por cada cambio; crea documentación nueva solo cuando aporte un valor claro.
- Al acabar cada iteración, termina la respuesta con `Siguiente paso recomendado: ...`.

# Delegación entre agentes

Esta política define dos roles agnósticos al proveedor. El agente principal
actúa como **orquestador** y, cuando la herramienta lo permita, delega trabajo
acotado a un único **implementador**.

## Cuándo delegar

Delega cuando una tarea requiera planificación y contenga una implementación
relevante que pueda describirse con alcance, restricciones y validaciones
claras. No delegues consultas, cambios triviales ni trabajo cuyo coste de
coordinación supere el de resolverlo directamente.

Si el proveedor no admite subagentes compatibles, el agente principal desempeña
ambos roles de forma secuencial.

## Orquestador

- Conserva el contexto del usuario, aclara requisitos y decide el plan.
- Lee las instrucciones del proyecto y entrega al implementador solo el contexto
  necesario para ejecutar una tarea delimitada.
- Mantiene bajo su responsabilidad las decisiones de producto, los checkpoints
  con el usuario, la revisión final, los commits, la publicación y el cierre del
  historial.
- Revisa el resultado del implementador y ejecuta o confirma las validaciones
  necesarias antes de presentar el trabajo como terminado.

## Implementador

- Ejecuta únicamente el encargo recibido y respeta las instrucciones del
  proyecto afectado.
- Preserva cambios ajenos, evita ampliar el alcance y comunica cualquier bloqueo
  o decisión no prevista al orquestador.
- No realiza commits, pushes, merges ni acciones destructivas.
- Devuelve un resumen compacto de los cambios, las validaciones, los riesgos y
  los asuntos pendientes, sin volcar trazas o contexto intermedio innecesario.

Usa un solo implementador con capacidad de escritura cada vez. Añade más roles
o paralelismo únicamente cuando una necesidad real lo justifique.

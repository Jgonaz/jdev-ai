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
- Al recibir el resultado de un subagente, comprueba que no deja tareas en
  segundo plano (procesos, servidores o bucles de espera) y detén las que
  queden antes de dar el trabajo por terminado.

## Implementador

- Ejecuta únicamente el encargo recibido y respeta las instrucciones del
  proyecto afectado.
- Preserva cambios ajenos, evita ampliar el alcance y comunica cualquier bloqueo
  o decisión no prevista al orquestador.
- No realiza commits, pushes, merges ni acciones destructivas.
- Ejecuta las validaciones en primer plano con un tiempo límite explícito. Si
  una debe ir en segundo plano, espera su final con el mecanismo de aviso de la
  herramienta en lugar de bucles que sondeen una marca que podría no llegar.
- Antes de devolver el resultado, detén toda tarea que haya lanzado en segundo
  plano y que siga activa.
- Devuelve un resumen compacto de los cambios, las validaciones, los riesgos y
  los asuntos pendientes, sin volcar trazas o contexto intermedio innecesario.

## Auxiliares de solo lectura

Cuando el proveedor lo permita, el orquestador puede delegar en auxiliares sin
capacidad de escritura que usen un modelo más ligero:

- **Explorador**: localiza código, recorre el repositorio o lee documentación
  cuando haría falta leer mucho y solo importa la conclusión.
- **Validador**: ejecuta las validaciones del proyecto, reproduce cada fallo
  antes de diagnosticarlo y devuelve solo los fallos con su causa, marcada como
  confirmada o como hipótesis, para no cargar logs largos en el orquestador.

No modifican archivos del proyecto ni toman decisiones; el orquestador interpreta lo que
devuelven. Pueden ejecutarse en paralelo entre sí, pero no sustituyen la
revisión final del orquestador.

Usa un solo implementador con capacidad de escritura cada vez. Añade más roles
o paralelismo únicamente cuando una necesidad real lo justifique.

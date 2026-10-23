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
- Antes de cada delegación, anuncia a la persona en una línea en qué subagente
  delega, para qué y por qué no lo resuelve directamente.
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

## QA

Cuando el proveedor lo permita, al cerrar una implementación relevante con
interfaz el orquestador puede delegar en un auxiliar de **QA** sin capacidad de
escritura. El QA verifica la funcionalidad de punta a punta en el navegador. No
lo lances tras cada cambio menor, porque su coste es alto.

- **Encargo.** El orquestador le pasa el alcance o el diff, la spec de OpenSpec
  si existe y la referencia de diseño. Por defecto, la referencia es la URL del
  artifact de Claude Design. Puede añadir lo que la persona quiera que se pruebe
  y, solo si lo ha indicado, un entorno distinto del de desarrollo.
- **Entorno.** El QA prueba en el entorno de desarrollo que declare el apartado
  `## QA` del `AGENTS.md` del proyecto. Ese apartado incluye el arranque, la
  URL, los datos de prueba, lo que es seguro en ese entorno y las convenciones
  e2e. Si falta un dato imprescindible, el QA devuelve un bloqueo en lugar de
  inventarlo.
- **Cobertura.** Además del happy path, cubre las validaciones, los errores, los
  estados vacíos y de carga, los permisos, la navegación, el responsive y la
  accesibilidad básica, y declara lo que no cubre.
- **Pruebas mutables.** Son las que persisten datos o tienen efectos externos,
  y ante la duda una prueba se considera mutable. El QA no ejecuta ninguna sin
  autorización: primero hace las no mutables y devuelve la lista de las
  mutables con sus efectos y cómo se revierten. El orquestador presenta esa
  lista a la persona y espera su respuesta. Después retoma al mismo QA con su
  contexto (en Claude, con `SendMessage`) y le indica solo las pruebas
  aprobadas.
- **Diseño.** El QA compara el diseño y la app en los mismos viewports y
  reporta cada desviación con captura de ambos y su gravedad. Lo que el diseño
  no define lo marca como «no especificado».
- **Tests e2e.** El QA no escribe tests. Devuelve la especificación de los que
  merezcan quedar como regresión. Si la persona quiere conservarlos, el
  orquestador encarga al implementador que los escriba y al validador que los
  ejecute.
- **Revisión.** El QA marca cada fallo como confirmado o hipótesis. El
  orquestador decide qué arreglar y comprueba que no quedan servidores ni
  navegadores abiertos.

Usa un solo implementador con capacidad de escritura cada vez. Añade más roles
o paralelismo únicamente cuando una necesidad real lo justifique.

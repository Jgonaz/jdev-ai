# Delegación entre agentes

Esta política define roles agnósticos al proveedor. El agente principal actúa
como **orquestador** y, cuando la herramienta lo permita, delega trabajo
acotado en un único **implementador** con capacidad de escritura cada vez. Añade
más roles o paralelismo únicamente cuando una necesidad real lo justifique.

## Cuándo delegar

Delega cuando una tarea requiera planificación y contenga una implementación
relevante que pueda describirse con alcance, restricciones y validaciones
claras. No delegues consultas, cambios triviales ni trabajo cuyo coste de
coordinación supere el de resolverlo directamente.

Si el proveedor no admite subagentes compatibles, el agente principal desempeña
ambos roles de forma secuencial.

## Orquestador

- Conserva el contexto del usuario, aclara requisitos y decide el plan.
- Lee las instrucciones del proyecto y entrega al subagente solo el contexto
  necesario para ejecutar una tarea delimitada.
- Antes de cada delegación, explica a la persona en una línea para qué delega y
  por qué no lo resuelve directamente. En Claude Code, un hook ya muestra el
  subagente y su modelo.
- Mantiene bajo su responsabilidad las decisiones de producto, los checkpoints
  con el usuario, la revisión final, los commits, la publicación y el cierre del
  historial.
- Revisa el resultado del implementador y ejecuta o confirma las validaciones
  necesarias antes de presentar el trabajo como terminado.
- Al recibir el resultado de un subagente, comprueba que no deja tareas en
  segundo plano (procesos, servidores o bucles de espera) y detén las que
  queden antes de dar el trabajo por terminado.

## Subagentes

Sus instrucciones completas viajan en el prompt de cada adaptador
(`adapters/claude/agents.json` y `adapters/codex/implementer.toml`), que se
mantiene alineado con este resumen:

- **Implementador**: ejecuta solo el encargo, preserva los cambios ajenos, no
  hace commits, pushes, merges ni acciones destructivas, valida en primer plano
  con tiempo límite, detiene lo que lance en segundo plano y devuelve un
  resumen compacto de cambios, validaciones, riesgos y pendientes.
- **Explorador** (solo lectura, modelo ligero): localiza código, recorre el
  repositorio o lee documentación cuando haría falta leer mucho y solo importa
  la conclusión.
- **Validador** (solo lectura, modelo ligero): ejecuta las validaciones del
  proyecto, reproduce cada fallo antes de diagnosticarlo y devuelve solo los
  fallos con su causa, confirmada o como hipótesis.

Los auxiliares de solo lectura no toman decisiones; el orquestador interpreta lo
que devuelven. Pueden ejecutarse en paralelo entre sí, pero no sustituyen la
revisión final del orquestador.

## QA

Cuando el proveedor lo permita, al cerrar una implementación relevante con
interfaz el orquestador puede delegar en el **QA**, sin capacidad de escritura,
que la verifica de punta a punta en el navegador. No lo lances tras cada cambio
menor, porque su coste es alto.

- **Encargo.** Pásale el alcance o el diff, la spec de OpenSpec si existe y la
  URL del artifact de Claude Design como referencia de diseño. Añade lo que la
  persona quiera que se pruebe y, solo si lo ha indicado, un entorno distinto
  del de desarrollo.
- **Entorno.** El QA usa el apartado `## QA` del `AGENTS.md` del proyecto:
  arranque, URL, datos de prueba, lo que es seguro en ese entorno y las
  convenciones e2e. Si falta un dato imprescindible, devuelve un bloqueo.
- **Pruebas mutables.** Son las que persisten datos o tienen efectos externos.
  El QA hace primero las no mutables y devuelve la lista de mutables con sus
  efectos y cómo se revierten. Presenta esa lista a la persona, espera su
  respuesta y retoma al mismo QA con su contexto (en Claude, con `SendMessage`)
  indicándole solo las pruebas aprobadas.
- **Tests e2e.** El QA no escribe tests: devuelve la especificación de los que
  merezcan quedar como regresión. Si la persona quiere conservarlos, encarga al
  implementador que los escriba y al validador que los ejecute.
- **Revisión.** El QA marca cada fallo como confirmado o hipótesis y cada
  desviación de diseño con su gravedad. El orquestador decide qué arreglar y
  comprueba que no quedan servidores ni navegadores abiertos.

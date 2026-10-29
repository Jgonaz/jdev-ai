# Workflow para features

Este flujo no se aplica automáticamente a cada cambio ni por el hecho de hacer commit, subir una rama o abrir una PR. El agente debe inferir primero si el cambio necesita OpenSpec, un worktree o un diseño previo, o si basta el flujo normal.

## Decidir el flujo

Usa OpenSpec cuando el cambio tenga un impacto que se beneficie de acordar requisitos y escenarios antes de implementar. Son señales habituales:

- comportamiento visible para usuarios o nuevas reglas de negocio;
- cambios en contratos públicos, APIs, datos, migraciones, compatibilidad, permisos o seguridad;
- decisiones arquitectónicas, integraciones o efectos en varias partes del sistema;
- despliegues, migraciones, rollbacks o riesgos operativos relevantes;
- requisitos ambiguos, varias alternativas razonables o coordinación entre varias iteraciones o personas.

Una sola señal puede justificar OpenSpec cuando afecta a contratos, datos, seguridad o arquitectura. En los demás casos, valora el conjunto de alcance, riesgo y ambigüedad. No lo uses solo por el tamaño del diff o por la forma en que se publicará el cambio.

Usa el flujo normal para correcciones que restauran el comportamiento esperado, cambios internos o refactors sin cambio funcional, tests, ajustes de configuración, documentación, textos, estilos o pequeñas mejoras claramente acotadas y reversibles.

## Propuesta inicial

Antes de modificar nada, valora estas tres propuestas, que son independientes. Si procede más de una, preséntalas juntas en un solo mensaje:

- **OpenSpec**, si el cambio supera el umbral anterior. Explica por qué, el alcance y la unidad de cambio, los riesgos, contratos o decisiones que requieren revisión, y los artefactos y checkpoints previstos.
- **Worktree**, si es un cambio grande en un proyecto de `projects/`, con los mismos criterios aunque no se use OpenSpec. Sigue [`rules/worktrees.md`](../rules/worktrees.md). Los artefactos OpenSpec se crearán en el worktree.
- **Diseño en Claude Design**, si la feature implica cambios de interfaz no triviales. Sigue [`rules/design.md`](../rules/design.md).

Hasta el visto bueno explícito, no instales, inicialices ni modifiques nada en el `openspec/` del proyecto, no crees el worktree y no implementes esa interfaz hasta que la persona apruebe el diseño o rechace la propuesta. Una petición genérica de implementar una feature no equivale a esa aprobación. Si se rechaza OpenSpec, aplica el flujo normal, salvo que falte una decisión de producto o de alcance que obligue a pedir aclaración. Si ya existe un cambio OpenSpec activo que cubre claramente la petición, no crees otro: comprueba su alcance y continúa únicamente dentro de lo aprobado.

## Implementar

1. Lee el contexto, el `AGENTS.md` y la documentación del proyecto afectado, y comprueba la documentación y las specs que puedan verse afectadas.
2. Con OpenSpec, además:
   - entiende el cambio, sus usuarios y sus límites, y confirma que es una unidad de cambio coherente o divídelo;
   - crea o actualiza sus artefactos siguiendo la CLI y la documentación de la versión instalada;
   - revisa con el desarrollador los requisitos, el alcance y los riesgos antes de implementar;
   - antes de modificar contratos públicos, datos, seguridad o una decisión arquitectónica relevante, explica el impacto y abre un checkpoint específico.
3. Implementa el alcance acordado sin acoplar otros proyectos. Si aparece una decisión sustancial no prevista, detente, presenta opciones y recomienda una.
4. Ejecuta las validaciones definidas por el proyecto.
5. Actualiza la documentación afectada y valora si corresponde una guía bajo `docs/user-guides/`, siguiendo [`rules/user-guides.md`](../rules/user-guides.md).
6. Resume qué se ha hecho, qué se ha validado y qué riesgos quedan pendientes.

## Publicar

Si el cambio usa OpenSpec y hay commits autorizados, alinéalos con los hitos de sus tareas salvo que un cambio pequeño justifique agruparlos.

Antes de publicar, presenta el alcance final, los artefactos OpenSpec cuando existan, la documentación actualizada, los commits, las validaciones, los riesgos y los pasos operativos pendientes. El `push` y la PR siguen las autorizaciones de `AGENTS.md`, incluidas las del flujo de worktrees.

No crees proposals, specs, planes o tasks paralelos que dupliquen OpenSpec.

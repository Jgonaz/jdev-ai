# Workflow para features

Este flujo no se aplica automáticamente a cada cambio ni por el hecho de hacer commit, subir una rama o abrir una PR. El agente debe inferir primero si el cambio necesita OpenSpec o si basta el flujo normal.

## Decidir el flujo

Usa OpenSpec cuando el cambio tenga un impacto que se beneficie de acordar requisitos y escenarios antes de implementar. Son señales habituales:

- comportamiento visible para usuarios o nuevas reglas de negocio;
- cambios en contratos públicos, APIs, datos, migraciones, compatibilidad, permisos o seguridad;
- decisiones arquitectónicas, integraciones o efectos en varias partes del sistema;
- despliegues, migraciones, rollbacks o riesgos operativos relevantes;
- requisitos ambiguos, varias alternativas razonables o coordinación entre varias iteraciones o personas.

Una sola señal puede justificar OpenSpec cuando afecta a contratos, datos, seguridad o arquitectura. En los demás casos, valora el conjunto de alcance, riesgo y ambigüedad. No lo uses solo por el tamaño del diff o por la forma en que se publicará el cambio.

Usa el flujo normal para correcciones que restauran el comportamiento esperado, cambios internos o refactors sin cambio funcional, tests, ajustes de configuración, documentación, textos, estilos o pequeñas mejoras claramente acotadas y reversibles. Estos cambios pueden requerir actualizar documentación o changelog si cambian algo que el proyecto ya presenta a sus usuarios, pero no necesitan proposals, specs ni tasks OpenSpec por defecto.

## Aprobación previa de OpenSpec

Si el agente considera que OpenSpec puede ser adecuado, debe detenerse antes de instalarlo, inicializarlo o crear/modificar cualquier artefacto dentro de `openspec/`. Primero presentará una propuesta breve con:

- por qué el cambio supera el umbral del flujo normal;
- alcance y unidad de cambio que propone;
- riesgos, contratos o decisiones que requieren revisión;
- artefactos y checkpoints OpenSpec previstos.

Solo después del visto bueno explícito del desarrollador puede continuar con OpenSpec. Una petición genérica de implementar una feature no equivale a esa aprobación. Si no se aprueba, aplica el flujo normal, salvo que falte una decisión de producto o de alcance que obligue a pedir aclaración. Si ya existe un cambio OpenSpec activo que cubre claramente la petición, no crees otro: comprueba su alcance y continúa únicamente dentro de lo aprobado.

## Flujo normal

Para cambios que no justifican OpenSpec:

1. Lee el contexto, `AGENTS.md` y la documentación del proyecto afectado.
2. Comprueba la documentación y las specs existentes que puedan verse afectadas.
3. Implementa el alcance acotado sin crear artefactos OpenSpec.
4. Ejecuta únicamente las validaciones definidas por el proyecto.
5. Actualiza la documentación afectada y valora si corresponde una guía bajo `docs/user-guides/`, siguiendo `rules/user-guides.md`.
6. Resume el cambio, las validaciones y los riesgos pendientes.

## Flujo con OpenSpec

Después de la aprobación:

1. Lee el contexto, `AGENTS.md` y la documentación del proyecto afectado.
2. Entiende el cambio solicitado, sus usuarios y sus límites.
3. Comprueba la documentación y las specs existentes.
4. Confirma que constituye una unidad de cambio coherente o divídelo si procede.
5. Crea o actualiza los artefactos OpenSpec dentro del proyecto, siguiendo la CLI y documentación de la versión instalada.
6. Revisa con el desarrollador los requisitos, el alcance y los riesgos reflejados en OpenSpec antes de implementar.
7. Si el cambio afecta contratos públicos, datos, seguridad o una decisión arquitectónica relevante, explica el impacto y abre un checkpoint específico antes de modificar esa parte.
8. Implementa el alcance acordado sin acoplar otros proyectos. Si aparece una decisión sustancial no prevista, detente, presenta opciones y recomienda una.
9. Ejecuta únicamente las validaciones definidas por el proyecto.
10. Actualiza la documentación afectada y valora si la funcionalidad necesita crear o actualizar una guía bajo `docs/user-guides/`, siguiendo `rules/user-guides.md`.
11. Resume qué se ha hecho, qué se ha validado y qué riesgos quedan pendientes.

Si el cambio usa OpenSpec y el usuario autoriza commits, alinéalos con los hitos
de sus tareas salvo que un cambio pequeño justifique agruparlos.

Antes de publicar, presenta el alcance final, los artefactos OpenSpec cuando
existan, la documentación actualizada, los commits, las validaciones, los
riesgos y los pasos operativos pendientes. El `push` y la apertura de una PR
requieren autorización explícita del usuario.

No crees proposals, specs, planes o tasks paralelos que dupliquen OpenSpec.

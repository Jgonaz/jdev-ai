# Workflow para features

Usa este flujo para cambios grandes o con impacto funcional relevante. Para una corrección trivial, una feature pequeña o un refactor menor, valora el alcance y evita crear artefactos innecesarios.

El agente debe conducir activamente los checkpoints: plantea las decisiones cuando correspondan y, una vez aprobadas, avanza hasta el siguiente hito permitido sin esperar otro recordatorio.

1. Lee el contexto, `AGENTS.md` y la documentación del proyecto afectado.
2. Entiende el cambio solicitado, sus usuarios y sus límites.
3. Comprueba la documentación y las specs existentes.
4. Determina si el alcance justifica OpenSpec y si constituye una unidad de cambio coherente o debe dividirse.
5. Si lo justifica, crea o actualiza los artefactos OpenSpec dentro del proyecto, siguiendo la CLI y documentación de la versión instalada.
6. Revisa con el usuario los requisitos, el alcance y los riesgos reflejados en OpenSpec antes de implementar.
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

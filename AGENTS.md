# Instrucciones globales de jdev-ai

- Comunícate por defecto en castellano de España, incluida la documentación, salvo que el contexto justifique otro idioma.
- Antes de trabajar en un proyecto, lee su `AGENTS.md` si existe. Sus instrucciones específicas prevalecen sobre estas.
- Este harness contiene procesos compartidos; cada proyecto contiene su dominio, arquitectura, stack y reglas.
- Para cambios grandes o funcionalmente relevantes, revisa `workflows/feature.md` y utiliza OpenSpec dentro del proyecto afectado.
- No modifiques otros proyectos de `projects/` distintos del solicitado.
- No asumas un stack, gestor de paquetes ni comandos de validación comunes.
- Preserva los cambios locales del usuario; no los sobrescribas ni reviertas sin permiso.
- No inventes requisitos, contratos, modelos de datos ni decisiones de producto. Si falta información relevante, pregunta al usuario; utiliza una asunción declarada únicamente cuando sea reversible y de bajo riesgo.
- No añadas dependencias ni herramientas que no existan en el proyecto sin justificarlo.
- Explica el porqué de las decisiones y señala los riesgos, efectos secundarios y edge cases relevantes.
- Comenta únicamente la intención de la lógica no obvia; evita comentarios que repitan el código.
- Antes de terminar, ejecuta únicamente las validaciones definidas por el proyecto afectado.
- Evita documentación, abstracciones y procesos sin un valor claro.
- No hagas commits, pushes, merges ni acciones destructivas sin petición explícita del usuario.
- Usa `--no-verify` solo cuando esté justificado y deja constancia del motivo.
- Mantén actualizada la documentación afectada por cada cambio.
- Al acabar cada iteración, termina la respuesta con `Siguiente paso recomendado: ...`.

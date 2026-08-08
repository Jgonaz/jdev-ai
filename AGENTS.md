# Instrucciones globales de jdev-ai

- Comunícate por defecto en castellano de España, incluida la documentación, salvo que el contexto justifique otro idioma.
- Antes de trabajar en un proyecto, lee su `AGENTS.md` si existe. Sus instrucciones específicas prevalecen sobre estas.
- Este harness contiene procesos compartidos; cada proyecto contiene su dominio, arquitectura, stack y reglas.
- Para cambios grandes o funcionalmente relevantes, revisa `workflows/feature.md` y utiliza OpenSpec dentro del proyecto afectado.
- No modifiques otros proyectos de `projects/` distintos del solicitado.
- No asumas un stack, gestor de paquetes ni comandos de validación comunes.
- Antes de terminar, ejecuta únicamente las validaciones definidas por el proyecto afectado.
- Evita documentación, abstracciones y procesos sin un valor claro.
- No hagas commits, pushes, merges ni acciones destructivas sin petición explícita del usuario.
- Mantén actualizada la documentación afectada por cada cambio.
- Al acabar cada iteración, termina la respuesta con `Siguiente paso recomendado: ...`.

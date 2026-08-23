## Context

El backlog ya define un flujo explícito de registro bajo `docs/backlog/` y exige que los elementos pertenezcan al proyecto afectado. Esta extensión solo cambia el criterio con el que el agente puede ofrecer ese flujo: no añade un parser, un servicio ni una integración, y debe conservar la autorización de la persona antes de escribir documentación.

## Goals / Non-Goals

**Goals:**

- Convertir hallazgos evidentes que quedan fuera de alcance en sugerencias breves y accionables.
- Mantener una frontera clara entre detectar, sugerir y registrar.
- Reducir duplicados y ruido mediante evidencia, búsqueda del backlog y exclusión de observaciones subjetivas.
- Tratar riesgos críticos como comunicación inmediata, con prioridad sobre el flujo diferido.

**Non-Goals:**

- Clasificar automáticamente cualquier comentario como finding.
- Crear archivos, cambiar estados o modificar el proyecto sin confirmación.
- Sustituir la evaluación de alcance, severidad u OpenSpec.
- Añadir configuración global de umbrales, métricas de sugerencias o cambios en el launcher.

## Decisions

### La sugerencia es una interacción, no una escritura diferida

El agente propondrá el elemento en la respuesta cuando disponga de evidencia suficiente y la tarea llegue a un punto natural, pero no tocará `docs/backlog/` hasta recibir una confirmación explícita. Tras la confirmación reutilizará el flujo de registro existente y devolverá la ruta e identificador.

Alternativas consideradas: registrar automáticamente, descartado porque introduciría cambios persistentes sin autorización; y esperar siempre a una orden literal, descartado porque pierde hallazgos que la persona no formula como backlog.

### Umbral basado en evidencia y acción futura

La sugerencia requiere un problema reproducible, una limitación observable o una mejora concreta con un siguiente paso razonable, además de quedar fuera del alcance actual. Las sospechas no verificadas, preferencias de estilo, refactors hipotéticos y problemas ya resueltos no generan sugerencias. Si el hallazgo puede resolverse dentro de la tarea autorizada, se trata como parte de ella y no como backlog.

### Comprobación de duplicados antes de sugerir

Antes de proponer un elemento, el agente buscará coincidencias en los estados abiertos (`pending` e `in-progress`). Si encuentra una entrada equivalente, informará de ella o añadirá contexto solo si la persona lo pide, sin sugerir un duplicado.

### Priorización de riesgos críticos

Un riesgo inmediato de seguridad, pérdida de datos, corrupción o bloqueo se comunica en el momento y no se presenta como un pendiente normal. Esta regla evita que la comodidad del backlog o la espera de confirmación oculte una incidencia que exige decisión inmediata.

### Sugerencias concisas y no repetitivas

La sugerencia incluirá el hallazgo, el tipo candidato y la razón por la que queda fuera del alcance. Se emitirá una sola vez por hallazgo durante la tarea; varios hallazgos relacionados pueden agruparse para no convertir la respuesta en una lista de interrupciones. La ausencia de confirmación no autoriza a insistir ni a crear el archivo.

## Risks / Trade-offs

- [Falsos positivos] → Exigir evidencia concreta y un siguiente paso accionable; excluir opiniones y sospechas.
- [Ruido en respuestas largas] → Sugerir en un punto natural, agrupar hallazgos relacionados y no repetir una sugerencia rechazada.
- [Duplicados] → Buscar elementos abiertos antes de sugerir y referenciar los existentes.
- [Minimización de incidentes graves] → Elevar inmediatamente los riesgos críticos en lugar de tratarlos como trabajo diferido.
- [Confirmación ambigua] → No escribir si la respuesta no autoriza claramente el registro; pedir aclaración solo cuando sea necesario.

## Migration Plan

No hay migración de datos. Se actualiza la regla global y la especificación; los proyectos existentes conservan sus elementos y empiezan a recibir sugerencias bajo el nuevo criterio en las siguientes sesiones. Para revertirlo, se elimina la sección de sugerencias proactivas de la regla sin tocar el backlog ya registrado.

## Open Questions

Ninguna que requiera una decisión adicional para esta extensión.

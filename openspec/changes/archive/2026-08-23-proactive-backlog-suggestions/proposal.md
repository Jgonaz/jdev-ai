## Why

Durante el trabajo, el agente puede detectar problemas claros o mejoras concretas que quedan fuera del alcance actual. Si espera siempre a que la persona pronuncie «apúntalo», algunos hallazgos accionables se pierden; si registra cualquier sospecha automáticamente, el backlog se llena de ruido y se amplía el alcance sin permiso.

## What Changes

- Permitir que el agente sugiera de forma proactiva registrar un elemento cuando detecte un hallazgo claro, accionable y fuera de la tarea actual.
- Exigir confirmación explícita antes de crear o modificar un documento del backlog a partir de una sugerencia.
- Hacer las sugerencias en un punto natural de la respuesta, sin interrumpir ni desviar la tarea activa.
- Evitar sugerencias para observaciones especulativas, preferencias subjetivas, elementos ya registrados o problemas que el agente ya haya resuelto.
- Tratar los problemas críticos de seguridad, pérdida de datos, corrupción o bloqueo como incidencias que deben comunicarse de inmediato, no como simples pendientes diferibles.
- Actualizar la regla global, la especificación y la documentación del harness sin modificar el launcher ni añadir dependencias.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `project-backlog`: amplía el comportamiento del agente para sugerir elementos claros de backlog y exigir confirmación antes de registrarlos.

## Impact

- Modifica la regla compartida `rules/backlog.md` y las referencias documentales del harness.
- Actualiza la especificación OpenSpec existente de `project-backlog`.
- No modifica APIs, código de aplicación, launcher, dependencias ni datos de proyectos concretos.

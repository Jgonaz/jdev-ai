## ADDED Requirements

### Requirement: El agente propone de forma proactiva hallazgos claros

El agente SHALL proponer registrar un elemento de backlog cuando detecte un problema, limitación o mejora futura que tenga evidencia concreta, sea accionable y quede fuera del alcance de la tarea actual. La sugerencia SHALL indicar brevemente el hallazgo y el tipo propuesto, SHALL aparecer en un punto natural de la respuesta y SHALL requerir confirmación explícita antes de crear o modificar un archivo.

El agente SHALL evitar sugerencias para observaciones especulativas, preferencias subjetivas, elementos ya resueltos o elementos equivalentes ya presentes en el backlog. Los problemas con riesgo inmediato de seguridad, pérdida de datos, corrupción o bloqueo SHALL comunicarse como incidencias prioritarias y no SHALL tratarse únicamente como trabajo diferible.

#### Scenario: Hallazgo evidente fuera del alcance

- **WHEN** el agente encuentra durante una tarea un problema reproducible que no se va a corregir en ese momento
- **THEN** propone de forma concisa registrarlo como un elemento de backlog y no crea ni modifica ningún archivo sin confirmación

#### Scenario: Observación especulativa o subjetiva

- **WHEN** el agente solo tiene una sospecha no verificada o una preferencia de diseño sin impacto accionable claro
- **THEN** no propone crear un elemento de backlog por iniciativa propia

#### Scenario: Elemento equivalente existente

- **WHEN** el agente detecta un hallazgo que ya está cubierto por un elemento abierto del backlog
- **THEN** referencia el elemento existente o informa de la relación sin proponer un duplicado

#### Scenario: Riesgo crítico inmediato

- **WHEN** el agente detecta un problema con riesgo inmediato de seguridad, pérdida de datos, corrupción o bloqueo
- **THEN** lo comunica inmediatamente como un riesgo prioritario y no lo presenta únicamente como una sugerencia de backlog diferible

## MODIFIED Requirements

### Requirement: El agente registra trabajo diferido mediante una instrucción explícita

El agente SHALL interpretar expresiones explícitas como «apunta un finding», «añade un TODO» o «registra una feature para después» como una solicitud de registro. También SHALL poder registrar una sugerencia proactiva cuando la persona la confirme explícitamente. El elemento creado SHALL incluir, como mínimo, un identificador estable, tipo, estado, fecha, contexto y siguiente paso; el tipo SHALL admitir al menos `finding`, `todo`, `fix` y `feature`, además de tipos adicionales cuando el proyecto los necesite.

#### Scenario: Hallazgo durante otra tarea

- **WHEN** la persona pide registrar un hallazgo mientras existe una tarea activa
- **THEN** el agente crea un elemento `pending` con el contexto suficiente para retomarlo y continúa la tarea activa sin implementar el hallazgo ni ampliar su alcance

#### Scenario: Solicitud insuficientemente detallada

- **WHEN** la persona solicita registrar un elemento pero faltan datos no imprescindibles para dejar constancia
- **THEN** el agente registra lo conocido, marca la información pendiente de aclaración en el documento y no inventa requisitos ni decisiones de producto

#### Scenario: Confirmación de una sugerencia proactiva

- **WHEN** la persona confirma que quiere registrar una sugerencia proactiva
- **THEN** el agente crea el elemento con el contexto observado, informa de su ruta e identificador y continúa o retoma la tarea original sin ampliarla

#### Scenario: Sugerencia no confirmada

- **WHEN** la persona no confirma una sugerencia proactiva o indica que no desea registrarla
- **THEN** el agente no crea ni modifica ningún elemento de backlog por esa sugerencia

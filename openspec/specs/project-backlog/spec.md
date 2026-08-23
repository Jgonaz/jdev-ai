# project-backlog Specification

## Purpose
Esta capacidad permite conservar trabajo futuro específico de cada proyecto como documentación versionada, para que los agentes puedan registrar hallazgos sin interrumpir la tarea actual y retomarlos posteriormente con trazabilidad.
## Requirements
### Requirement: El proyecto organiza el backlog por estado

Cada proyecto que utilice esta capacidad SHALL guardar sus elementos bajo `docs/backlog/` y SHALL organizar los archivos en las carpetas `pending/`, `in-progress/`, `done/` y `discarded/`. Cada elemento SHALL existir en un único archivo Markdown y su estado declarado SHALL coincidir con la carpeta que lo contiene.

#### Scenario: Primer elemento del proyecto

- **WHEN** se registra el primer elemento de backlog de un proyecto
- **THEN** se crea `docs/backlog/` con la carpeta de estado correspondiente y se guarda allí un archivo Markdown independiente

#### Scenario: Cambio de estado

- **WHEN** un elemento pasa de `pending` a `in-progress`, `done` o `discarded`
- **THEN** el archivo se mueve a la carpeta de destino, conserva su identificador y deja de existir en la carpeta anterior

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

### Requirement: El backlog permite consultar y retomar elementos

El agente SHALL poder listar y filtrar elementos por estado o tipo, y SHALL poder abordar un elemento identificado actualizando su estado, contexto y referencias relevantes. La resolución o descarte SHALL conservar el documento y SHALL permitir enlazar el resultado técnico, OpenSpec, commit o PR cuando exista.

#### Scenario: Consulta filtrada

- **WHEN** la persona pide los findings pendientes
- **THEN** el agente devuelve únicamente los elementos de tipo `finding` que se encuentren en estados abiertos, especialmente `pending` o `in-progress`

#### Scenario: Elemento resuelto

- **WHEN** se completa el trabajo asociado a un elemento
- **THEN** el agente mueve el archivo a `done`, actualiza su estado y registra la referencia al resultado cuando esté disponible

### Requirement: El backlog mantiene separadas las fuentes de contexto

Los elementos de backlog SHALL pertenecer al repositorio del proyecto y SHALL representar trabajo futuro accionable. El agente SHALL mantenerlos diferenciados del historial de iteraciones, la memoria auxiliar y las especificaciones OpenSpec; cuando un elemento requiera requisitos, escenarios o diseño formal, SHALL poder enlazarse o promoverse a OpenSpec sin duplicar su contenido innecesariamente.

#### Scenario: Proyecto independiente

- **WHEN** se registra un elemento en un proyecto alojado bajo `projects/<nombre>`
- **THEN** el archivo se crea en el repositorio Git de ese proyecto y no en la documentación versionada del harness principal

#### Scenario: Trabajo que requiere especificación

- **WHEN** un elemento de backlog revela una decisión funcional o arquitectónica relevante
- **THEN** el agente propone o utiliza OpenSpec según las reglas del harness y conserva en el backlog la referencia al cambio correspondiente

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


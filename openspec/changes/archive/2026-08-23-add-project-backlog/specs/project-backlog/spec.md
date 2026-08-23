## Purpose

Esta capacidad permite conservar trabajo futuro específico de cada proyecto como documentación versionada, para que los agentes puedan registrar hallazgos sin interrumpir la tarea actual y retomarlos posteriormente con trazabilidad.

## ADDED Requirements

### Requirement: El proyecto organiza el backlog por estado

Cada proyecto que utilice esta capacidad SHALL guardar sus elementos bajo `docs/backlog/` y SHALL organizar los archivos en las carpetas `pending/`, `in-progress/`, `done/` y `discarded/`. Cada elemento SHALL existir en un único archivo Markdown y su estado declarado SHALL coincidir con la carpeta que lo contiene.

#### Scenario: Primer elemento del proyecto

- **WHEN** se registra el primer elemento de backlog de un proyecto
- **THEN** se crea `docs/backlog/` con la carpeta de estado correspondiente y se guarda allí un archivo Markdown independiente

#### Scenario: Cambio de estado

- **WHEN** un elemento pasa de `pending` a `in-progress`, `done` o `discarded`
- **THEN** el archivo se mueve a la carpeta de destino, conserva su identificador y deja de existir en la carpeta anterior

### Requirement: El agente registra trabajo diferido mediante una instrucción explícita

El agente SHALL interpretar expresiones explícitas como «apunta un finding», «añade un TODO» o «registra una feature para después» como una solicitud de registro. El elemento creado SHALL incluir, como mínimo, un identificador estable, tipo, estado, fecha, contexto y siguiente paso; el tipo SHALL admitir al menos `finding`, `todo`, `fix` y `feature`, además de tipos adicionales cuando el proyecto los necesite.

#### Scenario: Hallazgo durante otra tarea

- **WHEN** la persona pide registrar un hallazgo mientras existe una tarea activa
- **THEN** el agente crea un elemento `pending` con el contexto suficiente para retomarlo y continúa la tarea activa sin implementar el hallazgo ni ampliar su alcance

#### Scenario: Solicitud insuficientemente detallada

- **WHEN** la persona solicita registrar un elemento pero faltan datos no imprescindibles para dejar constancia
- **THEN** el agente registra lo conocido, marca la información pendiente de aclaración en el documento y no inventa requisitos ni decisiones de producto

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

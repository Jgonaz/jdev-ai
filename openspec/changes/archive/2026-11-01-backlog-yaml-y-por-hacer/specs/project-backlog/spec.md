## MODIFIED Requirements

### Requirement: El proyecto organiza el backlog por estado

Cada proyecto que utilice esta capacidad SHALL guardar sus elementos bajo `docs/backlog/` y SHALL organizar los archivos en las carpetas `backlog/`, `todo/`, `in-progress/`, `done/` y `discarded/`. `backlog` SHALL contener los elementos pendientes de revisar por la persona y `todo` los elementos ya revisados y elegidos para abordarse pronto. Cada elemento SHALL existir en un único archivo Markdown y el campo `status` de su cabecera SHALL coincidir con la carpeta que lo contiene, que es la fuente de verdad del estado.

#### Scenario: Primer elemento del proyecto

- **WHEN** se registra el primer elemento de backlog de un proyecto
- **THEN** se crea `docs/backlog/backlog/` y se guarda allí un archivo Markdown independiente

#### Scenario: Cambio de estado

- **WHEN** un elemento pasa de un estado a otro
- **THEN** el archivo se mueve a la carpeta de destino, conserva su identificador, actualiza `status` y `updated` en su cabecera y deja de existir en la carpeta anterior

#### Scenario: Cabecera y carpeta discrepan

- **WHEN** el agente encuentra un elemento cuyo `status` no coincide con su carpeta
- **THEN** toma la carpeta como estado válido, corrige `status` y lo comunica a la persona

### Requirement: El agente registra trabajo diferido mediante una instrucción explícita

El agente SHALL interpretar expresiones explícitas como «apunta un finding», «añade un TODO» o «registra una feature para después» como una solicitud de registro. También SHALL poder registrar una sugerencia proactiva cuando la persona la confirme explícitamente. El elemento creado SHALL cumplir el formato de elemento de backlog y SHALL crearse en `backlog` salvo que la persona indique otro estado; el tipo SHALL admitir al menos `finding`, `todo`, `fix` y `feature`, además de tipos adicionales cuando el proyecto los necesite.

#### Scenario: Hallazgo durante otra tarea

- **WHEN** la persona pide registrar un hallazgo mientras existe una tarea activa
- **THEN** el agente crea un elemento en `backlog` con el contexto suficiente para retomarlo y continúa la tarea activa sin implementar el hallazgo ni ampliar su alcance

#### Scenario: Registro directo como por hacer

- **WHEN** la persona pide registrar un elemento indicando que se abordará pronto
- **THEN** el agente lo crea en `todo` en lugar de `backlog`

#### Scenario: Solicitud insuficientemente detallada

- **WHEN** la persona solicita registrar un elemento pero faltan datos no imprescindibles para dejar constancia
- **THEN** el agente registra lo conocido, marca la información pendiente de aclaración en el documento y no inventa requisitos ni decisiones de producto

#### Scenario: Confirmación de una sugerencia proactiva

- **WHEN** la persona confirma que quiere registrar una sugerencia proactiva
- **THEN** el agente crea el elemento en `backlog` con el contexto observado, informa de su ruta e identificador y continúa o retoma la tarea original sin ampliarla

#### Scenario: Sugerencia no confirmada

- **WHEN** la persona no confirma una sugerencia proactiva o indica que no desea registrarla
- **THEN** el agente no crea ni modifica ningún elemento de backlog por esa sugerencia

### Requirement: El backlog permite consultar y retomar elementos

El agente SHALL poder listar y filtrar elementos por estado o tipo, y SHALL poder abordar un elemento identificado actualizando su estado, contexto y referencias relevantes. Los estados abiertos SHALL ser `backlog`, `todo` e `in-progress`. El agente SHALL mover un elemento de `backlog` a `todo` solo por decisión explícita de la persona. La resolución o descarte SHALL conservar el documento y SHALL permitir enlazar el resultado técnico, OpenSpec, commit o PR cuando exista.

#### Scenario: Consulta filtrada

- **WHEN** la persona pide los findings pendientes
- **THEN** el agente devuelve únicamente los elementos de tipo `finding` en estados abiertos, indicando por separado los de `backlog`, `todo` e `in-progress`

#### Scenario: Elemento elegido para abordar pronto

- **WHEN** la persona decide que un elemento de `backlog` se abordará pronto
- **THEN** el agente lo mueve a `todo` y actualiza su cabecera

#### Scenario: Abordar un elemento

- **WHEN** la persona pide abordar un elemento que está en `backlog` o en `todo`
- **THEN** el agente lo mueve a `in-progress` antes de empezar y lo mantiene actualizado conforme avanza el trabajo

#### Scenario: Elemento resuelto

- **WHEN** se completa el trabajo asociado a un elemento
- **THEN** el agente mueve el archivo a `done`, actualiza su cabecera y registra la referencia al resultado cuando esté disponible

## ADDED Requirements

### Requirement: Los elementos tienen cabecera YAML y resumen

Cada elemento de backlog SHALL empezar con una cabecera YAML (front matter) delimitada por `---` con las claves `id`, `title`, `type`, `status`, `priority`, `created` y `updated`, y opcionalmente `refs` como lista. `id` SHALL coincidir con el nombre del archivo sin extensión y `title` con el título `#` del documento. Tras el título, el elemento SHALL incluir una sección `## Resumen` con un único párrafo en lenguaje llano, dirigido a la persona, de como máximo unos 2 minutos de lectura (alrededor de 350 palabras). El contenido detallado SHALL ir después del resumen.

#### Scenario: Elemento nuevo

- **WHEN** el agente crea un elemento de backlog
- **THEN** el archivo incluye la cabecera YAML completa, el título y la sección `## Resumen` antes de cualquier detalle

#### Scenario: Elemento actualizado

- **WHEN** el agente modifica el contenido o el estado de un elemento
- **THEN** actualiza `updated` y revisa que el resumen siga reflejando el estado real del elemento

#### Scenario: Resumen demasiado largo

- **WHEN** el resumen de un elemento supera claramente los 2 minutos de lectura
- **THEN** el agente lo condensa y traslada el exceso al detalle

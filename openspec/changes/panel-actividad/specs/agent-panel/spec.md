## ADDED Requirements

### Requirement: Actividad con los agentes en Inicio

Inicio SHALL mostrar una sección «tu actividad», calculada en el equipo a partir de los transcripts de Claude Code (incluidos sus subagentes) y de las sesiones de Codex, con filtros de periodo (esta semana, 30 días, todo) y de agente (todos, Claude, Codex).

La sección SHALL mostrar:

- tokens de salida, con su desglose de entrada y caché;
- sesiones;
- respuestas;
- horas activas.

Cada cifra SHALL compararse con el periodo anterior equivalente, salvo en «todo».

Además, la sección SHALL mostrar:

- un calendario de respuestas por día de las últimas 12 semanas, con la racha y el mejor día y una vista en tabla;
- los tokens de salida por proyecto;
- el reparto de respuestas por modelo, con leyenda y porcentajes;
- los subagentes y herramientas más usados.

Cada respuesta SHALL contarse una sola vez aunque el transcript la repita. El panel SHALL leer esos archivos solo para calcular las cifras, sin modificarlos, y SHALL guardar un resumen en caché para no releerlos enteros en cada visita. La sección SHALL poder ocultarse desde Ajustes.

#### Scenario: Ver la semana al empezar

- **WHEN** la persona abre Inicio
- **THEN** ve las cifras de la semana en curso con su variación frente a la anterior, el calendario y los repartos por proyecto y modelo

#### Scenario: Filtrar por agente

- **WHEN** la persona elige «Codex» en el filtro de agente
- **THEN** todas las cifras y gráficos de la sección cuentan solo las sesiones de Codex

#### Scenario: Primera vez

- **WHEN** el panel aún no ha terminado de leer los transcripts
- **THEN** la sección indica que está calculando y muestra lo que ya tiene, sin bloquear el resto de Inicio

#### Scenario: Respuesta repetida en el transcript

- **WHEN** un transcript contiene varias líneas con el uso de una misma respuesta
- **THEN** sus tokens y la respuesta se cuentan una sola vez

#### Scenario: Ocultar la sección

- **WHEN** la persona desactiva «Mostrar tu actividad» en Ajustes
- **THEN** Inicio deja de mostrar la sección

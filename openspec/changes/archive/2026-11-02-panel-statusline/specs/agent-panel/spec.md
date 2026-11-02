## ADDED Requirements

### Requirement: Estado de la sesión en la cabecera de la terminal

La cabecera de cada terminal del panel SHALL mostrar:

1. El título de la sesión, con su estado y el menú de acciones a la derecha.
2. En una sola línea:
   - el proyecto;
   - la rama o, en un worktree, su nombre y rama;
   - el agente o, en sesiones de Claude con datos, el modelo y el esfuerzo;
   - el tiempo desde que se creó la sesión;
   - a continuación de lo anterior, la barra de contexto con el porcentaje y los tokens usados y disponibles, si hay datos.
3. Solo cuando haya trabajo en curso: chips con el número de subagentes activos, de shells en segundo plano y de artifacts publicados en la sesión. Cada chip SHALL desplegar el detalle: tipo de subagente y desde cuándo, comando de la shell, y enlace y título del artifact.

La barra de contexto SHALL ser neutra por debajo del 50 %, ámbar desde el 50 % y roja desde el 80 %, con el porcentaje en texto y, en rojo, un icono. El color y el icono SHALL decidirse con el porcentaje mostrado (redondeado): 49,6 % se muestra «50 %» y es ámbar; 79,6 %, «80 %» y rojo.

Si los datos llevan más de 15 minutos sin cambiar y la sesión no está trabajando, SHALL mostrarse atenuados y con su antigüedad, sin que el texto pierda contraste (4,5:1).

En columnas estrechas, SHALL ocultar el proyecto, el tiempo y los tokens, y mostrar el trabajo en curso como contadores junto al título.

Los datos de modelo, esfuerzo, contexto y trabajo en curso SHALL obtenerse solo de las sesiones de Claude lanzadas desde el panel. Las demás SHALL mostrar el proyecto, la rama, el agente y el tiempo.

#### Scenario: Sesión de Claude trabajando con subagentes

- **WHEN** una sesión de Claude del panel usa el 19 % del contexto y tiene tres subagentes activos
- **THEN** su cabecera muestra la barra de contexto al 19 % al final de la línea de datos y, debajo, el chip «3 subagentes», que al pulsarlo lista sus tipos y desde cuándo funcionan

#### Scenario: Contexto casi lleno

- **WHEN** el contexto de una sesión pasa del 80 %
- **THEN** la barra y el porcentaje se muestran en rojo con un icono de aviso

#### Scenario: Sesión de Codex

- **WHEN** la persona abre una sesión de Codex en el panel
- **THEN** la cabecera muestra el proyecto, la rama, «codex» y el tiempo, sin barra de contexto ni chips

#### Scenario: Sin trabajo en curso

- **WHEN** una sesión no tiene subagentes, shells en segundo plano ni artifacts
- **THEN** la cabecera ocupa dos filas, sin la fila de chips

### Requirement: Límites de la cuenta y agente por defecto en la cabecera global

La cabecera global del panel SHALL mostrar, en todas las pantallas salvo Ajustes:

- El agente por defecto de las sesiones nuevas, con un menú para cambiarlo, que guarda el mismo ajuste que el diálogo «Nueva sesión» (por debajo de 1024 px, solo con su icono, igual que «Nueva sesión»).
- Los límites de uso de 5 horas y de 7 días de la cuenta, como dos barras con su porcentaje y los mismos umbrales que el contexto (por debajo de 1280 px, solo con el porcentaje, sin barras). Al pulsarlos, SHALL mostrar a qué hora se reinicia cada uno y la antigüedad del dato.

Los límites SHALL tomarse de la sesión de Claude del panel con datos más recientes y SHALL ocultarse si no hay ninguna.

#### Scenario: Consultar cuándo se reinicia el límite

- **WHEN** la persona pulsa los límites con la ventana de 5 horas al 91 %
- **THEN** ve la barra de 5 h en rojo y que se reinicia hoy a las 21:20

#### Scenario: Cambiar el agente por defecto

- **WHEN** la persona elige Codex en el menú del agente por defecto
- **THEN** la cabecera muestra Codex y el diálogo «Nueva sesión» lo propone como agente

### Requirement: Statusline de Claude en las sesiones del panel

Cuando `bin/agent` lance Claude con `JDEV_SURFACE=panel`, SHALL configurar como statusline un script del harness que guarde los datos que recibe en el directorio de estado del panel y no imprima nada. Así la terminal del panel no repite lo que muestra la cabecera.

Con `JDEV_SURFACE=terminal`, `bin/agent` SHALL NOT cambiar la statusline de la persona.

Los datos de subagentes, tareas en segundo plano y artifacts SHALL llegar por hooks de Claude que solo escriben en el directorio de estado y nunca interrumpen al agente.

#### Scenario: Sesión del panel

- **WHEN** la persona abre una sesión de Claude desde el panel
- **THEN** la terminal no muestra la statusline y la cabecera del panel muestra sus datos

#### Scenario: Terminal normal

- **WHEN** la persona lanza `bin/agent` desde una terminal normal
- **THEN** Claude muestra la statusline configurada por la persona, sin cambios

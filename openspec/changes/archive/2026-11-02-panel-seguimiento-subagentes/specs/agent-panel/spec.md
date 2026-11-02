## ADDED Requirements

### Requirement: Seguimiento de subagentes y shells en segundo plano

Desde los desplegables de los chips de subagentes y shells de la cabecera de una terminal, el panel SHALL abrir una pestaña de seguimiento de solo lectura para cada subagente o shell, junto a las de terminal. Si ya está abierta, SHALL activarla.

La pestaña de un subagente SHALL mostrar:

- su descripción;
- su estado y desde cuándo;
- su tipo;
- la sesión que lo lanzó;
- el encargo;
- cada herramienta usada, con un verbo y su objetivo y un resumen del resultado, destacado si falla;
- sus mensajes;
- al terminar, su resultado final.

SHALL NOT mostrar el razonamiento interno.

La pestaña de una shell SHALL mostrar el comando, su estado, la sesión que la lanzó y las últimas 2 000 líneas de su salida como texto plano.

Ambas SHALL actualizarse en directo mientras el elemento sigue en marcha, con la opción «Seguir al final», y SHALL seguir abiertas con el estado «Terminado» cuando acabe.

El panel SHALL leer solo archivos del usuario, dentro de las carpetas de Claude:

- el transcript de subagentes junto al de la sesión;
- la salida de la shell en la ruta anunciada por Claude bajo su directorio temporal.

El panel SHALL hacerlo solo para sesiones del panel. Lo que no encuentre SHALL explicarlo en la vista.

#### Scenario: Ver qué hace un implementer

- **WHEN** la persona pulsa «implementer» en el desplegable de «3 subagentes»
- **THEN** se abre una pestaña con su encargo y la lista en directo de las herramientas que usa y sus mensajes

#### Scenario: Una herramienta falla

- **WHEN** el subagente ejecuta un comando que devuelve error
- **THEN** la línea de ese comando se muestra en rojo con el resumen del error

#### Scenario: Salida de una shell

- **WHEN** la persona pulsa «pnpm dev» en el desplegable de «1 shell»
- **THEN** se abre una pestaña con la salida del comando, que se actualiza sola y baja al final mientras «Seguir al final» está marcado

#### Scenario: El subagente termina

- **WHEN** el subagente seguido termina
- **THEN** la pestaña muestra «Terminado», la hora y su resultado final destacado, y sigue abierta hasta que la persona la cierra

#### Scenario: Archivo no disponible

- **WHEN** el transcript o la salida no existen o están fuera de las carpetas permitidas
- **THEN** la pestaña explica que no hay datos que mostrar, sin servir el archivo

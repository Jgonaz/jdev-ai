## ADDED Requirements

### Requirement: Pantalla Historial con las entradas de todos los proyectos

El panel SHALL ofrecer una pantalla Historial que liste las entradas `.agent/history/*.md` del checkout principal de cada proyecto y del harness, ignorando subcarpetas y archivos que no sean Markdown, ordenadas de más reciente a más antigua y agrupadas por día o, si la persona lo elige, por proyecto. Cada entrada SHALL mostrar hora, proyecto, estado (`finalizada`, `en curso` o `bloqueada`), título y su primer pendiente abierto si lo tiene. La persona SHALL poder filtrar por proyecto, por estado y por «Solo con Pendiente de ti», que deja las entradas con algún pendiente sin marcar. Las entradas con `Fecha:` o `Estado:` fuera del formato SHALL mostrarse con la fecha del nombre o del archivo y un estado desconocido, sin romper la vista. La lista SHALL actualizarse sola cuando cambien los archivos.

#### Scenario: Agrupar por proyecto

- **WHEN** la persona elige la vista «Por proyecto» en la lista
- **THEN** las entradas se agrupan por proyecto con su monograma y su número de entradas, mostrando las tres más recientes de cada uno y «Ver más» para el resto, con los mismos filtros aplicados, y la elección se recuerda

#### Scenario: Ver qué espera de mí

- **WHEN** la persona activa «Solo con Pendiente de ti»
- **THEN** ve solo las entradas con algún pendiente sin marcar, de todos los proyectos

#### Scenario: Entrada nueva

- **WHEN** un agente registra una entrada mientras la pantalla está abierta
- **THEN** aparece en la lista sin recargar

### Requirement: Lector de una entrada

Al elegir una entrada, el panel SHALL mostrar su proyecto, ruta, título, estado y fecha, el bloque «Pendiente de ti» destacado con cada punto y su estado, y el resto de secciones (resumen, decisiones, referencias, continuación recomendada y cualquier otra) pintadas con el visor de Markdown seguro.

#### Scenario: Leer una entrada

- **WHEN** la persona abre una entrada con «Pendiente de ti» y «Continuación recomendada»
- **THEN** ve los pendientes destacados arriba y la continuación al final

### Requirement: Marcar pendientes como hechos

Cada punto de «Pendiente de ti» SHALL poder marcarse como hecho y desmarcarse desde el lector. El panel SHALL marcarlo en el propio archivo como `- [x] <texto> (hecho YYYY-MM-DD)` y, al desmarcarlo, SHALL devolverlo a `- <texto>`, sin tocar el resto de la entrada. Si el archivo cambió desde que se abrió, SHALL rechazar la operación y recargar la entrada. `bin/session-status` SHALL omitir los puntos marcados al mostrar «Pendiente de ti» en el resumen de inicio, y SHALL omitir el apartado si no queda ninguno.

#### Scenario: Pendiente resuelto

- **WHEN** la persona marca como hecho «Reinstalar la app en el iPhone y comprobar el teclado»
- **THEN** el archivo guarda `- [x] Reinstalar la app… (hecho <fecha de hoy>)`, la entrada deja de salir con «Solo con Pendiente de ti» si no le quedan pendientes, y el resumen de inicio del proyecto ya no lo muestra

#### Scenario: Archivo modificado mientras tanto

- **WHEN** un agente actualiza la entrada después de que la persona la abriera y la persona marca un pendiente
- **THEN** el panel no lo marca, avisa y muestra la versión actual

### Requirement: Retomar desde una entrada

El lector SHALL ofrecer «Retomar desde aquí», que abre Nueva sesión con el proyecto de la entrada y un prompt que pide ponerse al día desde esa entrada (por su ruta) y seguir su continuación recomendada, sin lanzar nada hasta que la persona confirme.

#### Scenario: Retomar un trabajo en curso

- **WHEN** la persona pulsa «Retomar desde aquí» en una entrada «en curso» de balanz.io
- **THEN** se abre Nueva sesión con balanz.io y un prompt con la ruta de la entrada, listo para revisar y lanzar

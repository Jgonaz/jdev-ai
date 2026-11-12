## MODIFIED Requirements

### Requirement: Avisos de sesiones que esperan

Cuando una sesión pase a «te espera», el panel SHALL actualizar el contador del título de la pestaña del navegador o, en el programa de escritorio, de la ventana. Si la persona lo ha activado en Ajustes y ha concedido el permiso, SHALL mostrar una notificación del sistema: la del navegador cuando el panel se usa en un navegador y una notificación nativa cuando se usa en el programa de escritorio.

#### Scenario: Panel en segundo plano

- **WHEN** una sesión pasa a «te espera» mientras el panel no tiene el foco
- **THEN** el título de la pestaña muestra el número de sesiones que esperan y, si está activado, aparece una notificación del sistema

#### Scenario: Programa de escritorio en segundo plano

- **WHEN** una sesión pasa a «te espera» mientras la ventana del programa de escritorio no tiene el foco y las notificaciones están activadas
- **THEN** el título de la ventana muestra el número de sesiones que esperan y aparece una notificación nativa de Windows

## ADDED Requirements

### Requirement: Consultar la URL de acceso sin arrancar el panel

`bin/panel --print-url` SHALL imprimir la URL de acceso con el token, tras las mismas comprobaciones de requisitos que el arranque, y SHALL terminar sin arrancar el servidor.

#### Scenario: Panel ya en marcha

- **WHEN** la persona ejecuta `bin/panel --print-url` con el panel arrancado
- **THEN** se imprime la URL de acceso y el panel en marcha no se ve afectado

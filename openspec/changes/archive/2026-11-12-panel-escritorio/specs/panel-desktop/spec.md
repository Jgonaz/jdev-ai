## ADDED Requirements

### Requirement: Programa de escritorio que abre el panel

El harness SHALL ofrecer un programa de escritorio para Windows que muestre el panel en una ventana propia, sin barra de direcciones ni pestañas y sin depender de un navegador instalado. Al abrirse SHALL arrancar el servidor del panel dentro de WSL mediante `bin/panel` y SHALL mostrar su interfaz en cuanto esté disponible. Mientras arranca SHALL indicar que está arrancando.

Si el panel ya está en marcha, el programa SHALL conectarse a él sin arrancar otro servidor.

Si el servidor no puede arrancar, el programa SHALL mostrar el motivo que indique `bin/panel`.

#### Scenario: Abrir el programa con el panel parado

- **WHEN** la persona abre el programa y el panel no está en marcha
- **THEN** el programa arranca el servidor en WSL y muestra el panel en su ventana, ya autenticado

#### Scenario: Abrir el programa con el panel en marcha

- **WHEN** la persona abre el programa y el panel ya está arrancado con `bin/panel`
- **THEN** el programa muestra ese panel sin arrancar un segundo servidor

#### Scenario: Faltan requisitos

- **WHEN** la persona abre el programa y `bin/panel` termina porque falta un requisito
- **THEN** la ventana muestra el mensaje de `bin/panel` con lo que falta y cómo instalarlo

### Requirement: Cerrar el programa para solo lo que arrancó

Al cerrar la ventana, el programa SHALL parar el servidor del panel si lo arrancó él y SHALL dejarlo en marcha si se conectó a uno existente. En ningún caso SHALL terminar las sesiones de tmux.

#### Scenario: Cerrar tras arrancar el servidor

- **WHEN** la persona cierra la ventana de un programa que arrancó el servidor
- **THEN** el servidor se para y las sesiones siguen vivas en tmux

#### Scenario: Cerrar tras conectarse a un panel existente

- **WHEN** la persona cierra la ventana de un programa que se conectó a un panel ya arrancado
- **THEN** ese panel sigue en marcha

#### Scenario: Volver a abrir

- **WHEN** la persona abre de nuevo el programa después de cerrarlo
- **THEN** el panel muestra las mismas sesiones que había

### Requirement: Una sola instancia

El programa SHALL tener como mucho una instancia en ejecución. Abrirlo de nuevo SHALL traer al frente la ventana existente.

#### Scenario: Segundo arranque

- **WHEN** la persona abre el programa con otra instancia ya abierta
- **THEN** la ventana existente pasa al frente y no se abre otra

### Requirement: La ventana solo muestra el panel

La ventana principal SHALL navegar únicamente dentro del panel local. Los enlaces a otros sitios SHALL abrirse en el navegador por defecto del sistema. Las aperturas en ventana nueva de contenido del propio panel SHALL abrirse en otra ventana del programa.

El programa SHALL conceder a la página del panel únicamente los permisos nativos que necesitan los avisos; SHALL NOT darle acceso a archivos, procesos ni a la shell del sistema.

#### Scenario: Enlace externo

- **WHEN** la persona abre un enlace de una terminal que apunta a otro sitio
- **THEN** se abre en el navegador por defecto y la ventana del programa sigue en el panel

#### Scenario: Imagen en ventana nueva

- **WHEN** la persona abre una imagen del panel en una pestaña nueva
- **THEN** la imagen se muestra en otra ventana del programa

### Requirement: Compilar e instalar el programa desde WSL

`bin/panel-desktop build` SHALL compilar el programa desde WSL y `bin/panel-desktop install` SHALL copiarlo a Windows y crear su acceso directo en el menú Inicio. Si falta alguna herramienta de compilación, SHALL terminar indicando cuál y cómo instalarla, sin instalar nada por su cuenta.

Usar el panel con `bin/panel` SHALL NOT requerir ninguna de esas herramientas.

#### Scenario: Compilar e instalar

- **WHEN** la persona ejecuta `bin/panel-desktop build` y después `bin/panel-desktop install` con las herramientas instaladas
- **THEN** el programa queda en Windows y se puede abrir desde el menú Inicio

#### Scenario: Faltan herramientas

- **WHEN** la persona ejecuta `bin/panel-desktop build` sin Rust
- **THEN** termina con un mensaje que indica qué falta y cómo instalarlo

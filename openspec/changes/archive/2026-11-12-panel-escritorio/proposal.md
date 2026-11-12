## Why

El panel se abre hoy como una ventana de Chrome (`bin/panel --app`) y hay que arrancar antes el servidor desde una terminal. La persona quiere usarlo como un programa de Windows propio: con su icono, su ventana y su entrada en la barra de tareas, que se abra con un doble clic y no dependa del navegador.

## What Changes

- **Programa de escritorio para Windows** (`jdev-ai.exe`), hecho con Tauri:
  - al abrirlo arranca el servidor del panel dentro de WSL y muestra la interfaz actual en su propia ventana;
  - si el panel ya estaba en marcha (lanzado con `bin/panel`), se conecta a él en lugar de arrancar otro;
  - al cerrar la ventana para el servidor que arrancó él. Las sesiones siguen vivas en tmux;
  - abrirlo por segunda vez trae al frente la ventana que ya existe.
- **Avisos nativos**: dentro del programa, las notificaciones de «te espera» y «ha terminado» salen como notificaciones de Windows, y el contador de sesiones que esperan se ve en el título de la ventana.
- **Enlaces externos** en el navegador por defecto; las imágenes «en pestaña nueva» se abren en otra ventana del programa.
- **`bin/panel-desktop`**: compila el `.exe` desde WSL y lo instala en Windows con un acceso directo en el menú Inicio.
- **`bin/panel --print-url`**: imprime la URL de acceso sin arrancar el servidor (el servidor ya lo sabe hacer; falta exponerlo en el lanzador).

`bin/panel`, `--open` y `--app` siguen funcionando igual. El programa es para uso propio: sin instalador, sin firma y sin publicación de versiones.

## Capabilities

### New Capabilities

- `panel-desktop`: programa de escritorio de Windows que arranca el panel en WSL y lo muestra en una ventana propia; su compilación e instalación.

### Modified Capabilities

- `agent-panel`: los avisos de sesiones que esperan se muestran también como notificación nativa y en el título de la ventana cuando el panel corre dentro del programa de escritorio; `bin/panel` acepta `--print-url`.

## Impact

- **Nuevo `panel/desktop/`**: proyecto Tauri (Rust), sin interfaz propia: la ventana carga la del servidor local.
- **Cliente y servidor del panel**: sin cambios. Dentro del programa, el plugin de notificaciones de Tauri sustituye la API `Notification` de la página por la nativa.
- **`bin/panel`**: opción `--print-url`. **`bin/check`**: sintaxis del nuevo script.
- **Herramientas nuevas, solo para compilar el programa**: Rust (`rustup`) en el usuario de WSL con el target `x86_64-pc-windows-msvc`, `cargo-xwin` y, con `apt`, `clang`, `lld` y `llvm`. Quien no compile el programa no necesita ninguna.
- **Seguridad**: el token llega al programa por la salida del servidor que él mismo arranca y acaba, como hoy en Chrome, en una cookie del almacén de la ventana. El servidor sigue escuchando solo en `127.0.0.1` y exigiendo el token.
- **Documentación**: README en castellano e inglés.

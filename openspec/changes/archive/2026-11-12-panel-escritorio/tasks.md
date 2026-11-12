## 1. Cadena de compilación (primero: si falla, parar y consultar)

- [x] 1.1 Instalar Rust en el usuario de WSL, el target `x86_64-pc-windows-msvc`, `cargo-xwin` y, con `apt`, `clang`, `lld` y `llvm`
- [x] 1.2 Proyecto Tauri mínimo en `panel/desktop/` que abre una ventana vacía; compilarlo desde WSL y comprobar que el `.exe` arranca en Windows

## 2. Programa de escritorio

- [x] 2.1 `bin/panel --print-url`
- [x] 2.2 Arranque del servidor por `wsl.exe` sin consola, lectura de la URL y pantalla de arranque con errores
- [x] 2.3 Conexión a un panel ya en marcha cuando el puerto está ocupado
- [x] 2.4 Parada del servidor propio al cerrar, comprobando que el proceso de Linux termina
- [x] 2.5 Instancia única
- [x] 2.6 Navegación acotada al panel, enlaces externos al navegador por defecto y ventanas nuevas para contenido del panel
- [x] 2.7 Título de la ventana sincronizado con el de la página
- [x] 2.8 Icono del programa

## 3. Avisos

- [x] 3.1 Plugin de notificaciones con el puente limitado a tres permisos para el origen del panel
- [x] 3.2 Registro del identificador del programa en Windows al instalar
- [x] 3.3 Arrastre de archivos sin interceptar por Tauri

## 4. Compilar e instalar

- [x] 4.1 `bin/panel-desktop build` con comprobación de herramientas, distro y ruta del harness grabadas
- [x] 4.2 `bin/panel-desktop install`: copia a `%LOCALAPPDATA%\Programs\jdev-ai\` y acceso directo en el menú Inicio
- [x] 4.3 `bin/check`: sintaxis de `bin/panel-desktop` y `--print-url`

## 5. Documentación y validación

- [x] 5.1 README en castellano e inglés
- [x] 5.2 `bin/check` y `openspec validate --strict`
- [x] 5.3 Verificación en Windows: arranque propio, conexión a un panel existente, cierre, instancia única, título, ventanas nuevas, enlaces externos, portapapeles y permisos del puente
- [ ] 5.4 Repaso manual de la persona: notificación visible, atajos de la terminal, pegar y arrastrar imágenes, sonidos
- [x] 5.5 QA en Windows y correcciones: servidor huérfano al cerrar durante el arranque, «atrás» hacia la pantalla de arranque, plazo al identificar el panel y mensajes de error
- [x] 5.6 Historial según `rules/history.md`

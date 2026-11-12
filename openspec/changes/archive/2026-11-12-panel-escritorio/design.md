## Context

- El panel es un servidor Node (`panel/server/main.ts`) que corre en WSL, escucha en `127.0.0.1` y sirve la interfaz compilada (`panel/dist`). Las sesiones viven en tmux, también en WSL.
- `bin/panel` comprueba requisitos, compila el cliente si hace falta y arranca el servidor. Este imprime `Abre: http://localhost:<puerto>/?token=<token>`; con `--print-url` imprime solo la URL y termina. Si el puerto está ocupado, termina con error.
- La primera visita con `?token=` fija una cookie `HttpOnly` y redirige; después basta la cookie (`server/auth.ts`).
- Los avisos usan la API `Notification` del navegador y `document.title` (`src/lib/useAlerts.ts`).
- Node está instalado con nvm, así que solo está en el `PATH` de una shell de login o interactiva.
- En la máquina no hay Rust (ni en WSL ni en Windows) ni las Build Tools de Visual Studio. Windows 11 trae WebView2.

## Goals / Non-Goals

**Goals:**

- Un `.exe` que abra el panel en una ventana propia sin pasar por la terminal ni por Chrome.
- No tocar el servidor ni la interfaz.
- Compilarlo entero desde WSL.

**Non-Goals:**

- Instalador, firma del ejecutable, actualizaciones automáticas o publicación de versiones.
- Icono en la bandeja, arranque con Windows o atajos globales.
- macOS o Linux de escritorio.
- Mejorar el rendimiento del panel: el motor sigue siendo web.
- Sustituir `bin/panel` ni la PWA.

## Decisions

### La ventana carga la interfaz del servidor, sin interfaz empaquetada

La ventana de Tauri navega a `http://localhost:<puerto>/?token=…`, la misma URL que hoy se abre en Chrome. Así el programa no hay que recompilarlo cuando cambia el panel y no existen dos formas de servir la interfaz.

Alternativa descartada: empaquetar `panel/dist` dentro del `.exe` y hablar con el servidor por API. Obligaría a recompilar con cada cambio y a rehacer la autenticación por cookie, que depende del origen.

Mientras el servidor arranca se muestra una pantalla local mínima («Arrancando el panel…»), que también enseña el error si falla.

### Arranque del servidor

1. El programa ejecuta, sin ventana de consola, `wsl.exe -d <distro> --cd ~ --exec bash -ic 'echo JDEV_PID:$$; exec <harness>/bin/panel'` y lee su salida. `bash -i` carga `~/.bashrc`, donde nvm pone Node en el `PATH`; una shell de login (`-l`) ejecutaría además el perfil de la persona, que puede escribir en pantalla o tardar.
2. Cuando aparece la línea `Abre: <url>`, navega a esa URL. La navegación la hace el propio programa, no la página de arranque: si la iniciara la página (otro sitio), la cookie `SameSite=Strict` del token no viajaría tras la redirección del servidor y el panel respondería 401. Una vez en el panel, la pantalla de arranque deja de ser un destino permitido, así que «atrás» no vuelve a ella.
3. Si el proceso termina antes de dar la URL, la pide con `bin/panel --print-url` y comprueba que quien escucha en ese puerto es el panel, pidiéndole `/manifest.webmanifest`, que se sirve sin token. Solo entonces se conecta: así el token nunca se envía a otro servicio que ocupe el puerto. En ese caso no es dueño del servidor. La comprobación tiene un plazo total de 3 s; si quien ocupa el puerto no es el panel, la ventana lo dice.
4. Cualquier otro fallo (falta Node, tmux, dependencias…) se enseña en la pantalla de arranque con el mensaje de `bin/panel`, que ya indica qué falta.

`bin/panel` gana la opción `--print-url`, que pasa tal cual al servidor tras las mismas comprobaciones de requisitos.

La distro y la ruta del harness se escriben sin comillas en esa orden, así que `bin/panel-desktop build` rechaza las que tengan espacios u otros caracteres que habría que escapar.

### Distro y ruta del harness

`bin/panel-desktop build` las conoce en el momento de compilar (`$WSL_DISTRO_NAME` y la ruta del propio script) y quedan grabadas en el ejecutable. Si el harness se mueve o cambia de distro, se vuelve a compilar.

Alternativa descartada: un archivo de configuración en Windows. Para un solo usuario añade una pieza que mantener sin dar nada a cambio.

### Cierre

Al cerrar la ventana, si el programa arrancó el servidor, lo para; si se conectó a uno existente, lo deja. Las sesiones de tmux no se tocan en ningún caso.

Matar `wsl.exe` desde Windows no garantiza que el proceso de Linux reciba la señal. El programa para el servidor con una segunda llamada a `wsl.exe` que envía `SIGTERM` al PID anotado al arrancar (`JDEV_PID`, que es el del servidor porque `bin/panel` termina con `exec node`), espera hasta 3 s y solo entonces mata `wsl.exe`.

El proceso se anota nada más lanzarlo, así que cerrar la ventana durante el arranque también lo para. El `kill` va directo por `wsl.exe --exec`, sin bash, para no depender de lo que tarde el `~/.bashrc`.

Cerrar la ventana principal cierra también las ventanas de imágenes y termina el programa.

### Una sola instancia

Con el plugin oficial de instancia única: un segundo arranque enfoca la ventana existente y termina.

### Navegación y ventanas

- La ventana principal solo puede navegar a `http://localhost:<puerto>` y `http://127.0.0.1:<puerto>`.
- Cualquier otro enlace (los de la terminal, por ejemplo) se abre en el navegador por defecto de Windows.
- `window.open` hacia una URL del propio panel (imagen en pestaña nueva) abre otra ventana del programa: en el navegador por defecto no habría cookie y fallaría.

### Avisos

Se usa el plugin oficial de notificaciones de Tauri, que sustituye la API `Notification` de la página por una que muestra notificaciones nativas. El cliente del panel no cambia: sigue llamando a `Notification` y leyendo `Notification.permission`, que en Windows es siempre `granted`.

- Para que la página del servidor pueda llamar al plugin hay que abrir el puente de Tauri a su origen. Se hace al arrancar, con el puerto leído del servidor (`http://localhost:<puerto>/*`), solo para la ventana principal y **solo** con tres permisos: mostrar una notificación y consultar o pedir el permiso. Ningún acceso a archivos, shell, procesos ni ventanas.
- El clic en la notificación no abre la sesión: el plugin no entrega el clic en escritorio. Queda como limitación documentada.
- Windows solo muestra notificaciones de un programa sin instalador si su identificador está registrado: `bin/panel-desktop install` lo registra en `HKCU\Software\Classes\AppUserModelId\` con el nombre y el icono.
- El título de la ventana sigue a `document.title`, así que el contador de sesiones que esperan se ve en la barra de tareas.
- Tauri intercepta por defecto el arrastre de archivos sobre la ventana; se desactiva para que el panel siga recibiendo las imágenes que se sueltan sobre una terminal.

### Compilación e instalación

`bin/panel-desktop` con dos órdenes:

- `build`: comprueba las herramientas (sin instalar nada: indica qué falta y cómo instalarlo, como `bin/panel`) y compila para `x86_64-pc-windows-msvc` con `cargo-xwin`, que descarga el SDK de Windows a una caché del usuario.
- `install`: copia el `.exe` a `%LOCALAPPDATA%\Programs\jdev-ai\`, crea el acceso directo «jdev-ai» en el menú Inicio y registra el programa para las notificaciones. Un ejecutable lanzado desde `\\wsl.localhost\…` arranca lento y Windows no lo deja anclar bien.

No se usa la CLI de Tauri: sin instalador ni interfaz que empaquetar, basta `cargo xwin build`. El proyecto es un paquete de Cargo normal en `panel/desktop/`. `Cargo.lock` se versiona; `target/` se ignora.

Tauri documenta la compilación cruzada a Windows como experimental. Si no funciona, la alternativa es compilar en Windows con Rust y las Build Tools, que la persona tendría que instalar: se le consulta antes de seguir por ahí.

### Validación

`bin/check` comprueba la sintaxis y la ayuda de `bin/panel-desktop`. La compilación de Rust no entra en `bin/check`: exige herramientas que la mayoría no tendrá. El programa se verifica en Windows a mano y por depuración remota de la ventana.

## Risks / Trade-offs

- **La compilación cruzada falla o da un `.exe` que no arranca** → es la primera tarea, antes de escribir nada más; si falla, se para y se consulta.
- **El puente de Tauri abierto a contenido servido por HTTP local** → permisos mínimos (solo notificaciones) y origen acotado al puerto del panel; el servidor ya exige token y valida `Host` y `Origin`.
- **Diferencias entre WebView2 y Chrome** (portapapeles, atajos, arrastrar imágenes, sonidos) → repaso manual de esas funciones en la ventana antes de dar el cambio por terminado.
- **Aviso de SmartScreen** por ejecutable sin firmar → aceptado para uso propio; compilado en local no suele saltar.
- **El puerto cambia en Ajustes** → el programa siempre toma la URL de la salida del servidor, nunca de un valor fijo; los permisos del puente se generan con el puerto leído al arrancar.
- **Si el servidor muere con la ventana abierta**, se ve la página de error del motor web → hay que cerrar y reabrir el programa. Aceptado.
- **Con un fallo de scripts en la página del panel, el permiso de notificaciones permitiría indicar un icono con una ruta arbitraria** → no añade riesgo real: quien ejecute scripts en el panel ya controla las terminales.
- **El servidor queda huérfano si el programa se cierra a la fuerza** → al volver a abrirlo se conecta al que quedó; no se pierde nada, pero ya no lo parará al cerrar.

## Open Questions

- Icono: el `.ico` envuelve el PNG de 192 px de `panel/public/icons`. Se ve bien en la barra de tareas; si en algún tamaño se ve borroso, se propone generar uno según `rules/images.md`.

## ADDED Requirements

### Requirement: Visor de imágenes desde la terminal

El panel SHALL convertir en enlaces las rutas de archivos de imagen (`png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`) que aparezcan en una terminal, tanto absolutas como relativas al directorio de trabajo de la sesión y aunque la ruta ocupe varias líneas por ajuste de la terminal. Al activar un enlace, el panel SHALL abrir un visor lateral con la imagen, su nombre, ruta, dimensiones y tamaño, controles para ajustar a la ventana, ver al 100 %, acercar, alejar, copiar la ruta y abrir en una pestaña nueva, y una tira con las imágenes enlazadas en esa terminal. Una imagen que no exista o no esté permitida SHALL mostrar un mensaje claro en el visor.

#### Scenario: Captura de QA

- **WHEN** el agente escribe `/tmp/jdev-qa/fitnessia/02-dashboard.png` en la terminal y la persona hace clic en la ruta
- **THEN** se abre el visor lateral con esa imagen ajustada a la ventana

#### Scenario: Ruta relativa

- **WHEN** aparece `docs/img/logo.png` en una sesión cuyo directorio es el checkout de un proyecto
- **THEN** el enlace abre `<checkout>/docs/img/logo.png`

#### Scenario: Ruta no permitida

- **WHEN** el enlace apunta a una imagen fuera de las carpetas permitidas
- **THEN** el visor indica que la imagen no se puede mostrar y el servidor no entrega el archivo

### Requirement: El servidor solo entrega imágenes permitidas

El servidor SHALL entregar archivos solo con token válido, solo si su extensión y su contenido son de imagen, si su tamaño no supera el límite configurado y si su ruta real, tras resolver enlaces simbólicos, está dentro de las carpetas permitidas: el harness con sus proyectos y worktrees, la carpeta de evidencias del QA, la de imágenes adjuntadas y la temporal del sistema. Los SVG SHALL entregarse con cabeceras que impidan ejecutar scripts.

#### Scenario: Intento de salir de las carpetas permitidas

- **WHEN** se pide una ruta con `..` o un enlace simbólico que apunta fuera de las carpetas permitidas
- **THEN** el servidor responde con error y no lee el archivo

### Requirement: Adjuntar imágenes al agente

La persona SHALL poder pegar una imagen del portapapeles o arrastrar un archivo de imagen sobre una terminal del panel. El panel SHALL guardarla en `${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/uploads/` con un nombre único y permisos solo para el usuario, escribir su ruta absoluta en la entrada de la terminal sin enviarla y mostrar un aviso con miniatura y opción de verla. Los archivos que no sean imagen o superen el límite SHALL rechazarse con un aviso que explique el motivo. Pegar texto SHALL seguir funcionando como siempre. El servidor SHALL borrar las imágenes adjuntadas con más de 7 días.

#### Scenario: Pegar una captura

- **WHEN** la persona copia una captura y pulsa Ctrl+V con el foco en una terminal
- **THEN** la imagen se guarda, su ruta aparece en el prompt y se muestra el aviso «Imagen adjuntada»

#### Scenario: Arrastrar un archivo que no es imagen

- **WHEN** la persona suelta un vídeo sobre la terminal
- **THEN** no se guarda nada y aparece el aviso de rechazo con los tipos y el tamaño admitidos

### Requirement: Las sesiones del panel indican su superficie

Las sesiones que crea el panel SHALL arrancar con `JDEV_SURFACE=panel`. `bin/agent` SHALL exportar `JDEV_SURFACE=terminal` cuando no venga definida y SHALL rechazar otros valores. En Claude Code, al iniciar, reanudar o compactar una sesión, un hook SHALL añadir al contexto del agente en qué superficie trabaja la persona y qué regla seguir.

#### Scenario: Sesión creada desde el panel

- **WHEN** la persona abre o retoma una sesión de Claude desde el panel
- **THEN** el agente recibe en su contexto que trabaja en el panel gráfico

#### Scenario: Sesión abierta en una terminal

- **WHEN** la persona ejecuta `bin/agent` desde una terminal
- **THEN** el agente recibe en su contexto que trabaja en una terminal sin imágenes

### Requirement: Vista previa y apertura automática de imágenes

Al pasar el ratón sobre una ruta de imagen enlazada en una terminal, el panel SHALL mostrar junto a ella una miniatura flotante con el nombre y las dimensiones, sin necesidad de clic, que desaparece al salir del enlace. El panel SHALL ofrecer en Ajustes la opción «Abrir el visor al aparecer una imagen nueva», desactivada por defecto: con ella activa, cuando una terminal visible escriba una ruta de imagen permitida que no estaba en su tira, el visor se abre con esa imagen sin quitar el foco de la terminal.

#### Scenario: Pasar el ratón por una ruta

- **WHEN** la persona pasa el ratón por `/tmp/jdev-qa/fitnessia/02-dashboard.png` en una terminal
- **THEN** aparece una miniatura de esa imagen junto al enlace y se oculta al apartar el ratón

#### Scenario: Apertura automática activada

- **WHEN** la opción está activa y el agente escribe la ruta de una captura nueva en la terminal que la persona está viendo
- **THEN** el visor lateral se abre con esa captura y el foco sigue en la terminal

#### Scenario: Apertura automática desactivada

- **WHEN** la opción está desactivada, que es su valor por defecto
- **THEN** las rutas nuevas solo se enlazan y el visor no se abre solo

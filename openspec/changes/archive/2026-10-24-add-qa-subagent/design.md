## Context

`bin/agent` registra con `--agents` los subagentes de `adapters/claude/agents.json` (`Explore`, `implementer` y `validator`). `rules/delegation.md` define un único implementador con escritura y auxiliares de solo lectura. Según la documentación de subagentes de Claude Code (versión instalada 2.1.309):

- `--agents` acepta `mcpServers` con definiciones inline (`stdio`, `http`…). Esos servidores conectan al empezar el subagente y se desconectan al terminar, y `--strict-mcp-config` no los filtra.
- Los subagentes heredan la herramienta `Artifact`, pero nunca `AskUserQuestion`, así que no pueden preguntar a la persona.
- `SendMessage` permite retomar un subagente con su contexto intacto.

Los artifacts de Claude Design son privados en claude.ai. El navegador de Playwright no tiene sesión allí, pero la acción `read` de `Artifact` guarda en local los archivos del artifact.

## Goals / Non-Goals

**Goals:**

- Verificar de punta a punta una implementación terminada sin gastar el contexto del orquestador.
- No hacer nunca una prueba mutable sin autorización explícita de la persona.
- Medir la fidelidad a Claude Design con evidencia visual.
- Mantener el harness agnóstico al stack: lo específico lo declara cada proyecto.

**Non-Goals:**

- Sustituir al `validator` ni los tests existentes del proyecto.
- Arreglar bugs de la aplicación.
- Pruebas de carga, de seguridad o contra producción.
- Soporte en Codex u otras CLIs.
- Levantar infraestructura (bases de datos o servicios) que el proyecto no sepa arrancar ya.

## Decisions

### Subagente `qa` con el MCP inline

Se añade la entrada `qa` a `adapters/claude/agents.json`:

- Usa Sonnet con esfuerzo `high`, porque juzgar diseños y anticipar caminos alternativos requiere más criterio que el de `Explore` o `validator`.
- Hereda las herramientas de la sesión, incluida `Artifact`, salvo las de edición (`disallowedTools`: `Edit`, `Write` y `NotebookEdit`).
- Define `mcpServers` con `playwright` inline: `npx -y @playwright/mcp@0.0.83 --headless --isolated --browser chromium`. La versión se fija para que el comportamiento sea reproducible. `--isolated` mantiene el perfil en memoria, para que no queden sesiones entre ejecuciones.

Comprobado con `claude -p`: las herramientas `mcp__playwright__*` solo aparecen en `qa` y no en la sesión principal.

### Evidencias fuera del repositorio

Por defecto, Playwright MCP escribe sus snapshots y logs en `.playwright-mcp/`, dentro del directorio de trabajo, es decir, en el proyecto. Claude Code no expande variables en los argumentos de `mcpServers` de `--agents`, así que no sirve poner `--output-dir` en el JSON. Por eso `bin/agent` exporta `PLAYWRIGHT_MCP_OUTPUT_DIR=${TMPDIR:-/tmp}/jdev-qa/<proyecto>`, que el proceso del MCP hereda.

Las capturas con un nombre relativo se siguen guardando en el directorio de trabajo, así que el prompt obliga al QA a usar siempre rutas absolutas dentro de `$PLAYWRIGHT_MCP_OUTPUT_DIR`.

La primera vez, el MCP necesita su build de Chromium (`npx @playwright/mcp@<versión> install-browser chrome-for-testing`, unos 120 MiB en `~/.cache/ms-playwright`). Si falta, el QA lo reporta como bloqueo y no lo instala por su cuenta. La versión se fija para que el comportamiento sea reproducible, en lugar de usar `@latest`.

`bin/agent` ya pasa el JSON completo. Solo hay que añadir la variable del directorio de evidencias (ver más abajo).

Alternativa descartada: registrar Playwright para toda la sesión con `--mcp-config`. Cargaría sus herramientas en el orquestador y en el resto de subagentes.

### Contrato con el proyecto

El QA lee un apartado `## QA` del `AGENTS.md` del proyecto con:

- el comando de arranque del entorno de desarrollo y la URL;
- los usuarios o datos de prueba;
- qué se considera seguro en ese entorno;
- la carpeta y el comando de los tests e2e, si existen, para que la especificación de tests siga sus convenciones.

Si falta el apartado o algún dato imprescindible, el QA no lo inventa: devuelve un bloqueo con lo que falta. Puede deducir datos que no sean críticos (por ejemplo, el script `dev` de `package.json`), pero lo declara en su informe. Solo usa un entorno distinto del de desarrollo si el encargo lo indica.

### Cobertura derivada del cambio

El orquestador le pasa el diff o el alcance, la spec de OpenSpec si existe, el diseño y lo que la persona quiera que se pruebe. Con eso el QA construye una matriz de casos:

- happy path;
- validaciones y datos límite;
- errores del servidor y de red;
- estados vacíos y de carga;
- permisos y sesiones;
- navegación (atrás, recarga, enlaces directos);
- responsive en móvil y escritorio;
- accesibilidad básica: foco, teclado, etiquetas y contraste.

Prioriza los casos por riesgo y declara los que no cubre. «Todos los caminos» se aproxima así, con un alcance acotado y verificable en lugar de una exploración sin fin.

### Pruebas mutables en dos fases

Es mutable toda acción que cree, modifique o borre datos persistentes o que tenga efectos externos (correos, pagos, notificaciones, APIs de terceros), también en desarrollo. Si hay duda, se trata como mutable.

1. **Fase de plan.** El QA ejecuta solo las pruebas no mutables. Después devuelve su informe parcial y la lista de pruebas mutables: qué hará, qué datos crea, cambia o borra, sus efectos externos y cómo se revierte, si se puede.
2. **Autorización.** El orquestador presenta la lista a la persona y espera su respuesta. Después retoma al mismo QA con `SendMessage` indicándole las pruebas aprobadas. El QA ejecuta solo esas.

Si no hay pruebas mutables, el QA termina en la primera fase. Si una prueba no mutable resulta tener efectos inesperados, el QA se detiene y lo reporta.

Alternativa descartada: que el QA pregunte directamente. No es posible, porque `AskUserQuestion` no está disponible en subagentes.

### Fidelidad a Claude Design

Si no se indica otra fuente, el diseño de referencia es un artifact de Claude Design cuya URL pasa el orquestador.

Un canvas de Design guarda su contenido en `project/canvas.json`, que es el índice de artboards con su tamaño y título, y en un archivo `project/<nombre>.dc.html` por artboard. Esas plantillas cargan `./support.js` y solo se ven correctamente con el runtime del tipo (`artifact-type/dc-runtime.js`, que a su vez carga React desde jsDelivr). Se ha comprobado con un canvas real que este procedimiento las reproduce fielmente, incluidos los estados interactivos:

1. Leer con `Artifact` (`read`) `project/canvas.json`, los `project/*.dc.html` necesarios y `artifact-type/dc-runtime.js`.
2. Copiar el runtime como `support.js` junto a los artboards.
3. Servir la carpeta con un servidor HTTP local temporal. `file://` no sirve.
4. Abrir cada artboard con Playwright en el viewport indicado por su entrada de `canvas.json`.

En `claude -p` la herramienta `Artifact` no está disponible. En ese caso, el orquestador descarga el canvas y le pasa al QA la ruta de la copia local.

Que el `support.js` de la plataforma equivale a `dc-runtime.js` es una inferencia, avalada porque el resultado se ve igual que el original. Si un canvas no se renderiza así, el QA usa las capturas o el export que le pase el orquestador y lo declara.

Con el diseño y la app abiertos en los mismos viewports, el QA compara:

- layout, espaciados y alineación;
- tipografía;
- colores y tokens;
- textos;
- iconos e imágenes;
- estados del diseño: hover, foco, error, vacío y carga;
- comportamiento responsive.

Cada desviación lleva una captura del diseño, otra de la app, su gravedad y su ubicación. Lo que el diseño no define se marca como «no especificado» y no como fallo.


### El QA no escribe en el proyecto

El QA no tiene herramientas de edición y no modifica el repositorio. Las capturas y evidencias van a un directorio temporal fuera de él. Con los casos que merecen quedar como regresión, el QA devuelve una especificación de tests e2e: pasos, selectores comprobados, aserciones y datos. El orquestador la delega al `implementer`, que la escribe con las convenciones del proyecto, y el `validator` la ejecuta.

Motivos:
- se mantiene la regla de un único implementador con escritura;
- el `implementer` conoce las convenciones del código y usa el mismo modelo;
- el QA sigue siendo una verificación independiente del código que se prueba.

El coste es una delegación más, pero los tests e2e no siempre hacen falta, así que se paga solo cuando la persona quiere conservarlos.

Alternativa descartada: que el QA escriba los tests. Así se ahorra un paso, pero obliga a relajar la regla de un único escritor y mezcla el papel de verificar con el de implementar.

Como `Bash` sigue disponible, que no escriba depende de su prompt y de los permisos que se aprueben, igual que en `Explore` y `validator`.

### Informe y limpieza

El informe incluye:

- el entorno usado y qué se probó;
- cada fallo con sus pasos, el resultado esperado frente al observado, la evidencia y su gravedad, marcado como «confirmado» si se reproduce o «hipótesis» si no;
- las desviaciones de diseño;
- la especificación de los tests e2e propuestos;
- los casos no cubiertos.

Antes de devolver el resultado, el QA cierra el navegador y detiene los servidores que haya arrancado.

## Risks / Trade-offs

- **Coste.** Las capturas y la navegación consumen mucho contexto y cuota → se lanza al cerrar una implementación relevante con interfaz, no tras cada cambio.
- **Falsos positivos por timing o datos** → se reproduce cada fallo antes de marcarlo como confirmado.
- **Clasificar mal una prueba mutable** → la regla es conservadora: ante la duda, mutable.
- **Procesos huérfanos** (servidor de desarrollo, servidor del diseño o navegador) → limpieza obligatoria en el QA y comprobación del orquestador, como ya exige `delegation.md`.
- **Renderizado de Design** → puede no ser exacto; se declara la fuente usada.
- **Dependencia externa** (`npx` y unos 120 MiB de Chromium la primera vez) → la versión queda fijada en el adaptador. Si falta Node, el QA reporta el bloqueo.
- **Escritura por Bash** → el QA no tiene herramientas de edición, pero sí Bash; se limita con su prompt y los permisos.

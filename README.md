# jdev-ai

[English](README.en.md)

`jdev-ai` es un harness global y ligero para trabajar con agentes de IA sobre varios proyectos independientes. Centraliza reglas y flujos de trabajo sin imponer stack, dependencias ni arquitectura a los proyectos.

## Separación entre harness y proyectos

El harness define **cómo trabajan los agentes**. Cada repositorio situado en `projects/<nombre>/` define su dominio, código, dependencias, documentación y configuración. No es un monorepo ni un workspace: cada proyecto conserva su propio `.git` y puede funcionar aunque este harness desaparezca.

`projects/` está ignorado por completo por el Git de `jdev-ai`, de modo que los repositorios anidados no se rastrean ni se mezclan con él.

## Añadir un proyecto

1. Mueve o clona el repositorio a `jdev-ai/projects/<nombre-proyecto>/`, conservando su `.git`.
2. Crea o adapta su `AGENTS.md` con el contexto y las reglas propias del proyecto.
3. Cuando el flujo determine que un cambio merece OpenSpec y el desarrollador haya aprobado su uso, instálalo e inicialízalo **dentro de ese proyecto**. Antes, consulta `openspec --help` y la documentación de la versión instalada; el harness no asume comandos ni estructuras concretas.
4. Si quieres habilitar memoria auxiliar, crea `.agent/memory/index.md` dentro del proyecto siguiendo [`rules/memory.md`](rules/memory.md).
5. Ignora `/.agent/history/` en el Git del proyecto; el agente creará la carpeta cuando registre la primera iteración relevante.
6. Abre el proyecto con `bin/agent <nombre-proyecto>`.

Las instrucciones específicas del proyecto prevalecen sobre las globales de `AGENTS.md`. El idioma predeterminado es castellano de España, aunque cada proyecto puede sobrescribirlo.

## Lanzar un agente

```sh
bin/agent mi-proyecto             # Claude, por defecto (el nombre no distingue mayúsculas)
bin/agent mi-proyecto --claude
bin/agent mi-proyecto --codex
bin/agent mi-proyecto --copilot
bin/agent mi-proyecto --opencode
bin/agent --codex mi-proyecto     # el orden de proyecto y agente es indiferente
bin/agent .                       # repositorio Git actual: un proyecto de projects/, uno de sus worktrees o el propio harness
bin/agent mi-proyecto -- resume   # lo que sigue a «--» se pasa tal cual al agente
bin/agent mi-proyecto --wt login  # abre (o retoma) la sesión en el worktree «login»
```

Al iniciar la sesión se muestra un resumen pensado para retomar un proyecto
tras días sin tocarlo:

- **Última sesión**: título, fecha, hace cuánto fue, cómo quedó y los primeros
  puntos de su resumen en `.agent/history/`.
- **Desde entonces**: commits posteriores a esa sesión, cambios locales sin
  commit y cambios OpenSpec abiertos con su progreso de tareas.
- **Pendiente de ti**: decisiones o acciones que esperan a la persona, si la
  última sesión las registró.
- **Por dónde seguir**: la continuación recomendada de la última sesión o, si
  no existe, una sugerencia según el estado de Git y OpenSpec.

Lo genera `bin/session-status`, que solo lee metadatos locales: no analiza
código ni specs, y el resumen se muestra a la persona sin enviarse como
contexto al modelo. La última sesión se elige por su fecha y hora, no por el
nombre del archivo. Para retomar con más detalle, pide al agente «ponme al
día»: sigue el apartado «Puesta al día» de [`rules/history.md`](rules/history.md).

- **Claude**: el launcher registra con `--settings` un hook `SessionStart`
  (`startup` y `clear`) que muestra el resumen dentro de la sesión al arrancar y
  tras `/clear`. No requiere confirmación.
- **Codex**: registra el mismo hook con `--config`. Codex exige revisar y
  confiar una vez en él desde `/hooks`; hasta entonces lo omite. El comando es
  idéntico en todos los proyectos, así que basta confiar una vez mientras no
  cambie la ruta del harness.
- **Copilot y OpenCode**: el resumen se imprime en la terminal antes de abrirlos.

El launcher no modifica archivos, instala dependencias ni inicializa OpenSpec,
y no añade configuración a los proyectos. El ejecutable elegido (`codex`,
`claude`, `copilot` u `opencode`) debe estar instalado y disponible en `PATH`.

### Orquestación y delegación

Para tareas que requieran planificación e implementación relevante, el agente
principal actúa como orquestador y puede delegar una tarea acotada a un único
implementador, además de exploraciones y validaciones a auxiliares de solo
lectura. La política común y agnóstica al proveedor está en
[`rules/delegation.md`](rules/delegation.md). Si una herramienta no admite
subagentes compatibles, el agente principal desempeña ambos roles de forma
secuencial.

Al lanzar Codex mediante `agent`, el harness utiliza la sesión principal con
GPT-6 Astra y esfuerzo `medium`, y registra el implementador definido en
`adapters/codex/implementer.toml` con GPT-6 Luna y esfuerzo `max`. Esta
configuración se inyecta desde el launcher y no añade archivos `.codex/` a los
proyectos. También limita la sesión a un único subagente concurrente.

Codex solo descubre `AGENTS.md` hasta la raíz Git del proyecto, por lo que no
vería las reglas del harness. Por eso el launcher inyecta `AGENTS.md` del
harness como `developer_instructions`, indicando la ruta real de `<harness>`.
Esto sustituye cualquier `developer_instructions` definido en
`~/.codex/config.toml` durante esa sesión. Al abrir el propio harness no se
inyecta, porque Codex ya lo carga. Claude Code no lo necesita: sube por los
directorios y carga el `CLAUDE.md` del harness por sí solo.

Codex acepta claves `--config` desconocidas sin error, así que el launcher no
puede confirmar que las claves `agents.*` registren el implementador. La
variable `codex_verified_version` de `bin/agent` indica la versión de
codex-cli con la que se comprobó a mano; si la instalada es otra, el resumen
muestra un aviso. Para verificarla, pide en una sesión que delegue una tarea
trivial en `implementer` y, si funciona, actualiza esa variable.

Los defaults de Codex pueden sobrescribirse para una ejecución mediante
variables de entorno:

```sh
JDEV_CODEX_ORCHESTRATOR_MODEL=gpt-5.6-terra \
JDEV_CODEX_ORCHESTRATOR_EFFORT=high \
JDEV_CODEX_IMPLEMENTER_MODEL=gpt-6-luna \
JDEV_CODEX_IMPLEMENTER_EFFORT=max \
agent mi-proyecto
```

Estas preferencias solo se aplican al entrar mediante el launcher.

Al lanzar Claude mediante `agent`, la sesión principal (orquestador) usa el
modelo y el esfuerzo que tengas configurados en Claude Code, y el launcher
registra con `--agents` los subagentes de `adapters/claude/agents.json`:

| Subagente | Modelo | Esfuerzo | Herramientas | Uso |
| --- | --- | --- | --- | --- |
| `Explore` | Haiku | `medium` | Lectura, búsqueda, Bash y web; sin edición | Sustituye al Explore integrado para búsquedas y lecturas amplias |
| `implementer` | Sonnet | `high` | Todas | Implementador único de `rules/delegation.md` |
| `validator` | Haiku | `medium` | Lectura, búsqueda y Bash; sin edición | Ejecuta las validaciones, reproduce los fallos y resume su causa |
| `qa` | Sonnet | `high` | Todas menos edición, con el MCP de Playwright | QA de punta a punta al cerrar una implementación con interfaz |

El reparto busca reservar el modelo principal (normalmente Opus) para
planificar, decidir y revisar, y llevar a modelos más baratos la lectura masiva
y la implementación acotada. Para cambiar modelos o esfuerzos, edita el
adaptador; para la sesión principal, usa `/model` y `/effort` o pásalos tras
`--` (por ejemplo, `agent mi-proyecto -- --model sonnet` para tareas sencillas).
Ten en cuenta que:

- Los subagentes de `--agents` tienen prioridad sobre los `.claude/agents/` de
  un proyecto con el mismo nombre.
- Cada subagente consume cuota propia y no comparte la caché de la sesión
  principal; delegar trabajo trivial sale más caro que resolverlo directamente.
  `/usage` muestra el consumo por subagente.
- El modelo y el esfuerzo de cada subagente no se pueden comprobar desde el
  launcher; revísalos con `/usage` tras una delegación.
- `Explore`, `validator` y `qa` no tienen herramientas de edición, pero sí Bash:
  que no escriban en el proyecto depende de su prompt y de los permisos que
  apruebes.

### Subagente de QA

`qa` prueba una implementación terminada en el navegador con el MCP de
Playwright (`@playwright/mcp`, con versión fijada en el adaptador). Solo él carga
ese MCP: arranca con el subagente y se cierra al terminar. El flujo completo está
en [`rules/delegation.md`](rules/delegation.md#qa).

- **Visto bueno.** El agente no lo lanza por su cuenta: te avisa, te dice si
  recomienda lanzarlo y por qué, y espera tu respuesta.
- **Entorno.** Prueba en el entorno de desarrollo salvo que indiques otro.
- **Pruebas mutables.** Antes de crear, cambiar o borrar datos, o de provocar
  efectos externos, te muestra la lista de esas pruebas y espera tu
  autorización.
- **Diseño.** Por defecto lo compara con Claude Design. Pásale la URL del
  canvas. El QA lo descarga, lo sirve en local con el runtime del propio canvas
  y lo compara con la app en los mismos viewports.
- **Tests e2e.** No escribe tests. Propone su especificación, y los escribe el
  `implementer` si quieres conservarlos.

Para que un proyecto pueda usarlo, añade a su `AGENTS.md` un apartado `## QA`:

```markdown
## QA

- Arranque del entorno de desarrollo: `pnpm dev` (http://localhost:3000)
- Datos de prueba: usuario `demo@example.com` / `demo1234`
- Seguro en desarrollo: base de datos local desechable; los correos van a Mailpit
- Tests e2e: `e2e/`, con `pnpm test:e2e`
```

Requisitos y efectos:

- **Node y navegador.** Hace falta Node (`npx`). La primera vez, instala el
  navegador del MCP con `npx @playwright/mcp@0.0.83 install-browser
  chrome-for-testing` (unos 120 MiB en `~/.cache/ms-playwright`). Usa la misma
  versión que fija el adaptador.
- **Evidencias.** Las capturas y los snapshots van a `PLAYWRIGHT_MCP_OUTPUT_DIR`,
  que el launcher fija por defecto en `${TMPDIR:-/tmp}/jdev-qa/<proyecto>`, fuera
  del repositorio.
- **Coste.** Es el subagente más caro, porque navega y hace capturas. Lánzalo al
  cerrar una feature, no tras cada cambio.

Para que sepas cuándo y para qué se usa cada modelo, el launcher registra
también un hook `PreToolUse` sobre la herramienta `Agent` que ejecuta
`bin/subagent-notice` antes de cada delegación y muestra un aviso como
`⇢ Subagente implementer · sonnet [high] — Implementar validación del
formulario`. El modelo sale del parámetro de la llamada o del adaptador; los
subagentes que no están en él, como `fork`, aparecen con el modelo de la
sesión. Además, `rules/delegation.md` pide al orquestador que explique en una
línea por qué delega.

Con Claude, el agente pone a cada sesión un título corto que describe el
trabajo y que es el que ves en `/resume`. Al integrar una feature en la rama
principal marca la conversación como hecha con `bin/session-done`, sin tocar
el título (guarda cuándo, quién y una nota opcional en
`~/.local/state/jdev-ai/conversations/`), y un hook `UserPromptSubmit`
(`bin/session-title --hook`) la reabre en cuanto vuelves a escribir en la
terminal. También puedes marcarla tú desde el panel. Las conversaciones que ya
llevaban `[Closed] ` en el título cuentan como hechas, sin migrar nada; fuera del
panel, la marca ya no se ve en la lista de `claude --resume`. Las políticas están
en [`rules/session-title.md`](rules/session-title.md) y
[`rules/session-done.md`](rules/session-done.md).

Copilot y OpenCode mantienen su ejecución actual; podrán mapear los mismos
roles a sus mecanismos nativos sin cambiar la política común ni los proyectos.

Opcionalmente, añade el directorio `bin/` a tu `PATH` para poder usar `agent` desde cualquier lugar:

```sh
export PATH="$HOME/proyectos/jdev-ai/bin:$PATH"
```

## Sesiones en paralelo con worktrees

Si trabajas con varias sesiones a la vez en el mismo proyecto, los cambios
grandes se aíslan en un worktree de Git con su propia rama para que no se pisen.
No tienes que decidirlo al lanzar ni abrir otra terminal. Abre
`agent mi-proyecto` como siempre y, si el agente ve que el cambio es grande, te
lo propondrá. También puedes pedirlo para cualquier cambio («crea un worktree
para…»). Si aceptas, la misma sesión hace todo el ciclo:

1. Crea la rama `feat/login` y el worktree `projects/mi-proyecto.worktrees/login/`
   con `bin/worktree create login`, y entra en él.
2. Implementa y hace commits solo en esa rama. Tras cada commit la sube a GitHub
   (`bin/worktree push login`) como copia de seguridad.
3. Al terminar, te propone integrar. Si confirmas:
   - trae la rama principal al worktree, resuelve allí los conflictos y valida;
   - abre una Pull Request;
   - vuelve al checkout principal y ejecuta `bin/worktree merge login`. El
     script espera a los checks de GitHub, integra la PR con un commit de merge,
     borra la rama remota y actualiza tu `main` local;
   - termina con `bin/worktree remove login`, que borra el worktree y la rama
     local.

Hay dos confirmaciones: al aceptar el worktree (rama, commits y push de la
rama) y al integrar (PR, merge y limpieza). Si un check falla, no se integra
nada. En un proyecto sin remoto `origin`, la integración se hace en local con
`merge --no-ff`.

El grado de aislamiento depende de la CLI:

- **Claude Code** mueve la sesión dentro del worktree con su herramienta
  `EnterWorktree`. Los comandos, las rutas relativas y los subagentes trabajan
  allí, igual que si se hubiera abierto en él.
- **Codex** no puede cambiar el directorio de la sesión, así que trabaja en el
  worktree con rutas absolutas. El checkout principal sigue siendo escribible, y
  el aislamiento depende de que el agente respete la regla: antes de cada commit
  comprueba que no ha tocado el principal. El launcher le da acceso de escritura
  a `projects/<proyecto>.worktrees/`.

`bin/worktree` (`create`, `list`, `push`, `merge`, `remove`) también se puede usar a mano.
`merge --local` fuerza la integración en local aunque exista `origin`. El
nombre de la feature solo admite `[a-z0-9._-]`, sin empezar por `.` o `-`, y
`JDEV_WORKTREE_CHECKS_WAIT` (segundos, 10 por defecto) ajusta la espera entre
reintentos mientras la Pull Request aún no tiene checks registrados.
`bin/agent mi-proyecto --wt login` abre directamente una sesión dentro de un
worktree. Es útil para retomar una feature que quedó a medias, y en ese caso
también Codex queda aislado del checkout principal. El panel de inicio lista los
worktrees abiertos del proyecto y, dentro de uno, muestra la feature y la rama
activas. El historial es siempre el del checkout principal.

Si el proyecto necesita archivos no versionados, como `.env`, puede listarlos en
`.agent/worktree-files`, con una ruta relativa por línea. Se copian al crear el
worktree sin sobrescribir nada. Ten en cuenta que los worktrees no aíslan
puertos, bases de datos locales, cachés ni servicios, y que dos features que
tocan los mismos archivos chocarán igualmente al integrarse. La política
completa está en [`rules/worktrees.md`](rules/worktrees.md).

## Panel gráfico

`bin/panel` abre en el navegador un panel local que reúne las terminales de
agente de todos los proyectos: barra lateral con las sesiones agrupadas por
proyecto, su título y su estado (te espera, trabajando, en reposo o hecha),
terminales en una, dos o cuatro columnas, diálogo para abrir una sesión nueva
con `bin/agent`, las pantallas Inicio, Backlog, Cambios, Guías e Historial y una
pantalla de Ajustes con estos apartados:

- **Apariencia**: tema (con la opción de seguir el del sistema), color de
  acento, pantalla al abrir, tu nombre para el saludo, mostrar u ocultar «tu
  actividad» y cinco detalles que se pueden desactivar por separado: cursor
  parpadeante del logo, luces piloto animadas, arte ASCII en los estados
  vacíos, saludo según la hora y retícula de puntos de fondo.
- **Tipografía**: fuente y tamaño de la interfaz, los títulos y la terminal.
- **Terminal**: cursor, distribución inicial, historial, copiar al seleccionar,
  barra de tmux, miniatura al pasar por una ruta de imagen y apertura
  automática del visor.
- **Proyectos**: por proyecto, su monograma, su color, si es visible en el panel y el comando de
  su servidor de desarrollo.
- **Avisos**: notificación del sistema, contador en el título de la pestaña
  («(1) jdev-ai»), sonido y si también avisa cuando una sesión termina. Se
  elige un sonido para cuando una sesión te espera y otro para cuando termina,
  entre varios sintetizados en el navegador (teletipo, campanilla, dos tonos,
  gota, pulso, acorde, marimba y radar) o, en WSL, entre los de Windows
  (`C:\Windows\Media`, como el «Notify Calendar»), que el panel sirve desde el
  disco sin copiarlos; con un botón para probarlos.
- **Agentes**: el agente por defecto de las sesiones nuevas y dónde trabajan
  por defecto (checkout principal o worktree nuevo).
- **Atajos de teclado**: la lista completa de atajos.
- **Servidor local**: el puerto del panel.

Una sesión nueva se abre en su propia pestaña; la casilla «Abrir junto a la
terminal activa» del diálogo, desmarcada por defecto, la coloca al lado
dividiendo la vista.

Requisitos: Node 24, pnpm, tmux y un compilador para `node-pty` (en Ubuntu,
`sudo apt install build-essential`). La primera vez:

```sh
pnpm --dir panel install
bin/panel --app           # ventana de aplicación; o --open, o abre la URL que imprime
```

`bin/panel` compila el cliente por sí solo cuando falta `panel/dist` o cuando
hay cambios más recientes en `panel/src` o en `panel/index.html`.

- **Como aplicación (PWA).** `bin/panel --app` abre el panel en una ventana
  de aplicación de Chrome (`JDEV_PANEL_BROWSER=msedge` para Edge). Con el
  panel abierto en Chrome o Edge, usa
  «Instalar jdev-ai» en el menú del navegador: tendrás una ventana propia sin
  pestañas, con su icono en la barra de tareas y en el menú Inicio. La
  aplicación abre el panel en `http://localhost:4317`, así que `bin/panel`
  tiene que estar en marcha; la cookie del token dura un año y se invalida al
  regenerarlo.

- **Como programa de Windows.** `bin/panel-desktop build` compila desde WSL un
  `jdev-ai.exe` y `bin/panel-desktop install` lo copia a
  `%LOCALAPPDATA%\Programs\jdev-ai\` con un acceso directo en el menú Inicio.
  Al abrirlo arranca el panel dentro de WSL y lo muestra en su propia ventana,
  sin terminal ni navegador; si el panel ya estaba en marcha con `bin/panel`,
  se conecta a él. Al cerrarlo para el servidor que arrancó (las sesiones
  siguen en tmux). Los avisos salen como notificaciones de Windows, aunque al
  pulsarlas no abren la sesión. Los enlaces externos se abren en el navegador
  por defecto. Es opcional y solo para compilar hacen falta Rust con el target
  `x86_64-pc-windows-msvc`, `cargo-xwin`, `clang`, `lld` y `llvm`; el script
  indica lo que falte. La distro de WSL y la ruta del harness quedan grabadas
  en el ejecutable: si cambian, vuelve a compilar e instalar. No hace falta
  recompilar cuando cambia el panel.

- **Sesiones en tmux.** Cada terminal es una sesión de un servidor tmux propio
  (`tmux -L jdev`). Cerrar el navegador o detener el panel no las termina, y
  puedes entrar desde cualquier terminal con `tmux -L jdev attach -t <sesión>`
  (el menú de cada terminal copia el comando). Las sesiones se terminan desde
  el panel, con confirmación.
- **Estados.** `bin/agent` registra en Claude Code unos hooks que ejecutan
  `bin/session-state` y guardan el estado de cada sesión en
  `~/.local/state/jdev-ai/sessions/`, aunque el panel no esté abierto. Cuando
  una notificación deja la sesión esperando, guarda también su texto (recortado
  a 300 caracteres, tal como lo escribe Claude, en inglés). Codex, Copilot y
  OpenCode solo muestran si la sesión está viva.
- **Estado de la sesión en la cabecera.** Cada terminal muestra, en tres filas:
  el título con su estado y «⋯»; una línea con el proyecto, la rama o el
  worktree, el modelo y el esfuerzo, el tiempo de sesión y, a la derecha, la
  barra de contexto (neutra por debajo del 50 %, ámbar desde el 50 % y roja con
  icono desde el 80 %); y, solo si hay trabajo en curso, chips de subagentes
  activos, shells en segundo plano y artifacts publicados que despliegan su
  detalle. Si los datos llevan más de 15 minutos sin cambiar y la sesión no
  trabaja, se atenúan y muestran su antigüedad; en columnas estrechas (menos de
  unos 520 px) se ocultan el proyecto, el tiempo y los tokens y el trabajo pasa
  a contadores junto al título. Los datos de modelo, contexto y trabajo en curso
  solo existen para Claude lanzado desde el panel; Codex, Copilot y OpenCode
  muestran proyecto, rama, agente y tiempo. La cabecera global (salvo en
  Ajustes) trae el agente por defecto de las sesiones nuevas, con un menú para
  cambiarlo, y los límites de 5 horas y 7 días de la cuenta, con su hora de
  reinicio al pulsarlos (se ocultan hasta que una sesión de Claude del panel los
  informe). En ventanas estrechas la cabecera se compacta: por debajo de 1280 px
  los límites van sin barras, por debajo de 1024 px el agente y «Nueva sesión»
  solo muestran su icono y por debajo de ~1180 px las secciones bajan a una
  segunda fila.
- **Statusline del panel.** Con `JDEV_SURFACE=panel`, `bin/agent` configura
  `bin/session-statusline` como statusline de Claude: guarda el JSON que recibe
  en `~/.local/state/jdev-ai/statusline/<sesión>.json` (máximo 64 KiB) y no
  imprime nada, así que la terminal del panel no repite lo que ya muestra la
  cabecera. `bin/session-activity` registra en
  `~/.local/state/jdev-ai/activity/<sesión>.jsonl` (permisos 0600, máximo 256 KiB,
  se vacía al pasarlo) el inicio y el fin de los subagentes, las tareas en segundo plano al
  acabar cada turno (por eso las shells se actualizan solo entonces) y los
  artifacts publicados. En una terminal normal no se toca tu statusline. El
  panel borra esos archivos cuando la sesión de tmux ya no existe. El coste
  deja de verse en las sesiones del panel.
- **Seguimiento de subagentes y shells.** En el modo clásico Claude no recibe
  clics, así que sus subagentes y shells en segundo plano no se abren desde su
  barra inferior. En el panel, al pulsar uno en el desplegable de su chip de la
  cabecera se abre una pestaña de solo lectura (icono de ojo) junto a las de
  terminal, que sirve en las distribuciones de 1, 2 y 4 columnas y se cierra con
  «×». Para un subagente muestra su descripción, su estado, su tipo, la sesión
  que lo lanzó, el encargo (plegable), cada herramienta con un verbo («Leo»,
  «Busco», «Edito», «Ejecuto»…) y un resumen de su resultado, en rojo si falla,
  sus mensajes y, al terminar, su resultado final; no muestra el razonamiento
  interno. Para una shell, el comando, su estado y las últimas 2 000 líneas de su
  salida como texto plano. Se actualiza en directo (sondeo cada segundo mientras
  sigue en marcha) con «Seguir al final», y la pestaña sigue abierta con
  «Terminado» hasta que la cierres. El servidor solo lee archivos tuyos dentro de
  las carpetas de Claude y de sesiones del panel: el transcript de cada subagente
  (`<transcript de la sesión>/<sesión>/subagents/agent-<id>.jsonl`) y la salida de
  la shell en la ruta que Claude anunció bajo `/tmp/claude-<uid>/`. Depende de
  formatos internos de Claude Code (2.1.316), que pueden cambiar; lo que no
  entiende lo ignora y, si falta un archivo, la pestaña lo explica.
- **Vista chat.** La cabecera de cada terminal de Claude tiene un conmutador
  «Terminal / Chat», que se recuerda por pestaña. La vista chat se construye con
  el transcript de la sesión. Muestra:
  - tus mensajes, como texto plano;
  - las respuestas de Claude, en Markdown saneado;
  - las herramientas que se ejecutan seguidas, agrupadas en un desplegable
    cerrado con su resultado y sus errores en rojo;
  - los comandos de Claude Code (`/goal close`, `/compact`, `/clear`…) como un
    mensaje tuyo en monoespaciado, con su salida local atenuada debajo y entran
    en la búsqueda (el contexto interno que algunos añaden no se muestra).

  No muestra el razonamiento interno. Al entrar, carga la conversación entera
  para que la búsqueda la cubra toda. La lupa o Ctrl+F abren la búsqueda, que no
  distingue mayúsculas ni tildes, busca también en los resultados de las
  herramientas y abre los desplegables con coincidencias; se navega con Enter,
  ↑ y ↓.

  La caja de abajo pega tu mensaje en la sesión de tmux entre corchetes, así que
  los saltos de línea no lo envían antes de tiempo, y después pulsa Enter. El
  límite es de 64 KiB. Enter envía y Shift+Enter hace un salto de línea. Los
  permisos y los menús se responden en la terminal: si Claude espera una
  respuesta así, el chat lo avisa con un botón «Ir a la terminal».

  Los comandos se escriben en la misma caja. `/btw pregunta` abre en la terminal
  una ventana con la respuesta y Claude no la guarda en la transcripción: el
  panel lee el texto de esa ventana (si no cabe, la desplaza con la flecha
  abajo y une las pantallas; si no llega a confirmar que ha llegado al final,
  lo avisa), la cierra con Escape y la muestra en el chat, como texto
  preformateado (la TUI ya la maqueta), en un bloque aparte, «Pregunta al margen», que no forma parte de la conversación. Ese
  bloque solo vive en el navegador: desaparece al recargar el panel. El panel
  nunca pulsa `c` en la ventana (Claude copiaría también con la herramienta del
  sistema y pisaría tu portapapeles), así que este no se toca. Si Claude tiene abierta una
  ventana o un menú (la de `/btw`, un selector como `/model`, un diálogo de
  permiso), el chat no envía el mensaje, porque se perdería o respondería al
  diálogo: conserva el texto y avisa de que hay que cerrarla en la terminal. Un
  comando que abre un menú se envía y el chat avisa de que espera en la
  terminal.

  La terminal sigue conectada mientras ves el chat. En las sesiones de Codex y
  en las terminales sin agente el conmutador está desactivado y explica por qué.
- **Conversaciones anteriores.** Dentro de cada proyecto de la barra lateral,
  bajo sus sesiones en marcha, un apartado plegado «Anteriores (N)» lista (tres,
  con «Ver más») las conversaciones de Claude Code que no están en el panel, leídas de los transcripts de `~/.claude/projects/` (o de
  `CLAUDE_CONFIG_DIR`) del checkout principal y los worktrees, de los últimos
  30 días y con un máximo de 15 por proyecto. «Retomar en el panel» abre una
  terminal nueva con `bin/agent <proyecto> -- --resume <id>`. Cierra antes la
  sesión en su ventana original: dos procesos sobre la misma conversación se
  pisarían el historial. El panel avisa de las que tuvieron actividad en los
  últimos 3 minutos porque pueden seguir abiertas en otra ventana.
- **Tooltip y archivado en la barra lateral.** Al pasar el ratón (400 ms) o con
  el foco del teclado por una sesión o una conversación de «Anteriores», un
  tooltip muestra su título completo, el proyecto, la rama o el worktree y el
  agente; en una sesión viva de Claude añade el modelo y el esfuerzo, la barra de
  contexto, el tiempo y el trabajo en curso. «Archivar» en el menú contextual
  (barra, pestañas y «⋯») aparta una sesión o una conversación sin terminarla ni
  cerrar su pestaña: sale de su proyecto, de «Anteriores» y de «En segundo plano»
  y pasa a un apartado plegable «Archivadas (N)», debajo de «En segundo plano»,
  desde el que se abre, se retoma o se desarchiva. Una sesión archivada que espera
  sigue contando en la cabecera, el título de la pestaña e Inicio; las demás no
  cuentan en los recuentos ni en las tarjetas de Inicio. Las conversaciones
  archivadas no gastan el límite de «Anteriores» (15 por proyecto; las archivadas
  tienen su propio máximo y solo se ven dentro de los últimos 30 días) y retomar
  una la desarchiva. La lista se guarda en `~/.config/jdev-ai/archived.json` (respeta `XDG_CONFIG_HOME`; las
  sesiones que dejan de existir salen solas, máximo 500 conversaciones).
- **Terminal (sin agente).** En «Nueva sesión» (o con el «+» de cada proyecto de la barra lateral, que abre el diálogo con ese proyecto y la terminal elegidos, y en el agente por defecto de la
  cabecera y de Ajustes) puedes elegir «Terminal (sin agente)»: una sesión de tmux
  con tu shell de login (`$SHELL -l`, o `bash -l`) en la carpeta del proyecto o de
  un worktree existente, para lanzar comandos o servidores. No usa `bin/agent`, no
  admite worktree nuevo ni prompt, lleva un icono de terminal en lugar de la luz de
  estado y no cuenta en los avisos ni en los recuentos de Inicio. Funciona con
  pestañas, renombrado, archivado y «En segundo plano».
- **Arrancar y parar un proyecto.** El botón ▶ junto al «+» de cada proyecto de la
  barra lateral crea una terminal sin agente en su carpeta principal, titulada
  «dev · <proyecto>», escribe en ella el comando de arranque (queda en el historial
  de la shell) y la abre en una pestaña. Al cerrar la pestaña el servidor sigue en
  «En segundo plano». El botón pasa a ■: envía `Ctrl+C`, espera hasta 5 s a que
  el proceso termine y termina la sesión en cualquier caso. Hay como mucho una
  terminal de arranque por proyecto; volver a arrancar abre la que ya está viva.
  El comando es el que escribas en Ajustes › Proyectos › «Comando de arranque»
  (guardado en `projects.<proyecto>.run` de `panel.json`, una línea de hasta 500
  caracteres, que se ejecuta tal cual en tu shell) o, si no hay, el script `dev`
  del `package.json` de la carpeta principal con el gestor que indique
  `packageManager` o, si no, el lockfile (`pnpm-lock.yaml` → `pnpm dev`;
  `bun.lockb`/`bun.lock` → `bun dev`; `yarn.lock` → `yarn dev`; si no, `npm run dev`).
  Sin ninguno de los dos, el botón sale desactivado y su ayuda lleva a Ajustes. Solo
  aparece en los proyectos que ya salen en la barra lateral (con sesiones o
  conversaciones anteriores).
- **Terminales vivas sin abrir.** Con el panel de Terminales vacío, una lista «Terminales vivas»
  (con «Abrir todas») reúne las sesiones vivas que no están en una pestaña, ordenadas por estado
  (te espera, trabajando, en reposo, hechas) y actividad; un apartado plegable «En segundo plano (N)»
  de la barra lateral, encima de la leyenda, las lista siempre en compacto. Respetan «Ocultar hechas»
  y los proyectos ocultos, salvo las que te esperan.
- **Seguridad.** El servidor solo escucha en `127.0.0.1` y exige un token que se guarda en
  `~/.config/jdev-ai/panel-token`; `bin/panel --regenerate-token` lo cambia.
  El puerto es, por este orden, el de `--port`, el de la variable
  `JDEV_PANEL_PORT`, el de Ajustes > Servidor local o el 4317.
  Los ajustes se guardan en `~/.config/jdev-ai/panel.json`.
- **Atajos.** `Ctrl+Alt+←/→` cambia de terminal, `Ctrl+Alt+N` abre una sesión
  nueva, `Ctrl+Alt+L` cambia la distribución y `Ctrl+Alt+Esc` saca el foco de
  la terminal a su pestaña (dentro de la terminal, Tab va a la shell). Para que el navegador no se
  quede `Ctrl+T`, úsalo como aplicación (`bin/panel --app` o la PWA
  instalada); `Ctrl+W` sigue cerrando la ventana. Dentro de la terminal,
  `Ctrl+Retroceso` borra la palabra anterior (envía `Ctrl+W`) y `Ctrl+Supr` la
  siguiente (envía `Alt+D`), como en bash y Claude Code. El botón del teclado
  de la cabecera, a la izquierda de «Nueva sesión», abre una chuleta con todos
  los atajos (la misma lista que Ajustes › Atajos de teclado).
- **Historial de las terminales.** El historial lo tiene tmux, no el navegador:
  la rueda entra en el modo de copia de tmux (5 líneas por muesca) y
  `Mayús+RePág` / `Mayús+AvPág` suben y bajan una página (al llegar abajo se
  sale solo; `RePág` y `AvPág` sin Mayús siguen llegando a la aplicación). Cada terminal
  tiene a la derecha una barra fina con la posición en el historial: arrastra el
  pulgar para saltar, haz clic en la pista para paginar, y los botones «Ir arriba»
  e «Ir al final» van a los extremos (con el teclado: flechas, RePág/AvPág, Inicio
  y Fin sobre la barra). Se oculta si aún no hay historial. Para que esto valga
  con Claude Code, el panel lo arranca con su renderizador clásico
  (`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`, solo en las sesiones del panel): a
  pantalla completa su historial es virtual y no dice en qué punto está. Si la aplicación usa
  la pantalla alternativa (Claude Code a pantalla completa, vim, less), el
  historial es suyo y no de tmux: la barra se queda sin pulgar, un clic en su
  mitad de arriba o de abajo pagina, los botones envían `Ctrl+Inicio` y
  `Ctrl+Fin`, y la rueda y `Mayús+RePág` / `Mayús+AvPág` le llegan a la
  aplicación como su propio scroll. La barra consulta a
  tmux solo mientras te mueves por el historial o el ratón está encima. Esa
  configuración es de `panel/tmux.conf` y tmux solo la lee al arrancar su servidor:
  para aplicarla a uno ya en marcha, ejecuta `tmux -L jdev source-file panel/tmux.conf`
  (cambia `jdev` por tu socket si lo has cambiado con `JDEV_PANEL_TMUX_SOCKET`).
- **Pestañas.** Cada pestaña de terminal lleva una «x» (siempre en la activa;
  en las demás, al pasar el ratón o al enfocarlas) y el clic central también la
  cierra: solo quita la terminal del panel, la sesión sigue viva en tmux y en la
  barra lateral. La siguiente pestaña pasa a ser la activa. Para reordenarlas,
  arrastra una pestaña con el ratón a izquierda o derecha (pasa a ser la activa);
  el orden se guarda en el navegador.
- **Menú contextual y renombrar.** El clic derecho (o la tecla Menú / Mayús+F10)
  sobre una sesión de la barra lateral o sobre una pestaña abre un menú con
  «Abrir» (solo en la barra lateral, si no está en una pestaña), «Renombrar…»,
  «Copiar comando para adjuntar», «Marcar como hecha» o «Reabrir» (no en las
  terminales sin agente), «Cerrar pestaña» (solo si está abierta) y «Terminar
  sesión…» (con confirmación); son las mismas acciones de «Más acciones». Las
  conversaciones de «Anteriores» y «Archivadas» tienen también «Marcar como
  hecha» y «Reabrir». Una conversación hecha se muestra con un check y el texto
  «Hecha» (sin tachar el título), su tooltip dice cuándo y quién la marcó (tú o
  el agente) y su nota, y el filtro «Ocultar hechas» de la barra lateral la
  oculta (salvo si te espera). Marcarla no termina ni archiva la sesión. Se mueve con las flechas, Inicio y Fin; Esc o un clic fuera lo
  cierran. Dentro de la terminal el clic derecho no cambia. «Renombrar…» pide
  un título de hasta 80 caracteres, sin saltos de línea ni caracteres de
  control; Enter guarda y Esc cancela. En las sesiones de Claude con
  transcript añade la línea `custom-title` que escribe `bin/session-title`, así
  que también es el título que verás en `/resume`; en el resto de agentes lo guarda en la
  opción `@jdev_title` de la sesión de tmux y solo vale para el panel.
- **Paneles redimensionables.** Arrastra el borde de la barra lateral, del panel
  de Contexto y el visor de imágenes (comparten ancho), de la barra y el detalle
  de Proyectos, de la lista de Historial o de la navegación de Ajustes. Con el
  tirador enfocado, las flechas ←/→ cambian el ancho de 16 en 16 px (Mayús, de 64
  en 64), Inicio y Fin van al mínimo y al máximo, y el doble clic restablece el
  ancho por defecto. Cada ancho se recuerda en este navegador (`localStorage`) y
  el área central nunca baja de 360 px. En anchos estrechos, donde el contexto y
  el detalle se superponen, no hay tirador.
- **Menú Proyectos.** «Proyectos» en la cabecera es un desplegable con Backlog,
  Cambios y Guías, tres pantallas independientes: Backlog y Guías abren
  el último proyecto usado (o el primero visible) y Cambios, el primero visible
  con cambios (o, si ninguno tiene, el último usado en Cambios o el primero); la pantalla actual
  queda marcada en el menú. Se abre con el clic, con Enter, Espacio o las flechas y, con un ratón,
  al detenerse sobre el botón (se cierra al salir; en táctil, solo con clic). Las tres comparten la barra lateral de
  proyectos (con su ancho; al elegir otro proyecto se queda en la misma pantalla)
  y cada una tiene su propia cabecera y ruta: `#/backlog/<id>[/<elemento>]`,
  `#/cambios/<id>[/main[/<archivo>]|/wt/<worktree>[/<archivo>]]` y `#/guias/<id>[/<guía>]`. Los enlaces antiguos
  `#/proyectos/…` y `#/worktrees/…` se redirigen a las nuevas.
- **Seleccionar y copiar texto.** Arrastra, o haz doble o triple clic: al soltar,
  la selección se queda marcada y se copia al portapapeles (tmux la envía por
  OSC 52). Escape, `q` o empezar a escribir salen de la selección. Mayús +
  arrastrar hace una selección del navegador, solo de lo visible. El clic
  derecho abre solo el menú del navegador.
- **Inicio.** Es la pantalla al abrir el panel (en Ajustes > Apariencia >
  Inicio puedes elegir Terminales). Saluda según la hora con «Tu nombre» o, si
  está vacío, con el primer nombre de `git config user.name` (el saludo se
  desactiva en Ajustes > Apariencia y la pantalla pasa a titularse «Inicio»), y resume
  proyectos, sesiones y worktrees, con los recuentos de sesiones que te
  esperan, trabajando y en reposo. «Necesita tu atención» lista las sesiones
  que te esperan, con el texto del aviso y «Responder», las marcadas como
  hechas que siguen abiertas (apartado «Hechas que siguen abiertas»), con
  «Revisar» y «Terminar» (con confirmación), y los pendientes vigentes del
  historial (los sin marcar de la última entrada de cada proyecto, como en el
  resumen de `bin/session-status`), que llevan a Historial con «Solo con
  «Pendiente de ti»». Debajo,
  una tarjeta por proyecto ordenada por actividad (sesiones, historial y
  backlog) con su rama, sus sesiones, los recuentos de backlog, por hacer, en
  curso y worktrees, el último registro y los accesos a sus terminales, su
  backlog y una sesión nueva; al lado, las últimas entradas del historial.
  Solo lee: no mueve, marca ni cierra nada.
- **Tu actividad.** En Inicio, entre «Necesita tu atención» y «Proyectos»,
  resume cuánto has trabajado con Claude Code y Codex: tokens de salida (con
  entrada y caché), sesiones, respuestas y horas activas frente al periodo
  anterior, un calendario de respuestas de las últimas 12 semanas (con vista en
  tabla), tokens por proyecto, reparto por modelo, subagentes y herramientas.
  Filtra por periodo (esta semana, 30 días, todo) y por agente, y se oculta en
  Ajustes > Apariencia > Inicio. Se calcula en tu equipo leyendo, solo para
  eso, `~/.claude/projects/` (con los subagentes; o `CLAUDE_CONFIG_DIR`) y
  `~/.codex/sessions/` (o `CODEX_HOME`), sin modificarlos; el resumen se guarda
  en `${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/activity-index.json`, que se
  puede borrar sin perder nada. La primera lectura, de gigas, tarda unos
  segundos y se hace en segundo plano; después solo lee lo nuevo. Las horas
  activas y el proyecto (por el directorio de trabajo) son aproximaciones, y no
  hay coste en dinero.
- **Backlog, Cambios y Guías.** La pantalla Backlog muestra el backlog de cada proyecto (`docs/backlog/` del
  checkout principal) en columnas por estado, con filtros por tipo y prioridad
  y búsqueda. El detalle de un elemento enseña su resumen, su cabecera y el
  documento completo, y permite moverlo de estado («Pasar a por hacer» o
  «Mover a…»): el panel lo mueve con `git mv`, actualiza `status` y `updated`
  y deja el cambio sin commit, avisando de cuántos quedan pendientes.
  «Confirmar cambios» abre un diálogo con los archivos, la rama y un mensaje
  de commit propuesto y editable, y hace un commit solo de `docs/backlog/`
  (respetando los hooks del proyecto y mostrando su salida si fallan) y, si se
  marca, el push a su remoto.
  «Trabajar en esto» abre Nueva sesión con un prompt para abordar el elemento,
  sin moverlo. Cambios abre directamente el diff del checkout principal del proyecto
  (también el del propio harness), con una pestaña por lugar (`main · N` y un
  worktree por pestaña, con su número de archivos y un punto si una sesión trabaja
  ahí). Lo que se compara: en el checkout principal, lo que aún no está en su rama
  remota (commits sin subir, cambios sin commit y archivos nuevos; sin rama remota,
  solo lo que no tiene commit) y, en un worktree, lo que llevaría su PR (desde que
  se separó de la rama principal). La barra del lugar da su rama, los commits por
  delante y por detrás, «cambios sin commit», las sesiones del panel que trabajan
  ahí (con acceso a su terminal) y «Nueva sesión aquí». Debajo, un árbol de archivos
  con su estado y líneas y el diff del elegido, lado a lado o unificado (se recuerda
  la elección; en ancho estrecho, siempre unificado), solo de lectura. Guías muestra las de
  `docs/user-guides/`; en la barra lateral, cada pantalla cuenta lo suyo
  (elementos abiertos, archivos cambiados o guías).
- **Historial.** Reúne las entradas de `.agent/history/` del checkout
  principal de cada proyecto y del harness (sin subcarpetas como `archive/`),
  agrupadas por día, con filtros por proyecto y estado y «Solo con «Pendiente
  de ti»», que deja la última entrada de cada proyecto con pendientes sin
  marcar; «Incluir pendientes antiguos» añade las entradas anteriores. El
  lector destaca «Pendiente de ti» (con una nota si la entrada es anterior y
  sus pendientes ya no cuentan como vigentes) y muestra el resto de
  secciones; cada pendiente se puede marcar como hecho (o desmarcar), y el
  panel lo marca en la propia entrada como `- [x] … (hecho YYYY-MM-DD)`, que
  el resumen de inicio ya no muestra. «Marcar como hechos los pendientes
  antiguos» marca, tras confirmar, todos los de las entradas anteriores del
  proyecto elegido o de todos (no se deshace en bloque; se desmarcan uno a
  uno). «Retomar desde aquí» abre Nueva sesión con un prompt para ponerse al
  día desde esa entrada.
- **Imágenes.** Las rutas de imagen (png, jpg, gif, webp, svg) que aparecen en
  una terminal se pueden pulsar: clic las abre en un visor lateral con zoom y
  la tira de imágenes de esa terminal, y Ctrl+clic en una pestaña nueva. Solo
  se muestran imágenes dentro del harness y sus proyectos, la carpeta de QA,
  la de imágenes adjuntadas y la temporal del sistema.
  Al pasar el ratón por una ruta aparece una miniatura con su nombre y
  dimensiones (se desactiva en Ajustes > Terminal) y, si activas «Abrir el
  visor al aparecer una imagen nueva» (desactivado por defecto), el visor se
  abre solo con la imagen que una terminal visible escribe sin quitarle el
  foco.
- **Adjuntar imágenes.** Con `Ctrl+V` o arrastrando un archivo sobre la
  terminal, la imagen se guarda en `~/.cache/jdev-ai/panel/uploads/` (se borra
  a los 7 días) y su ruta se escribe en el prompt para que el agente la lea.
- **Superficie.** Las sesiones del panel arrancan con `JDEV_SURFACE=panel` y
  las de una terminal con `terminal`; en Claude Code, un hook se lo dice al
  agente al iniciar, retomar, limpiar o compactar la sesión, y [`rules/surface.md`](rules/surface.md) explica
  cómo debe mostrar y pedir imágenes en cada caso.

## Autorizaciones y cierre de cada respuesta

Las instrucciones globales de [`AGENTS.md`](AGENTS.md) fijan dos convenciones
que verás en todas las sesiones:

- **Autorizaciones.** Sin petición explícita, el agente no hace commits,
  pushes ni merges, no crea ni cambia de rama, no abre Pull Requests y no
  ejecuta acciones destructivas. Los commits siguen Conventional Commits y
  llevan en el cuerpo un punto por archivo modificado con qué cambió y por qué.
  Aceptar un worktree, confirmar su integración o pedir el cierre autónomo
  amplían esa autorización, cada uno en su ámbito.
- **Cierre de cada respuesta.** El agente termina cada iteración con
  `Siguiente paso recomendado: ...`. Cuando ya no le queda trabajo, y no hay
  cambios sin commit, commits sin subir, worktrees sin integrar ni procesos en
  marcha, dice lo que te queda a ti y termina con
  `✅ Nada pendiente: puedes cerrar esta terminal.`

## Landing

`site/` contiene la landing que presenta el proyecto en
[harness.jgonaz.dev](https://harness.jgonaz.dev): un sitio estático con Astro,
en castellano (`/`) e inglés (`/en/`), con el tema Grafito del panel. Incluye
una simulación del panel con datos inventados (`site/src/components/Panel*.astro`,
con sus datos en `site/src/data/`): reproduce Inicio, Terminales, Proyectos
(Backlog, Cambios y Guías), Historial y Ajustes, y en Ajustes el tema, el
acento y varios interruptores actúan sobre la propia simulación. Si cambia
una pantalla del panel real, conviene actualizar aquí la suya. Es
independiente del resto del harness, que no la necesita para funcionar, y
tiene sus propias dependencias:

```sh
pnpm --dir site install   # una vez
pnpm --dir site dev       # desarrollo
pnpm --dir site build     # compila en site/dist; es su validación
```

Los textos viven en `site/src/i18n/` (`es.ts` y `en.ts`, con la misma forma) y
resumen este README: si cambia lo que cuentan, actualízalos en ambos idiomas.
Se publica en el proyecto `jdev-ai` de Vercel, que usa `site` como directorio
raíz. No está conectado al repositorio de GitHub, así que un push no la
publica: despliega desde la raíz del harness con `vercel deploy --prod`. El
`.vercelignore` de la raíz hace que solo se suba `site/`.

## Validación del harness

Tras modificar `bin/agent`, `bin/session-status`, `bin/subagent-notice`, `bin/session-title`, `bin/session-done`, `bin/session-state`, `bin/session-statusline`, `bin/session-activity`, `bin/worktree`, `bin/panel`, `bin/panel-desktop` o los archivos que inyectan, ejecuta:

```sh
bin/check
```

Prueba el launcher sobre un harness temporal con agentes simulados: no lanza
agentes reales ni toca `projects/`. Si `panel/node_modules` existe, ejecuta
además el typecheck y los tests del panel gráfico; si no, lo avisa y los omite.

## Fuentes de contexto y continuidad

Cada mecanismo resuelve una necesidad distinta y evita convertir un único
documento en fuente de todo:

| Mecanismo | Objetivo | Contenido | Por qué es necesario |
| --- | --- | --- | --- |
| OpenSpec | Definir cambios funcionales relevantes antes de implementarlos | Requisitos, escenarios, proposals y tasks | Reduce ambigüedad y evita un SDD paralelo |
| Backlog | Conservar trabajo futuro específico de un proyecto | Findings, TODOs, fixes y features organizados por estado | Evita perder hallazgos que no se pueden abordar ahora |
| Guías de uso | Explicar una funcionalidad a una persona sin asumir contexto previo | Propósito, conceptos, pasos, ejemplos y limitaciones | Permite entender o recordar cómo se utiliza una parte del proyecto |
| Memoria | Conservar conocimiento duradero difícil de redescubrir | Causas de bugs, workarounds, limitaciones y enfoques descartados | Evita repetir investigaciones costosas |
| Historial | Recordar cómo terminó una iteración y por dónde continuar | Resumen, estado, decisiones, referencias y siguiente paso | Permite retomar el trabajo días después sin releer el chat |
| Git y changelog | Mostrar qué cambió realmente y qué hitos se publicaron | Código, commits e hitos relevantes | Aporta evidencia técnica e historial oficial |

OpenSpec, `AGENTS.md`, la documentación oficial, el código y Git prevalecen
sobre memoria e historial cuando exista una contradicción.

## OpenSpec

OpenSpec es la herramienta principal de Spec Driven Development para cambios grandes o con impacto funcional relevante. No se activa por el hecho de crear un commit, subir una rama o abrir una PR: el agente debe inferir si aporta valor según el alcance, el riesgo y la ambigüedad del cambio.

Suele merecer OpenSpec cuando el cambio introduce comportamiento o reglas de negocio visibles, modifica contratos públicos, datos, permisos o seguridad, requiere una decisión arquitectónica, afecta a varias partes o integraciones, tiene un despliegue o rollback delicado, o necesita coordinar varias iteraciones o personas. Los cambios pequeños, internos, reversibles y claramente acotados siguen el flujo normal. Las proposals, specs y tasks pertenecen siempre al `openspec/` del proyecto afectado: al trabajar en `projects/<nombre>/` se crean en ese proyecto y nunca en el `openspec/` del harness, que solo documenta cambios del propio harness.

Cuando el agente determine que OpenSpec puede ser adecuado, debe proponerlo antes de instalarlo, inicializarlo o crear/modificar cualquier proposal, spec o task. La propuesta debe resumir el motivo, el alcance, los riesgos y los artefactos previstos. El agente debe esperar el visto bueno explícito del desarrollador; una petición genérica de implementar el cambio no equivale a esa aprobación. Sin aprobación, continúa por el flujo normal o solicita la aclaración necesaria. Consulta `workflows/feature.md` para los criterios y checkpoints completos.

## Backlog de trabajo futuro

Cada proyecto puede conservar sus pendientes en `docs/backlog/`, con un archivo
Markdown por elemento dentro de `backlog/` (por revisar, donde entra todo lo
nuevo), `todo/` (por hacer, elegido por la persona para abordarse pronto),
`in-progress/`, `done/` o `discarded/`. Cada elemento lleva una cabecera YAML
con sus propiedades y un resumen breve en lenguaje llano antes del detalle.
Sirve para registrar explícitamente findings, TODOs, fixes o
features que no se van a abordar durante la tarea actual. La persona puede
decir, por ejemplo, «apunta un finding» y el agente debe documentarlo, informar
de su identificador y continuar con el trabajo en curso. Si detecta un hallazgo
claro y accionable por iniciativa propia, puede proponer registrarlo, pero no
creará el documento sin confirmación explícita.

El backlog pertenece al repositorio del proyecto y no sustituye la memoria, el
historial ni OpenSpec. La convención completa está en
[`rules/backlog.md`](rules/backlog.md).

## Guías de uso por proyecto

Cuando una funcionalidad necesite explicarse de forma sencilla y sin asumir
contexto previo, el proyecto puede versionar guías para desarrolladores y
usuarios bajo `docs/user-guides/`. El agente valora su necesidad al crear o
modificar funcionalidades y mantiene actualizadas las guías afectadas, pero no
documenta automáticamente cambios triviales, internos o autoevidentes. La
política completa está en [`rules/user-guides.md`](rules/user-guides.md).

## Generación de imágenes

Cuando un desarrollo necesite ilustraciones, fondos u otras imágenes que el
proyecto no tenga, el agente propone generarlas por iniciativa propia, pero no
lo hace sin confirmación explícita, porque consume la cuenta de OpenAI. Codex
usa su herramienta integrada; Claude Code y el resto de agentes delegan en
Codex mediante `codex exec`. La política completa está en
[`rules/images.md`](rules/images.md).

## Diseño previo

Cuando una feature implique cambios de interfaz considerables, el agente
propone por iniciativa propia cerrar antes los diseños en Claude Design y no
implementa esa interfaz hasta que la persona responda. El diseño aprobado es la
referencia de la implementación y del QA. La política completa está en
[`rules/design.md`](rules/design.md).

## Cierre autónomo de una conversación

Con «Continúa hasta dar esta conversación por closed» (por ejemplo, como
objetivo de `/goal`) o con su forma abreviada `/goal Close`, el agente trabaja
sin pedir confirmación hasta cumplir el objetivo completo: valida, integra en
la rama principal, elimina el worktree y, como último paso, marca siempre la
conversación como hecha con `bin/session-done`. Resuelve las dudas por su cuenta y deja las decisiones
en el historial, pero sigue preguntando ante acciones peligrosas o
destructivas; en Claude Code lo hace con `AskUserQuestion`, antes de ejecutar
la acción y sin dejar la pregunta en texto al final del turno. La política completa está en
[`rules/closed-goal.md`](rules/closed-goal.md).

## Memoria por proyecto

Cada proyecto puede versionar conocimiento histórico auxiliar bajo `.agent/memory/`. Esta memoria se consulta de forma selectiva, no funciona como diario de actividad y nunca sustituye a `AGENTS.md`, OpenSpec, la documentación oficial ni el código. La política completa está en [`rules/memory.md`](rules/memory.md).

## Historial de iteraciones

Cada proyecto mantiene bajo `.agent/history/` resúmenes locales de las
iteraciones relevantes. No son transcripciones ni documentación oficial: sirven
para recordar qué se hizo, cómo quedó el trabajo y qué conviene hacer después.
Se ignoran en Git para evitar ruido, conflictos y la publicación accidental de
contexto conversacional. La política completa está en
[`rules/history.md`](rules/history.md).

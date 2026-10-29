# jdev-ai

[English](README.md)

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
bin/agent .                       # repositorio Git actual dentro de projects/ o el propio harness
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
principal le antepone `[Closed] `, y un hook `UserPromptSubmit`
(`bin/session-title --hook`) quita esa marca en cuanto vuelves a escribir en la
terminal. La política está en [`rules/session-title.md`](rules/session-title.md).

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

`bin/worktree` (`create`, `list`, `merge`, `remove`) también se puede usar a mano.
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

## Validación del harness

Tras modificar `bin/agent`, `bin/session-status`, `bin/subagent-notice`, `bin/session-title`, `bin/worktree` o los archivos que inyectan, ejecuta:

```sh
bin/check
```

Prueba el launcher sobre un harness temporal con agentes simulados: no lanza
agentes reales ni toca `projects/`.

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
Markdown por elemento dentro de `pending/`, `in-progress/`, `done/` o
`discarded/`. Sirve para registrar explícitamente findings, TODOs, fixes o
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
sesión como `[Closed]`. Resuelve las dudas por su cuenta y deja las decisiones
en el historial, pero sigue preguntando ante acciones peligrosas o
destructivas. La política completa está en
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

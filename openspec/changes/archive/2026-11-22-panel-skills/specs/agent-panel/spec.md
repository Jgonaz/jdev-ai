## MODIFIED Requirements

### Requirement: Pantallas de worktrees y guías del proyecto

El menú «Proyectos» de la cabecera SHALL ofrecer cuatro pantallas independientes: Backlog, Cambios, Guías y Skills, con ruta propia (`#/backlog/<proyecto>[/<elemento>]`, `#/cambios/<proyecto>[/main[/<archivo>]|/wt/<worktree>[/<archivo>]]`, `#/guias/<proyecto>[/<guía>]` y `#/skills/<proyecto>[/<skill>]`), cada una con su cabecera (monograma, nombre del proyecto y la carpeta que muestra) y una barra lateral de proyectos común que mantiene la pantalla en curso al elegir otro proyecto. Las rutas antiguas `#/proyectos…` y `#/worktrees…` SHALL redirigirse a las de cada pantalla. La pantalla Cambios SHALL mostrar, para el checkout principal del proyecto (también del propio harness) y para cada uno de sus worktrees, su rama, sus commits por delante y por detrás, si tiene cambios sin commit, las sesiones del panel que trabajan en él, con acceso a su terminal, la opción de abrir una sesión nueva ahí y sus cambios, según el requisito «Cambios del checkout principal y de los worktrees». La pantalla Guías SHALL mostrar los documentos de `docs/user-guides/` del proyecto, para leerlos con el mismo visor de Markdown. La pantalla Skills SHALL comportarse según el requisito «Pantalla Skills».

#### Scenario: Ir a la terminal de un worktree

- **WHEN** la persona elige la pestaña de un worktree en la pantalla Cambios y pulsa una de sus sesiones
- **THEN** el panel abre esa terminal en la pantalla Terminales

#### Scenario: Cambiar de proyecto sin cambiar de pantalla

- **WHEN** la persona está en Cambios de un proyecto y elige otro en la barra lateral
- **THEN** el panel muestra los Cambios del otro proyecto, con su propia cabecera, y no vuelve a Backlog

#### Scenario: Enlace antiguo

- **WHEN** la persona abre `#/proyectos/balanz.io/worktrees` o `#/worktrees/balanz.io`
- **THEN** el panel sustituye la dirección por `#/cambios/balanz.io` sin añadir una entrada al historial del navegador

#### Scenario: Enlace antiguo a un worktree

- **WHEN** la persona abre `#/worktrees/balanz.io/typescript-7`
- **THEN** el panel sustituye la dirección por `#/cambios/balanz.io/wt/typescript-7` sin añadir una entrada al historial

## ADDED Requirements

### Requirement: Pantalla Skills

La pantalla Skills SHALL listar las skills de cada proyecto, incluido el propio harness, y, en una entrada aparte de la barra lateral llamada «Usuario», las skills de usuario.

1. Las skills de un proyecto SHALL ser las subcarpetas con `SKILL.md` de `.claude/skills/`, `.agents/skills/`, `.codex/skills/`, `.github/skills/` y `.opencode/skills/` en la raíz de su checkout principal. El harness SHALL mostrar solo las suyas; si no tiene, SHALL mostrar el estado vacío.
2. Las skills de usuario SHALL ser las de `~/.claude/skills/` (incluidas las sincronizadas), `~/.agents/skills/`, `~/.codex/skills/` y las de los plugins de Claude Code instalados. Una carpeta que no exista SHALL ignorarse sin error.
3. Las copias con el mismo nombre SHALL mostrarse como una sola entrada con su descripción y las etiquetas de los agentes u orígenes que la tienen. Si el contenido de sus `SKILL.md` difiere, la entrada SHALL avisarlo y el lector SHALL permitir elegir qué copia leer.
4. Al elegir una skill, el panel SHALL mostrar su frontmatter como datos, su `SKILL.md` con el visor de Markdown saneado y los archivos de su carpeta, y la skill elegida SHALL ir en la ruta.
5. El panel SHALL ofrecer abrir la carpeta de la skill en VS Code. El servidor SHALL abrir solo carpetas de skills que él mismo ha descubierto, resueltas por proyecto, nombre y copia, nunca por una ruta enviada por el cliente, y SHALL lanzar el editor sin shell.
6. La lista SHALL dividirse en dos secciones, «Propias» y «De terceros». «De terceros» SHALL ser desplegable y empezar plegada en cada proyecto, salvo que no haya skills propias o que la skill abierta sea de terceros, en cuyo caso SHALL desplegarse. El lector SHALL indicar a cuál pertenece la skill. En un proyecto, una skill SHALL ser propia si alguna de sus copias declara en el frontmatter `metadata.author` igual al identificador del proyecto, sin distinguir mayúsculas ni separadores, y no declara `metadata.generatedBy`. De usuario, SHALL ser propia solo si el manifiesto de la sincronización con claude.ai la registra con un origen que no es de Anthropic. Una skill sin ninguna señal SHALL contarse como de terceros.
7. La barra lateral SHALL mostrar el número de skills de cada proyecto y de «Usuario».
8. El panel SHALL NOT crear, modificar ni borrar skills.

#### Scenario: Skill repetida en varios agentes

- **WHEN** un proyecto tiene `openspec-propose` en `.claude/skills/`, `.agents/skills/` y `.github/skills/` con el mismo contenido
- **THEN** la pantalla muestra una sola entrada `openspec-propose` con las etiquetas Claude, Codex y Copilot y sin aviso de diferencias

#### Scenario: Copias desincronizadas

- **WHEN** la copia de `.claude/skills/` de una skill difiere de la de `.agents/skills/`
- **THEN** la entrada avisa de que las copias difieren y el lector deja elegir cuál leer

#### Scenario: Harness sin skills propias

- **WHEN** la persona elige el harness en la pantalla Skills y este no tiene carpetas de skills
- **THEN** el panel muestra que no tiene skills, sin listar las de usuario

#### Scenario: Skills de usuario

- **WHEN** la persona elige «Usuario» en la barra lateral de Skills
- **THEN** el panel lista las skills de usuario con su origen, como si fuera otro proyecto

#### Scenario: Propias y de terceros

- **WHEN** SmashAdvisor tiene `racket-audit` con `metadata.author: smashadvisor`, las `openspec-*` con `metadata.author: openspec` y `generatedBy`, e `impeccable` sin autor
- **THEN** `racket-audit` aparece en «Propias» y las `openspec-*` e `impeccable` en «De terceros»

#### Scenario: Abrir en VS Code

- **WHEN** la persona pulsa «Abrir en VS Code» en una skill
- **THEN** se abre su carpeta en VS Code; si `code` no está disponible, el panel lo explica sin romper la pantalla

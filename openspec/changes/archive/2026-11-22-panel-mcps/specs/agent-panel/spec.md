## MODIFIED Requirements

### Requirement: Pantallas de worktrees y guías del proyecto

El menú «Proyectos» de la cabecera SHALL ofrecer cinco pantallas independientes: Backlog, Cambios, Guías, Skills y MCPs, con ruta propia (`#/backlog/<proyecto>[/<elemento>]`, `#/cambios/<proyecto>[/main[/<archivo>]|/wt/<worktree>[/<archivo>]]`, `#/guias/<proyecto>[/<guía>]`, `#/skills/<proyecto>[/<skill>]` y `#/mcps/<proyecto>[/<mcp>]`), cada una con su cabecera (monograma, nombre del proyecto y la carpeta que muestra) y una barra lateral de proyectos común que mantiene la pantalla en curso al elegir otro proyecto. Las rutas antiguas `#/proyectos…` y `#/worktrees…` SHALL redirigirse a las de cada pantalla. La pantalla Cambios SHALL mostrar, para el checkout principal del proyecto (también del propio harness) y para cada uno de sus worktrees, su rama, sus commits por delante y por detrás, si tiene cambios sin commit, las sesiones del panel que trabajan en él, con acceso a su terminal, la opción de abrir una sesión nueva ahí y sus cambios, según el requisito «Cambios del checkout principal y de los worktrees». La pantalla Guías SHALL mostrar los documentos de `docs/user-guides/` del proyecto, para leerlos con el mismo visor de Markdown. La pantalla Skills SHALL comportarse según el requisito «Pantalla Skills» y la pantalla MCPs según el requisito «Pantalla MCPs».

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

### Requirement: Pantalla MCPs

La pantalla MCPs SHALL listar los servidores MCP de cada proyecto, incluido el propio harness, y, en una entrada aparte de la barra lateral llamada «Usuario», los de usuario.

1. Los MCPs de un proyecto SHALL ser los de `.mcp.json`, los privados de ese proyecto en `~/.claude.json`, `.vscode/mcp.json`, `.codex/config.toml` y `opencode.json` u `opencode.jsonc` de la raíz de su checkout principal. En el harness SHALL incluir además los MCPs de los subagentes de `adapters/claude/agents.json`.
2. Los MCPs de usuario SHALL ser los de `~/.claude.json`, `~/.codex/config.toml`, `~/.config/opencode/opencode.json`, los de los plugins de Claude Code instalados y los conectores de claude.ai, estos solo con su nombre. Un archivo que no exista o no se pueda interpretar SHALL ignorarse sin error.
3. Los MCPs con el mismo nombre SHALL mostrarse como una sola entrada con las etiquetas de los agentes u orígenes que lo tienen. Si su configuración difiere, la entrada SHALL avisarlo.
4. La lista SHALL dividirse en «Locales» (los que ejecutan un comando en la máquina) y «Remotos» (los que se conectan a una URL y los conectores de claude.ai), sin mostrar las secciones vacías.
5. Al elegir un MCP, el panel SHALL mostrar, para cada copia, el archivo donde está definido, el transporte, el comando con sus argumentos o la URL, y los nombres de sus variables de entorno y cabeceras. El MCP elegido SHALL ir en la ruta.
6. Los valores de las variables de entorno y de las cabeceras, los de la query y las credenciales de la URL, y los argumentos que siguen a opciones con nombre de secreto SHALL NOT enviarse al navegador.
7. El panel SHALL ofrecer abrir en VS Code el archivo donde está definido el MCP, resuelto por el servidor a partir del proyecto, el nombre y la copia, nunca de una ruta enviada por el cliente, y sin shell.
8. La barra lateral SHALL mostrar el número de MCPs de cada proyecto y de «Usuario».
9. El panel SHALL NOT añadir, modificar, activar ni borrar MCPs.

#### Scenario: MCP configurado en varios agentes

- **WHEN** `vercel` está en el `.mcp.json` del plugin de Claude y en `~/.codex/config.toml` con la misma URL
- **THEN** «Usuario» muestra una sola entrada `vercel` en «Remotos», con las etiquetas «plugin vercel» y «Codex» y sin aviso de diferencias

#### Scenario: Secretos

- **WHEN** un MCP define `env: { GITHUB_TOKEN: "ghp_xxx" }` y la URL `https://x.dev/mcp?key=abc`
- **THEN** el detalle muestra `GITHUB_TOKEN` y `https://x.dev/mcp?key=•••`, y ninguna respuesta del servidor contiene `ghp_xxx` ni `abc`

#### Scenario: Proyecto sin MCPs

- **WHEN** la persona elige un proyecto sin archivos de configuración de MCP
- **THEN** el panel muestra que no tiene MCPs

#### Scenario: Conector de claude.ai

- **WHEN** la persona abre un conector de claude.ai en «Usuario»
- **THEN** ve su nombre y su origen, sin configuración ni botón «Abrir en VS Code»

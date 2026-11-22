## Why

Los servidores MCP que puede usar un agente están repartidos en archivos de configuración distintos para cada agente (`.mcp.json`, `~/.claude.json`, `~/.codex/config.toml`, `.vscode/mcp.json`, `opencode.json`), en los plugins y en los conectores de claude.ai. No hay forma de ver de un vistazo qué MCPs tiene un proyecto o el usuario, qué ejecuta cada uno en la máquina, a qué se conecta ni si cada agente lo tiene configurado igual. Es la segunda pantalla de inventario del panel, tras Skills, y sigue su mismo patrón.

## What Changes

- **Pantalla MCPs** en el menú «Proyectos», junto a Backlog, Cambios, Guías y Skills, con ruta `#/mcps/<proyecto>[/<mcp>]`, la barra lateral de proyectos común con el recuento de MCPs y la entrada «Usuario» (`~usuario`) al final, como en Skills.
- **MCPs del proyecto** (también del harness): `.mcp.json` (Claude), los privados del proyecto en `~/.claude.json` (Claude, «local»), `.vscode/mcp.json` (Copilot), `.codex/config.toml` (Codex) y `opencode.json`/`opencode.jsonc` (OpenCode), en la raíz del checkout principal. En el harness, además, los MCPs de los subagentes de `adapters/claude/agents.json` (hoy, Playwright del `qa`).
- **MCPs de usuario:** `~/.claude.json` (Claude), `~/.codex/config.toml` (Codex), `~/.config/opencode/opencode.json` (OpenCode), el `.mcp.json` de cada plugin de Claude Code instalado (origen «plugin <nombre>») y los conectores de claude.ai (solo su nombre: su configuración no está en disco).
- **Una entrada por nombre**, con etiquetas de los agentes u orígenes que lo tienen y aviso si su configuración difiere entre ellos.
- **Dos secciones:** «Locales» (un comando que se ejecuta en la máquina, stdio) y «Remotos» (una URL, http o sse, y los conectores de claude.ai).
- **Detalle:** para cada copia, el archivo donde está definida, el transporte, el comando con sus argumentos o la URL, y los **nombres** de las variables de entorno y de las cabeceras. Los valores de `env` y de las cabeceras **no salen nunca del servidor del panel**; tampoco los valores de la query de la URL ni los argumentos que parecen secretos.
- **Abrir en VS Code:** abre el archivo de configuración donde está definido el MCP (no para los conectores de claude.ai). Solo archivos que el panel ha listado.
- Solo lectura: no se añaden, editan, activan ni borran MCPs desde el panel.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: el menú «Proyectos» gana la pantalla MCPs.

## Impact

- **Servidor del panel:** nuevo `server/mcps.ts` (descubrimiento, normalización, ocultación de secretos, agrupación) y rutas `GET /api/projects/:id/mcps`, `GET /api/user-mcps` y `POST …/mcps/open`.
- **Cliente:** ruta y pantalla `mcps`, opción del menú, reutilizando la barra lateral con «Usuario», la lista y el lector de Skills.
- **Sin dependencias nuevas:** el `config.toml` de Codex se lee con un lector mínimo, limitado a las tablas `[mcp_servers.*]` (ver diseño).
- **Riesgos:** los formatos son internos de cada agente y cambian; lo que no se entienda se ignora sin romper la pantalla. `~/.claude.json` contiene mucho más que MCPs y puede tener secretos: solo se leen sus `mcpServers` y nunca se envían valores al navegador.

## Contexto

La pantalla Skills (`server/skills.ts`, `SkillsScreen`, `Skills.tsx`) resuelve casi lo mismo: inventario por proyecto y de usuario, agrupado por nombre, con copias por agente, aviso de diferencias y «Abrir en VS Code». MCPs reutiliza su estructura: la ruta, la entrada `~usuario`, la barra lateral con `extra`, la lista con secciones y el lector.

## Decisiones

### Fuentes

Tabla única en `server/mcps.ts`:

| Ámbito | Archivo | Agente | Clave |
|---|---|---|---|
| Proyecto | `.mcp.json` | Claude | `mcpServers` |
| Proyecto | `~/.claude.json` → `projects[<ruta del proyecto>].mcpServers` | Claude («local») | — |
| Proyecto | `.vscode/mcp.json` | Copilot | `servers` |
| Proyecto | `.codex/config.toml` | Codex | `[mcp_servers.<nombre>]` |
| Proyecto | `opencode.json`, `opencode.jsonc` | OpenCode | `mcp` |
| Harness | `adapters/claude/agents.json` | Claude («subagente <nombre>») | `mcpServers` de cada agente |
| Usuario | `~/.claude.json` | Claude | `mcpServers` |
| Usuario | `~/.codex/config.toml` | Codex | `[mcp_servers.<nombre>]` |
| Usuario | `~/.config/opencode/opencode.json` | OpenCode | `mcp` |
| Usuario | `<installPath>/.mcp.json` de cada plugin | Claude («plugin <nombre>») | `mcpServers` |
| Usuario | `~/.claude.json` → `claudeAiMcpEverConnected` | claude.ai | lista de nombres |

Los archivos se abren como en Skills (archivo regular, sin enlaces simbólicos, con límite de tamaño). Lo que falte o no se pueda interpretar se ignora. En `~/.claude.json` la ruta del proyecto se compara con la ruta absoluta del checkout principal.

Los conectores de claude.ai salen de `claudeAiMcpEverConnected`, que lista los que se han conectado alguna vez: puede incluir alguno desconectado después. Se muestran solo con su nombre (sin «claude.ai » delante) y el origen «claude.ai».

### Normalización

Cada formato se convierte a `{ transport: 'stdio' | 'http' | 'sse' | 'connector', command?, args[], url?, envNames[], headerNames[], extra }`:

- Claude y Copilot: `type` (o `stdio` si hay `command`, `http` si hay `url`), `command`, `args`, `url`, `env`, `headers`.
- OpenCode: `type: local` con `command` como lista (el primero es el comando) y `environment`; `type: remote` con `url` y `headers`.
- Codex: `command`, `args`, `env`, `url`, `http_headers`/`env_http_headers`.
- `extra`: el resto de campos escalares (p. ej. `note`, `enabled`, `timeout`), para enseñarlos como datos.

### Secretos

Al navegador solo llega lo normalizado:

- De `env`, `environment` y las cabeceras, solo los nombres.
- La URL sin los valores de su query (`?token=•••`) ni credenciales (`user:pass@`).
- Los argumentos que siguen a una opción cuyo nombre contiene `token`, `key`, `secret`, `password` o `auth` (`--api-key xxx`, `--token=xxx`) se sustituyen por `•••`.
- En `extra`, los campos con esos nombres se omiten.

La comparación de copias se hace sobre lo normalizado y oculto, así que dos copias que solo difieren en el valor de un secreto se consideran iguales. Es aceptable: lo que interesa es si ejecutan lo mismo.

### Agrupación y secciones

Por nombre, como en Skills, con la copia por defecto en el orden de la tabla. La sección la decide la copia por defecto: «Locales» si es `stdio`; «Remotos» si es `http`, `sse` o un conector. Las secciones vacías no se muestran.

### Lector de Codex (`config.toml`)

Para no añadir una dependencia, un lector mínimo que solo entiende lo que usan los MCPs: cabeceras `[mcp_servers.<nombre>]` y `[mcp_servers.<nombre>.env]` (nombre con o sin comillas), y pares `clave = valor` con cadenas (básicas y literales), números, booleanos, listas de cadenas y tablas en línea de cadenas. Ignora el resto del archivo. Si una línea dentro de una tabla de MCP no se entiende, ese MCP se marca como «no se pudo leer entero» en lugar de inventar datos. Si más adelante hiciera falta TOML completo, se valoraría añadir `smol-toml`.

### Rutas y apertura

- `#/mcps/<proyecto>[/<nombre>]`, con `~usuario` reservado como en Skills.
- El detalle no necesita una petición aparte: la lista ya trae lo normalizado, que es pequeño.
- `POST …/mcps/open` con nombre y copia: el servidor redescubre, resuelve el archivo y lanza `code <archivo>` con el mismo lanzador que Skills. Los conectores no tienen archivo: 400.

## Alternativas descartadas

- **Enviar la configuración tal cual y ocultarla en el cliente:** los secretos viajarían al navegador.
- **Añadir `smol-toml`:** más robusto, pero es una dependencia para leer unas pocas tablas; se deja como plan B.
- **Propios / De terceros:** no hay una señal de autoría en la configuración de un MCP.

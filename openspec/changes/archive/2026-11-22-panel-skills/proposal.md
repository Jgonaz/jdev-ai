## Why

Cada proyecto acumula skills en varias carpetas (`.claude/skills/`, `.agents/skills/`, `.github/skills/`, `.opencode/skills/`), casi siempre duplicadas para cada agente, y además hay skills de usuario instaladas fuera de los proyectos (`~/.claude/skills/`, `~/.codex/skills/`, plugins). Hoy no hay forma de ver de un vistazo qué skills tiene un proyecto, qué hace cada una, para qué agentes está disponible ni si sus copias se han desincronizado. Es la primera de varias pantallas de «inventario» del panel; la siguiente será la de MCPs y seguirá el mismo patrón.

## What Changes

- **Pantalla Skills** en el menú «Proyectos», junto a Backlog, Cambios y Guías, con ruta `#/skills/<proyecto>[/<skill>]`, la barra lateral de proyectos común y el recuento de skills de cada uno.
- **Skills del proyecto:** las de las carpetas de agente de la raíz del checkout principal. Una entrada por nombre de skill, con su descripción (frontmatter de `SKILL.md`) y etiquetas de los agentes que la tienen (Claude, Codex, Copilot, OpenCode). Si las copias de una misma skill difieren, se avisa.
- **El propio harness** se trata como un proyecto más: muestra solo sus skills propias. Hoy no tiene ninguna, así que muestra el estado vacío.
- **Skills de usuario:** una entrada aparte en la barra lateral («Usuario»), como si fuera otro proyecto, con las skills instaladas para todos los proyectos: `~/.claude/skills/` (incluidas las sincronizadas desde claude.ai), `~/.agents/skills/`, `~/.codex/skills/` y las de los plugins de Claude Code instalados. Mismo criterio de una entrada por nombre, con su origen.
- **Lector:** al elegir una skill se lee su `SKILL.md` con el visor de Markdown del panel (sin el frontmatter, que se muestra como datos), con la lista de archivos que la acompañan.
- **Abrir en el editor:** un botón abre la carpeta de la skill en VS Code (`code`). Solo se pueden abrir carpetas de skills que el propio panel ha listado.
- Solo lectura: no se crean, editan ni borran skills desde el panel.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: el menú «Proyectos» gana la pantalla Skills, con las skills de cada proyecto y las de usuario.

## Impact

- **Servidor del panel:** nuevo módulo `server/skills.ts` (descubrimiento, frontmatter, agrupación por nombre, comparación de copias, lectura segura) y rutas `GET /api/projects/:id/skills`, `GET /api/projects/:id/skills/content`, `GET /api/user-skills[/content]` y `POST …/skills/open`.
- **Cliente:** ruta y pantalla `skills`, opción del menú «Proyectos», entrada «Usuario» en la barra lateral solo en esta pantalla, vista de lista y lector reutilizando el patrón de Guías.
- Sin dependencias nuevas (el frontmatter se lee con `yaml`, que ya está).
- **Riesgos:** las rutas de skills de usuario y de plugins son convenciones de cada agente y pueden cambiar; si una carpeta no existe se ignora sin error. «Abrir en el editor» lanza un proceso local: se limita a rutas listadas por el servidor y sin shell.

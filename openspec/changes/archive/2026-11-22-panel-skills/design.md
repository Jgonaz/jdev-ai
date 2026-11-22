## Contexto

Las pantallas de proyecto (Backlog, Cambios, Guías) comparten `ProjectSidebar`, `useProjectScreen` y una ruta `#/<pantalla>/<proyecto>[/<elemento>]`. Guías ya resuelve «lista de documentos Markdown + lector» con lectura segura en `server/guides.ts`; Skills sigue ese patrón.

## Decisiones

### Descubrimiento

- **Proyecto** (también el harness): solo la raíz del checkout principal, sin recorrer subcarpetas como `tmp/` ni worktrees. Carpetas y agente:

  | Carpeta | Agente |
  |---|---|
  | `.claude/skills/` | Claude |
  | `.agents/skills/` | Codex |
  | `.codex/skills/` | Codex |
  | `.github/skills/` | Copilot |
  | `.opencode/skills/` | OpenCode |

  Una skill es una subcarpeta directa con `SKILL.md`.
- **Usuario:** `~/.claude/skills/` (Claude; recorrido hasta 3 niveles porque las sincronizadas viven en `synced/<bucket>/<nombre>/`), `~/.agents/skills/` y `~/.codex/skills/` (Codex, incluida `.system/`) y, para cada plugin de `~/.claude/plugins/installed_plugins.json`, `<installPath>/skills/` (origen «plugin <nombre>»).
- No se siguen enlaces simbólicos al recorrer; límites de tamaño y número como en Guías.

### Agrupación por nombre

El nombre es el `name` del frontmatter o, si falta, el de la carpeta. Las copias con el mismo nombre forman una entrada con la lista de copias (agente/origen y ruta). Se comparan por hash del contenido de `SKILL.md`; si hay más de un hash, la entrada lleva `diverges: true` y el lector deja elegir qué copia leer. La copia por defecto es la de `.claude/` (o la primera por orden de la tabla).

### Propias y de terceros

No hay un campo estándar de autoría, así que se usan las señales que ya existen:

- **Proyecto:** propia si `metadata.author` coincide con el identificador del proyecto (normalizado: minúsculas y sin separadores) y no hay `metadata.generatedBy`. Las de OpenSpec declaran `author: openspec` y `generatedBy`; las nuestras, el nombre del proyecto. La convención queda escrita en el `AGENTS.md` del harness.
- **Usuario:** las sincronizadas de claude.ai se clasifican por el `source` de `synced/<bucket>/manifest.json` (`anthropic*` es de Anthropic; el resto, de la cuenta). Plugins, Codex y el resto del home cuentan como de terceros.
- Lo que no da señal (p. ej. `impeccable`) es de terceros. Basta una copia propia para que la skill lo sea.
- Si el frontmatter no es YAML estricto (una descripción con «: » sin comillas, que los agentes aceptan), se lee con un analizador tolerante de `clave: valor` para no perder el autor.

### Identificadores y rutas

- El elemento de la ruta es el nombre de la skill: `#/skills/<proyecto>/<nombre>`.
- La entrada de usuario usa el identificador reservado `~usuario` (`#/skills/~usuario[/<nombre>]`). Los identificadores de proyecto son nombres de carpeta, así que en teoría podría chocar; una carpeta que empiece por `~` es lo bastante rara como para aceptarlo y, si existiera, en Skills ganaría la entrada de usuario. Solo aparece en la barra lateral de Skills, al final y separada de los proyectos.
- El contenido se pide por copia (`?skill=<nombre>&copy=<índice>`), nunca por ruta: el servidor vuelve a descubrir y resuelve la ruta él mismo, así que no hay ruta controlada por el cliente.

### Abrir en el editor

`POST …/skills/open` con nombre y copia; el servidor resuelve la carpeta igual que el contenido y lanza `code <carpeta>` con `execFile` (sin shell), desacoplado. Si `code` no existe responde 501 con un mensaje claro. Se elige VS Code porque es el editor instalado y el panel corre en WSL, donde `code` abre la ventana de Windows con la extensión remota; si más adelante hace falta otro, se añadiría un ajuste.

### Lector

Frontmatter separado del cuerpo: `name`, `description` y otros campos se muestran como cabecera; el cuerpo con el visor `Markdown`. Debajo, los archivos de la carpeta (solo nombres, un nivel más), sin leerlos.

## Alternativas descartadas

- **Mostrar cada carpeta por separado:** repetiría la misma skill hasta cuatro veces por proyecto.
- **Pedir el contenido por ruta, como Guías:** obligaría a validar rutas fuera del proyecto (las de usuario viven en `~`); resolver por nombre y copia evita exponer lecturas arbitrarias.

## Riesgos

- Convenciones de carpetas de cada agente cambiantes: la tabla vive en un solo sitio de `server/skills.ts`.
- `installed_plugins.json` tiene formato interno de Claude Code: si no se puede leer, se ignoran los plugins sin romper la pantalla.

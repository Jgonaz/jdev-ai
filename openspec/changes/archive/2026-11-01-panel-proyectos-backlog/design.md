## Context

- Panel en producción (spec `agent-panel`): servidor Node 24 en `panel/server` con token, `Host` y `Origin`; cliente React con pantallas Terminales y Ajustes; `projects.ts` ya lista proyectos y worktrees.
- Formato del backlog en `rules/backlog.md`: cabecera YAML (`id`, `title`, `type`, `status`, `priority`, `created`, `updated`, `refs` opcional y claves extra), `# Título`, `## Resumen` y detalle; carpetas `backlog`, `todo`, `in-progress`, `done` y `discarded`. La carpeta manda sobre `status`.
- Diseño aprobado: artboard `Proyecto.dc.html` del lienzo (columnas, detalle con resumen y cabecera, «Pasar a por hacer», «Trabajar en esto», estado vacío con ASCII, pestañas Backlog, Worktrees y Guías).

## Goals / Non-Goals

**Goals:**

- Revisar y priorizar el backlog de todos los proyectos desde el panel.
- Mover estados con seguridad, sin pisar cambios ni hacer commits.
- Arrancar trabajo sobre un elemento con un clic.

**Non-Goals:**

- Crear o editar elementos (contenido, cabecera, resumen) desde el panel.
- Commits o pushes fuera de «Confirmar cambios» del backlog.
- Backlogs de las ramas de worktree: solo se lee el checkout principal.
- Inicio e Historial.

## Decisions

### Lectura del backlog (`server/backlog.ts`)

- Recorre `docs/backlog/<estado>/*.md` del checkout principal. El estado sale siempre de la carpeta.
- Separa la cabecera entre `---` y la analiza con `yaml` en modo seguro (sin etiquetas personalizadas). Un YAML inválido se trata como formato antiguo con aviso.
- Formato antiguo: sin cabecera, el título sale del primer `# `, y los metadatos de la lista antigua (`- ID:`, `- Tipo:`…) se leen si existen solo para mostrarlos.
- Del cuerpo se extraen el título, el `## Resumen` (primer párrafo) y el resto. El tiempo de lectura se estima a 200 palabras por minuto, redondeado a 10 s.
- Cada elemento lleva un `etag` (carpeta de estado, mtime y tamaño) para el control de concurrencia. La carpeta forma parte del `etag` porque un `git mv` externo conserva mtime y tamaño.
- Caché por mtime y vigilancia con `fs.watch` de las carpetas de estado (más relectura de respaldo cada 10 s). Los cambios se emiten por `/ws/events` como `{type:'backlog', project}`.
- Endpoints:
  - `GET /api/projects/:id/backlog`: lista con los campos de las tarjetas, resumen y avisos (formato antiguo, `status` distinto de la carpeta).
  - `GET /api/projects/:id/backlog/:itemId`: documento completo, fuente y `etag`.

### Cambio de estado

`POST /api/projects/:id/backlog/:itemId/move` con `{to, etag}`:

1. Valida que el identificador cumpla el patrón `BL-…` y que el archivo esté en la carpeta de su estado actual. Valida que la transición esté permitida:
   - `backlog → todo`, `backlog|todo → in-progress`, cualquier estado abierto `→ done|discarded`;
   - para deshacer errores también `todo → backlog`, `in-progress → todo|backlog` y de `done`/`discarded` de vuelta a un estado abierto, siempre por acción explícita de la persona. `done ↔ discarded` no se permite.
2. Compara el `etag` antes que la transición; si no coincide, responde 409 con la versión actual (así un detalle obsoleto tras un movimiento externo no da 400 ni mueve desde otra carpeta).
3. Rechaza los elementos con formato antiguo (422, con explicación).
4. Edita en el texto de la cabecera solo las líneas `status:` y `updated:` (añadiendo `updated` si falta), sin reserializar el YAML, para conservar comentarios, comillas y orden.
5. Mueve el archivo con `git mv` (sin shell, `execFile`) si está en seguimiento; si no, con `rename`. Después escribe la cabecera editada de forma atómica en el destino y, si estaba en seguimiento, hace `git add -- <destino>` para que el índice tenga el renombrado con el contenido editado (`R `, no `RM`); lo que no estaba en seguimiento no se añade. Si el destino existe, 409.
6. Devuelve el elemento actualizado.

Los cambios sin commit se cuentan con `git status --porcelain -- docs/backlog` y se muestran en la cabecera del proyecto con el texto «N cambios del backlog sin commit».

### Confirmar cambios del backlog

- `GET /api/projects/:id/backlog/commit-preview` → `{branch, detached, remote, upstream, files:[{status, path, from?}], message, fingerprint}`. Los archivos salen de `git status --porcelain -- docs/backlog` (`status`: `moved`, `modified`, `added` o `deleted`; un borrado y un añadido con el mismo nombre de archivo cuentan como movimiento); la rama de seguimiento, de `git rev-parse --abbrev-ref @{u}`, y sin ella el remoto es `remote.pushDefault`, `origin` o el único que haya. `fingerprint` resume la lista: si el `POST` la envía y ya no coincide, responde 409 para que el mensaje no describa otros archivos.
- Mensaje propuesto: `docs(backlog): <resumen>`, con el resumen según los movimientos (por ejemplo, «pasa 2 elementos a por hacer») y un punto por archivo con qué cambió, según las normas de commit del harness. Sin líneas de coautoría: el commit lo hace la persona desde el panel.
- `POST /api/projects/:id/backlog/commit` con `{message, push}`:
  1. `git add -A -- docs/backlog`;
  2. `git commit -F <archivo temporal> -- docs/backlog`. La ruta limita el commit al backlog aunque haya otros cambios en el índice, que quedan como estaban;
  3. si `push`, `git push` (o `git push -u <remote> <rama>` si no tiene rama de seguimiento; sin remoto, 409 antes del commit).
- Todo con `execFile`, sin shell y sin `--no-verify`. Los procesos de git van en serie por proyecto con los movimientos, con un tiempo máximo amplio (10 min) por los pre-push largos, y el progreso se informa por `/ws/events` (`{type:'backlog-commit', project, phase}`).
- Respuesta `{commit, pushed, output}`. Si falla el commit, 422 con la salida y sin commit. Si falla el push, 207 con el commit hecho y la salida del push.
- Requiere `Origin` válido y está prohibido en una rama separada (`HEAD` detached) o sin cambios (409). Los procesos van sin terminal de control (`GIT_TERMINAL_PROMPT=0`, sesión propia), así que unas credenciales que falten hacen fallar el push en lugar de colgarlo.

### Guías y worktrees

- `GET /api/projects/:id/guides` lista `docs/user-guides/**/*.md` con título y fecha. `GET /api/projects/:id/guides/content?path=<ruta>` devuelve el contenido, validando que la ruta real quede dentro de esa carpeta.
- Worktrees: amplía `projects.ts` con rama, `ahead`/`behind` respecto a la rama principal (`git rev-list --left-right --count`), si tienen cambios sin commit y las sesiones del panel con ese worktree.

### Cliente

- Ruta `#/proyectos/<id>` con la navegación habilitada.
- Componentes según `Proyecto.dc.html`: lista de proyectos, pestañas, columnas, tarjeta, detalle, estado vacío con ASCII si está activado.
- **Markdown:** se analiza con `marked.lexer` y se pintan los tokens como elementos de React (títulos, párrafos, listas, código, citas, enlaces, negrita, cursiva, tablas sencillas). Los tokens `html` se muestran como texto, nunca con `dangerouslySetInnerHTML`. Los enlaces externos abren en una pestaña nueva con `rel="noopener"`, y las rutas de imagen reutilizan el visor.
- «Trabajar en esto» abre `NewSessionDialog` con el proyecto y el prompt «Aborda el elemento del backlog `<id>` (`docs/backlog/<estado>/<archivo>`): <título>». No mueve nada.
- Las columnas hecho y descartado van plegadas con su contador, y se despliegan al pulsarlas.
- Sin edición del contenido: «Abrir en el editor» se omite, porque abrir un editor de Windows desde WSL no es fiable.

## Risks / Trade-offs

- **Escritura en repositorios de proyectos** → solo dos campos y un movimiento, con `etag`, `git mv` y sin commit. El aviso de cambios pendientes recuerda que hay que hacer commit.
- **Choque con un agente que edita el mismo archivo** → el `etag` lo detecta y la operación se rechaza.
- **Dependencias nuevas** (`yaml`, `marked`) → ambas sin dependencias propias y muy usadas. Sustituirlas por analizadores a mano sería más frágil.
- **Elementos en ramas de worktree** → no se ven hasta que se integran en la rama principal. Se indica en la pestaña Worktrees.
- **Elementos sin migrar** → se ven, pero no se pueden mover desde el panel.

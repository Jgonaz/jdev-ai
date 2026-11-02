## Context

- La barra lateral (`components/terminales/Sidebar.tsx`) agrupa por proyecto:
  - las sesiones del panel (vivas o terminadas);
  - «Anteriores (N)», que son conversaciones recientes de Claude que se pueden retomar (`GET /api/recent`);
  - abajo, «En segundo plano (N)» (`LiveSessions.tsx`).
- El menú contextual de sesiones existe (`ContextMenu.tsx`, `useSessionActions.tsx`, `SessionMenu.tsx`).
- `panel-statusline` aporta `usage` y `activity` en cada sesión y la vista de la cabecera (`lib/statusline.ts`).
- Las pantallas de proyecto eligen proyecto con `pickProject(ids, pedido, ultimo)` (`lib/backlog.ts`, `lib/useProjectScreen.ts`).

## Goals / Non-Goals

**Goals:**

- Ver el título completo y el estado de una conversación sin abrirla.
- Apartar sesiones y conversaciones sin terminarlas y recuperarlas cuando haga falta.
- Empezar Worktrees por un proyecto con worktrees abiertos.

**Non-Goals:**

- Archivar desde otras pantallas (Inicio, Historial) o en bloque.
- Borrar transcripts o sesiones al archivar.
- Cambiar el proyecto por defecto de Backlog o Guías.

## Decisions

### Tooltip

- Componente propio con `role="tooltip"` y `aria-describedby` en la fila. Se abre tras 400 ms de ratón encima o al recibir el foco, y se cierra al salir, al perder el foco o con Esc.
- Se coloca a la derecha de la barra lateral, ajustado a la ventana con la misma lógica que el menú contextual (`lib/menuPosition.ts`).
- Muestra:
  - el título completo;
  - el proyecto, la rama o el worktree, y el agente;
  - en las sesiones vivas con datos: modelo y esfuerzo, la barra de contexto con los umbrales de `panel-statusline`, el tiempo, los contadores de subagentes, shells y artifacts, y la antigüedad del dato si está desactualizado;
  - en «Anteriores»: la última actividad.
- No se abre mientras hay un menú contextual abierto ni durante un arrastre del tirador de ancho.

### Archivado: datos

- Archivo `archived.json` en el directorio de configuración del panel, con escritura atómica:
  - `sessions`: `[{name, created}]`. El nombre de tmux se reutiliza, así que la clave lleva también `@jdev_created`.
  - `conversations`: `[id]`, con los id de sesión de Claude de «Anteriores».
- API:
  - `PUT /api/archive` con `{kind: "session" | "conversation", id, archived: boolean}`. `id` es el nombre de la sesión de tmux o el id de la conversación, validados con los mismos patrones que ya usa el servidor.
  - Responde con la lista actual.
  - Errores: 400 con datos no válidos, 404 si la sesión no existe al archivar y 403/405 como el resto de rutas.
- Las sesiones y las conversaciones recientes llevan un campo `archived: boolean`. Los cambios se difunden por `/ws/events` como el resto de cambios de sesiones.
- Limpieza:
  - Una sesión archivada que desaparece de tmux sale de la lista.
  - Una conversación archivada que deja de estar en recientes se conserva (es un id pequeño) hasta que se desarchiva. La lista se limita a 500 entradas, quitando las más antiguas.
  - Retomar una conversación archivada (`POST /api/sessions` con `resume`) la desarchiva al crear la sesión, y se avisa por `/ws/events`.
- Cuota de «Anteriores»: las conversaciones archivadas se excluyen antes de aplicar el límite de 15 por proyecto, así que archivar deja aparecer las siguientes. Se listan aparte para «Archivadas», con su propio máximo de 15 por proyecto, y solo dentro de la ventana de 30 días: una archivada más antigua sigue en `archived.json`, pero no se ve.

### Archivado: interfaz

- «Archivar» y «Desarchivar» en el menú contextual (barra, pestañas y «Anteriores»).
- **Al archivar:**
  - la fila sale de su proyecto, de «Anteriores» y de «En segundo plano»;
  - si la sesión tenía pestaña, la pestaña sigue abierta (archivar no cierra nada).
- **Sección «Archivadas (N)»:** debajo de «En segundo plano» y encima de la leyenda. Es plegable, recuerda si está plegada (`jdev-panel:archived-collapsed`) y se oculta si está vacía. Dentro:
  - las sesiones con su estado (te espera, trabajando, en reposo o terminada) y su proyecto; al pulsarlas se abren;
  - las conversaciones con «Retomar».
- **Avisos:** una sesión archivada que espera sigue contando en la cabecera, en el título de la pestaña y en Inicio, con la misma regla que las sesiones de proyectos ocultos. En la barra lateral aparece en «Archivadas» con su luz de estado.
- **Inicio:** las sesiones archivadas no cuentan en los recuentos «trabajando» y «en reposo», ni en el resumen, los chips, las tarjetas de proyecto ni su actividad, salvo las que esperan a la persona, que siguen contando. Las archivadas marcadas como cerradas no salen en «Necesita tu atención».

### Worktrees por defecto

- Nueva función pura `pickWorktreesProject(ids, pedido, conWorktrees)`: el pedido si es visible; si no, el primero visible con worktrees; si no, el primero.
- Worktrees la usa en lugar de `pickProject`. Backlog y Guías siguen con `pickProject` y el último usado.
- El proyecto que Worktrees escoge solo por defecto no se guarda como «último proyecto usado» (tampoco cuando la pantalla lo pone luego en la URL): solo se guarda el que la persona elige, con un proyecto en la ruta o con un clic en la lista. Así, `#/backlog/ccc` → `#/worktrees` (abre bbb) → `#/backlog` sigue mostrando ccc.
- Los worktrees de cada proyecto ya vienen en la lista de proyectos (`ProjectInfo.worktrees`, la misma que usa la pantalla), así que el proyecto se decide al cargar los proyectos, sin corregir después.
- En el menú Proyectos, «Worktrees» enlaza sin proyecto (`#/worktrees`), salvo si ya estás en Worktrees, donde conserva el proyecto actual. Backlog y Guías siguen enlazando al último usado.

## Risks / Trade-offs

- **[Una sesión archivada que espera pasa desapercibida]** → Sigue contando en la cabecera, en el título y en Inicio, y se ve en «Archivadas» con su luz.
- **[Worktrees abre un proyecto distinto del último usado]** → Es lo pedido. Con un proyecto en la ruta (enlace directo o ya en Worktrees) no cambia nada.
- **[El nombre de tmux se reutiliza]** → La clave incluye la fecha de creación.

## Migration Plan

Sin datos previos: el archivo se crea al archivar por primera vez.

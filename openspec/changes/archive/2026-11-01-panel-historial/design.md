## Context

- Formato de las entradas en `rules/history.md`: `# Título`, `Fecha: YYYY-MM-DD HH:MM`, `Estado: finalizada | en curso | bloqueada` y secciones `## Resumen`, `## Decisiones`, `## Referencias`, `## Pendiente de ti` y `## Continuación recomendada`. Hay 167 entradas en la máquina, 80 con «Pendiente de ti», y algunas antiguas con `Fecha` o `Estado` fuera de formato (SmashAdvisor archivó las suyas en `.agent/history/archive/`, que no se lee).
- `bin/session-status` lee los puntos con `section_points`: líneas `- ` y sus continuaciones sangradas.
- Panel: visor de Markdown seguro, `etag` y vigilancia ya resueltos en Proyectos; Nueva sesión acepta valores iniciales.
- Diseño aprobado: `Registro.dc.html` (lista con filtros y casilla «Solo con Pendiente de ti», lector con el bloque ámbar «Pendiente de ti», secciones, «Retomar desde aquí»).

## Goals / Non-Goals

**Goals:**

- Ver de un vistazo qué espera de la persona en todos los proyectos.
- Leer cualquier entrada sin abrir carpetas.
- Cerrar pendientes y que el resumen de inicio lo refleje.

**Non-Goals:**

- Editar el resto de la entrada o crear entradas desde el panel.
- «Ir a la sesión original»: las entradas no guardan el identificador de la sesión. Queda fuera, aunque el diseño lo muestra.
- Historial de los worktrees: según `rules/history.md`, se escribe en el checkout principal.
- Leer `.agent/history/archive/`.

## Decisions

### Lectura (`server/history.ts`)

- Recorre `<checkout>/.agent/history/*.md` de cada proyecto y del harness, sin seguir enlaces simbólicos y con un límite de 1 MB por archivo. Si `.agent` o `.agent/history` son enlaces cuya ruta real queda fuera del proyecto, ese historial se ignora: no se lista y el detalle y la marca responden 403.
- Un BOM inicial se ignora al analizar y se conserva al escribir. Solo se marcan pendientes en archivos UTF-8 válidos; si no, 422 sin tocar el archivo.
- Extrae:
  - **Título:** el primer `# `.
  - **Fecha:** de `Fecha:` si cumple el formato; si no, del nombre `YYYY-MM-DD-HHMM`; si tampoco, del mtime. Se marca si es aproximada.
  - **Estado:** de `Estado:` por prefijo y sin distinguir mayúsculas, para admitir detalles tras el valor («finalizada (sin commit)»): `en curso…`, `bloqueada…` y, como `finalizada`, `finalizada…` y los sinónimos `terminada…`, `cerrad…`, `completad…` y `completo`. Cualquier otro valor es `desconocido`.
  - **Secciones:** por `## `.
  - **Pendientes:** de «Pendiente de ti», con el mismo criterio que `section_points`: punto `- ` y continuaciones sangradas. Cada pendiente lleva su texto, su índice y si está hecho (`[x] ` al principio y el sufijo `(hecho …)`).
- `etag` = mtime y tamaño. Caché por mtime y vigilancia con `fs.watch` de cada carpeta, más relectura de respaldo cada 15 s, con el evento `{type:'history', project}`.
- Endpoints:
  - `GET /api/history?project=&state=&pending=1` → `{entries:[{project, file, title, date, approxDate, state, firstPending, openPending, totalPending, etag}]}`.
  - `GET /api/history/:project/:file` → la entrada completa con secciones (Markdown), pendientes y `etag`.
  - El nombre de archivo se valida con un patrón (`.md`, sin `/` ni `..`) y la ruta real debe quedar dentro de la carpeta de historial.

### Marcar pendientes

- `POST /api/history/:project/:file/pending` con `{index, done, etag}`. Valida el `etag` (409 con la entrada actual) y que el índice exista.
- Edita solo la primera línea del punto:
  - **Al marcar:** `- texto` pasa a `- [x] texto (hecho YYYY-MM-DD)`. El sufijo va al final de la última línea del punto.
  - **Al desmarcar:** quita `[x] ` y el sufijo `(hecho …)`.
- Escritura atómica, conservando permisos y saltos de línea. Las entradas no están en Git, así que no hay `git add`.

### `bin/session-status` y regla

- `section_points` sigue igual y el bloque de «Pendiente de ti» filtra los puntos que empiezan por `[x] `. Si no queda ninguno, el apartado no se muestra.
- `rules/history.md` añade en «Formato» que un pendiente resuelto se marca `- [x] … (hecho YYYY-MM-DD)`, que lo puede hacer el panel o el agente cuando la persona lo confirme, y que al actualizar una entrada se conservan las marcas.
- `bin/check` prueba que los puntos marcados no aparecen y que el apartado desaparece si todos lo están.

### Cliente

- Ruta `#/historial` y `#/historial/<proyecto>/<archivo>`, con la navegación habilitada (Inicio sigue «Próximamente»).
- Componentes según `Registro.dc.html`:
  - columna de lista de 440 px con filtros y grupos por día;
  - lector centrado de 760 px como máximo con el bloque «Pendiente de ti» destacado, una casilla por punto («Marcar como hecho» o «Desmarcar») y las secciones con el visor de Markdown.
- Los filtros y la casilla se recuerdan en `localStorage` con try/catch.
- «Retomar desde aquí» abre Nueva sesión con el proyecto y el prompt «Ponte al día con la entrada del historial `.agent/history/<archivo>` y sigue su continuación recomendada.».
- Se omiten «Ir a la sesión original» y «Abrir en editor» (fuera de alcance).

## Risks / Trade-offs

- **Escritura en archivos que también escribe el agente** → `etag` y rechazo con recarga. Las entradas son locales y no hay Git como red de seguridad, así que la edición se limita a una línea por punto.
- **Entradas antiguas con formatos variados** → lectura tolerante y estado `desconocido`. Marcar pendientes solo se permite si la sección existe con puntos `- `.
- **Un agente que reescriba la entrada podría perder las marcas** → la regla le pide conservarlas.
- **Volumen** (unas 170 entradas) → caché por archivo y lista sin el contenido completo.

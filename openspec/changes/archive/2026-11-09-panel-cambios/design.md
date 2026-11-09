## Context

- La pantalla Worktrees (`src/screens/WorktreesScreen.tsx`, `src/components/proyectos/Worktrees.tsx`) lista los worktrees de `projects/<proyecto>.worktrees/` con los datos de `GET /api/projects/:id/worktrees` (`worktreeDetails` en `server/projects.ts`). El harness queda fuera porque no admite worktrees.
- Una primera iteración de este cambio ya implementó la vista de cambios de un worktree (`server/worktree-diff.ts`, `FileTree`, `DiffView`, `WorktreeChanges`, `lib/fileTree.ts`, `lib/diff.ts`, ruta `#/worktrees/<p>/<wt>[/<archivo>]` y «Ver cambios» en la lista). Esta revisión la reorienta a una pantalla «Cambios» que también cubre el checkout principal y reutiliza esas piezas.
- El servidor ejecuta git con `execFile`, sin shell y con tiempo máximo.

## Goals / Non-Goals

**Goals:**

- Ver qué archivos cambian en el checkout principal y en cada worktree de un proyecto (también en el harness) y el diff de cada uno, con enlace directo a un archivo.
- Concentrar en una pantalla lo que mostraba Worktrees y los diffs.

**Non-Goals:**

- Editar, preparar (`git add`), descartar, hacer commit o subir cambios.
- Resaltado de sintaxis o diff por palabras dentro de una línea.
- Ver el diff commit a commit.

## Decisions

### Lugares y qué se compara

Un **lugar** es el checkout principal (`main`) o un worktree (`wt/<nombre>`). Para cada uno se compara su **carpeta de trabajo** con una base:

- **Checkout principal:** base = `git merge-base @{u} HEAD` si la rama actual tiene rama remota; así entran los commits sin subir y lo que no tiene commit. Sin rama remota (o HEAD separado), base = `HEAD`: solo lo que no tiene commit. La respuesta dice qué base se usó (`upstream` o `null`).
- **Worktree:** base = `git merge-base <HEAD del checkout principal> HEAD` ejecutado en el worktree. Así no aparecen los commits que la rama principal ganó después. Sin merge-base (historias sin relación) → 409 con mensaje.
- En ambos casos, archivos sin seguimiento (`git ls-files --others --exclude-standard`): estado `U`, comparados con un archivo vacío. Un conflicto sin resolver se muestra como `M`.
- Un renombrado sin `git add` sale como `D` + `U`: es lo que da git al comparar la carpeta de trabajo.

### API

- `GET /api/projects/:id/changes` → los lugares del proyecto con sus datos:
  `{ base, main: { branch, upstream, ahead, behind, dirty, changes, sessions }, worktrees: [{ name, branch, ahead, behind, dirty, changes, sessions }] }`
  - En `main`, `ahead`/`behind` son frente a `upstream` (null sin rama remota). En un worktree, frente a la rama principal, como hasta ahora. `changes` = nº de archivos cambiados o `null` si git falla.
  - Sustituye a `GET /api/projects/:id/worktrees`, que se mantiene solo si otras pantallas lo usan.
- `GET /api/projects/:id/changes/main` y `GET /api/projects/:id/changes/wt/:wt` → `{ base, mergeBase, upstream, files: [{ path, oldPath, status, added, deleted, binary }], truncated, total }`, tope de 2000 archivos.
- `GET /api/projects/:id/changes/main/diff?path=` y `GET /api/projects/:id/changes/wt/:wt/diff?path=` → `{ path, oldPath, status, binary, tooLarge, patch }`. Con seguimiento: `git diff -M <base> -- <ruta> [<ruta antigua>]`; sin seguimiento: `git diff --no-index -- /dev/null <ruta>`. Más de 512 KB → `tooLarge`; binario → `binary`; ambos sin `patch`.
- `GET /api/changes` → resumen para la barra lateral: `{ projects: { [id]: number | null } }`, la suma de archivos cambiados del checkout principal y los worktrees de cada proyecto visible. Se calcula en paralelo con el mismo código y sin numstat.
- **Seguridad:** el lugar se resuelve entre los del proyecto por nombre (el cliente nunca manda rutas de disco) y `path` solo se acepta si está en la lista recién calculada; si no, 404. Enlaces simbólicos sin seguir. `GIT_OPTIONAL_LOCKS=0` y `--no-ext-diff --no-textconv`: no se escribe en el repositorio. Misma autenticación y comprobación de origen que el resto de la API. Sin caché.
- Errores: proyecto o worktree inexistente → 404; worktree en el harness → 404; git falla → 500 con mensaje.

### Cliente

- **Ruta:** `#/cambios/<proyecto>` (checkout principal), `#/cambios/<proyecto>/main/<archivo…>` y `#/cambios/<proyecto>/wt/<worktree>[/<archivo…>]`, codificando cada segmento. El prefijo `main`/`wt` evita ambigüedad con un worktree que se llame como una carpeta.
  - `#/worktrees/<p>[/<wt>[/<archivo>]]` redirige a la ruta equivalente de Cambios sin añadir entrada al historial; también `#/proyectos/<p>/worktrees`.
  - Worktree inexistente → `#/cambios/<p>`. Archivo que ya no está → aviso y primer archivo.
- **Menú Proyectos:** Backlog, **Cambios** y Guías.
- **Proyecto por defecto:** sin proyecto en la ruta, el primer proyecto visible con cambios según `GET /api/changes`; si ninguno tiene, el último proyecto usado en Cambios y, si no lo hay, el primero visible. No se recuerda lo escogido por defecto.
- **Barra lateral:** recuento «N cambios» por proyecto (o «sin cambios»), refrescado al volver a la ventana y cada 30 s.
- **Pestañas de lugar** (`role="tablist"`): `main · N` primero y un worktree por pestaña (`<nombre> · N`). Desplazables en horizontal si no caben. Por defecto, `main`.
- **Barra del lugar elegido:** rama; en `main`, «↑N sin subir frente a origin/main» (o «sin rama remota»); en un worktree, «frente a main desde <sha>» y ↑↓; «cambios sin commit»; sesiones del panel de ese lugar (acceso a su terminal); «Nueva sesión aquí»; total de archivos y +/−; «Actualizar».
- Lógica pura: `lib/fileTree.ts` y `lib/diff.ts` como en la primera iteración (árbol compactado; parseo y emparejado lado a lado).
- Componentes: `FileTree`, `DiffView` (lado a lado por defecto o unificado, preferencia en `localStorage`; unificado forzado por debajo de 640 px), y la vista de cambios generalizada a cualquier lugar. La lista de Worktrees desaparece: su información pasa a la barra del lugar.
- Recarga de la lista al volver a la ventana y con «Actualizar»; el diff abierto se vuelve a pedir si su archivo cambia en la lista.

### Diseño visual

- Claude Design: https://claude.ai/artifact/HSUYDqn3ofLKhTFFC5QChc. La versión aprobada el 2026-11-09 (vista de un worktree, diff lado a lado/unificado) se revisó para la pantalla Cambios con pestañas de lugar, barra lateral con recuentos y el harness; revisión aprobada el 2026-11-09.

## Risks / Trade-offs

- **[Coste del resumen de la barra lateral]** → Un `git status`/`git diff --name-only` por lugar cada 30 s solo mientras se ve Cambios; en paralelo con límite y tiempo máximo.
- **[Repos grandes o diffs enormes]** → Topes de archivos y de tamaño de parche, `maxBuffer` y tiempo máximo en git.
- **[Rutas con espacios o Unicode]** → Salidas `-z` y `execFile` sin shell.
- **[Rama remota sin `fetch` reciente]** → «sin subir» se calcula contra la referencia remota local; el panel no hace `fetch`.
- **[Enlaces guardados a `#/worktrees`]** → Redirección permanente a Cambios.

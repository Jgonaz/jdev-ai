## Why

La pantalla Worktrees dice de cada worktree su rama, los commits por delante y por detrás y si tiene «cambios sin commit», pero no *qué* ha cambiado. Además deja fuera el checkout principal, que es donde se trabaja cuando no hay worktrees, y el propio harness. Para revisar cambios hay que abrir una terminal y lanzar `git diff`. La persona quiere ver, como en VSCode, los archivos cambiados en un árbol y el diff de cada uno, tanto del checkout principal como de cada worktree, sin salir del panel.

## What Changes

- **La pantalla Worktrees pasa a ser «Cambios»** (`#/cambios/<proyecto>`), en el menú Proyectos. Los enlaces `#/worktrees/…` redirigen. Incluye el propio harness, solo con su checkout principal.
- **Directa al diff:** al entrar en un proyecto se ve ya el diff de su checkout principal. Una fila de pestañas arriba permite elegir dónde: el checkout principal (`main · N`) y un worktree por pestaña (`<worktree> · N`).
  - Bajo las pestañas, los datos del lugar elegido: rama, commits por delante y por detrás, «cambios sin commit», las sesiones del panel que trabajan ahí (con acceso a su terminal) y «Nueva sesión aquí». Absorbe lo que mostraba la lista de Worktrees.
- **Qué se compara:**
  - **Checkout principal:** lo que aún no está en el remoto: los cambios sin commit, los archivos nuevos sin seguimiento y los commits locales sin subir (frente al punto en que se separa de su rama remota). Sin rama remota, solo lo que no tiene commit.
  - **Worktree:** lo que llevaría su PR: los commits de su rama desde que se separó de la rama principal (merge-base), los cambios sin commit y los archivos nuevos.
- **Árbol de archivos cambiados** a la izquierda, al estilo del explorador de VSCode: carpetas plegables, carpetas de un solo hijo compactadas (`src/lib`), letra de estado (A, M, D, R, U) y líneas añadidas y quitadas.
- **Diff del archivo elegido** a la derecha, **lado a lado** por defecto (antes a la izquierda, después a la derecha, como en VSCode) o **unificado** (una columna), a elección de la persona, que el panel recuerda. En ambos: números de línea, signo +/− además del color y cabeceras de cada bloque. En ancho estrecho se usa siempre el unificado.
- Estados propios: carga, error, sin cambios, archivo binario, diff demasiado grande, renombrado sin cambios de contenido, archivo borrado y lista recortada.
- **Barra lateral:** cada proyecto muestra cuántos archivos cambiados tiene entre su checkout principal y sus worktrees. Sin proyecto en la ruta, se abre el primero con cambios.
- **API de solo lectura** para el resumen de cambios, la lista de cambios de un lugar y el diff de un archivo. Solo acepta el checkout principal o worktrees del proyecto por nombre, y archivos de esa lista.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: la pantalla Worktrees se convierte en Cambios, con el diff del checkout principal y de cada worktree.

## Impact

- **Servidor del panel:** módulo `server/worktree-diff.ts` ampliado al checkout principal, resumen de cambios por proyecto y rutas `GET` bajo `/api/projects/:id/changes/…` y `/api/changes`.
- **Cliente:** pantalla `Cambios` en lugar de `Worktrees` (ruta, menú, barra lateral, proyecto por defecto, redirección), pestañas de lugar, árbol, diff y estilos. Inicio y otros enlaces que llevan a Worktrees pasan a Cambios.
- Sin dependencias nuevas ni resaltado de sintaxis. No escribe nada en los proyectos ni en sus worktrees.

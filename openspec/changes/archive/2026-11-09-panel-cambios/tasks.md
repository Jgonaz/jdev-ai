## 1. Diseño

- [x] 1.1 Diseño de la vista de cambios de un worktree en Claude Design, aprobado por la persona, con la URL en `design.md`
- [x] 1.2 Revisión del diseño para la pantalla Cambios (pestañas de lugar, checkout principal, harness, barra lateral), aprobada por la persona

## 2. Servidor del panel

- [x] 2.1 `server/worktree-diff.ts`: lista de cambios frente al merge-base (con seguimiento y sin él) y diff de un archivo con topes de tamaño
- [x] 2.2 Rutas del worktree con validación de worktree y archivo
- [x] 2.3 Pruebas con repositorios git temporales y de la API
- [x] 2.4 Checkout principal como lugar (base = merge-base con la rama remota o HEAD), también en el harness
- [x] 2.5 Rutas `GET /api/projects/:id/changes[/main|/wt/:wt][/diff]` y `GET /api/changes`, con pruebas

## 3. Cliente

- [x] 3.1 Tipos y llamadas de la API
- [x] 3.3 `lib/fileTree.ts` y `lib/diff.ts` con pruebas
- [x] 3.4 `FileTree`, `DiffView` y vista de cambios de un worktree con estilos según el diseño
- [x] 3.5 Pantalla Cambios: ruta `#/cambios/…`, redirección desde `#/worktrees/…`, menú, enlaces de Inicio y demás
- [x] 3.6 Pestañas de lugar con la barra del lugar elegido (rama, ↑↓, sesiones, «Nueva sesión aquí») y sin lista de Worktrees
- [x] 3.7 Barra lateral con recuento de cambios y proyecto por defecto según cambios

## 4. Documentación y validación

- [x] 4.1 README del panel con la pantalla Cambios
- [x] 4.2 `bin/check`, `pnpm --dir panel typecheck`, `test`, `build` y `openspec validate --strict`
- [x] 4.3 QA, si la persona da el visto bueno

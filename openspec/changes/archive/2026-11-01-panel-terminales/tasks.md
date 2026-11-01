## 1. Estado de sesión en el harness

- [x] 1.1 Crear `bin/session-state` (sh POSIX): lectura del JSON del hook, correspondencia evento → estado, escritura atómica en el directorio de estado y salida silenciosa ante errores
- [x] 1.2 Exportar `JDEV_PROJECT` en `bin/agent` y registrar en Claude los hooks `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop` y `SessionEnd` con `bin/session-state`, sin perder los hooks actuales
- [x] 1.3 Añadir a `bin/check` las pruebas de `bin/session-state` y del registro de hooks

## 2. Base del panel

- [x] 2.1 Crear `panel/` con `package.json` (pnpm), Vite + React + TypeScript, vitest y configuración de TypeScript para cliente y servidor; añadir `panel/node_modules/` y `panel/dist/` a `.gitignore`
- [x] 2.2 Servidor: `main.ts` con http y ws en `127.0.0.1`, estáticos de `dist/` y `auth.ts` (token 0600, cookie y validación de `Origin`)
- [x] 2.3 `settings.ts` con valores por defecto y fusión, y API `GET`/`PUT /api/settings`
- [x] 2.4 `projects.ts`: repositorios de `projects/` más el harness, con monograma y color por defecto
- [x] 2.5 `bin/panel`: comprobaciones de requisitos, build cuando haga falta, `--port`, `--open` y `--regenerate-token`

## 3. Terminales y sesiones

- [x] 3.1 `panel/tmux.conf` y `tmux.ts`: crear sesiones con `bin/agent`, listarlas con sus metadatos, terminarlas y adjuntarlas, sobre `tmux -L jdev`
- [x] 3.2 WebSocket `/ws/term/<sesión>` con `node-pty`, redimensionado y cierre limpio del cliente
- [x] 3.3 `states.ts` y `titles.ts`: vigilancia del directorio de estado, relación con tmux, títulos desde el transcript y marca `[Closed]`
- [x] 3.4 API de sesiones y canal `/ws/events` con los cambios
- [x] 3.5 Pruebas de `tmux.ts`, `states.ts`, `titles.ts`, `settings.ts` y `auth.ts`

## 4. Cliente

- [x] 4.1 Temas como variables CSS (Grafito, Fósforo, Papel, Alto contraste), acentos, fuentes y detalles de personalidad con `prefers-reduced-motion`
- [x] 4.2 Cabecera y navegación según el diseño (Inicio, Proyectos e Historial visibles pero marcados como próximamente)
- [x] 4.3 Pantalla Terminales: barra lateral por proyecto con estados, pestañas, distribución en una, dos o cuatro terminales con xterm.js, barra de estado y atajos de teclado
- [x] 4.4 Diálogo Nueva sesión con vista previa del comando y restricciones de `bin/agent`
- [x] 4.5 Avisos: contador en el título de la pestaña y notificación del sistema opcional
- [x] 4.6 Pantalla Ajustes con todas las secciones del diseño aplicables a esta versión y guardado automático

## 5. Documentación y validación

- [x] 5.1 Documentar el panel gráfico en `README.es.md` y `README.md`: instalación, arranque, uso de tmux fuera del panel y seguridad
- [x] 5.2 Integrar en `bin/check` las comprobaciones del panel cuando `panel/node_modules` exista
- [x] 5.3 Ejecutar `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 5.4 QA de punta a punta con el subagente `qa` contra el diseño aprobado

## 6. Sesiones recientes

- [x] 6.1 Servidor: `recent.ts` que lista los transcripts de Claude por proyecto y worktree, con título, actividad y exclusión de las sesiones ya presentes en el panel; `GET /api/recent`
- [x] 6.2 Crear sesión retomada: `resume` en `POST /api/sessions` que añade `-- --resume <id>` a `bin/agent`, validando el id
- [x] 6.3 Cliente: apartado «Sesiones recientes» en la barra lateral con «Retomar en el panel», aviso de confirmación y marca de actividad reciente
- [x] 6.4 Pruebas, validaciones y comprobación manual aislada

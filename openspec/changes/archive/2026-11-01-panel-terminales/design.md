## Context

- Diseño aprobado, referencia de implementación y QA: https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU (pantallas Terminales, Nueva sesión y Ajustes en esta versión).
- El harness es Markdown y sh POSIX sin dependencias; `bin/check` lo valida. El entorno es WSL2 con Node 24.22, pnpm 10.33 y tmux 3.4.
- `bin/agent` ya lanza Claude con `--settings` que registra hooks (`SessionStart`, `PreToolUse` sobre `Agent`, `UserPromptSubmit` con `bin/session-title --hook`) y exporta `JDEV_MAIN_CHECKOUT`, `JDEV_WORKTREE` y `JDEV_SESSION_AGENT`.
- Claude guarda el título en el transcript como líneas `custom-title`; `bin/session-title` añade esas líneas y la marca `[Closed]`.
- «Panel» ya se usa para el resumen de inicio de `bin/session-status`. En la documentación, esta herramienta se llamará «panel gráfico» y su comando `bin/panel`.

## Goals / Non-Goals

**Goals:**

- Ver y usar en una sola ventana todas las terminales de agente, con estado y título fiables.
- Que las sesiones no dependan de que el panel esté abierto.
- Mantener el núcleo del harness sin dependencias y aislar Node en `panel/`.

**Non-Goals:**

- Inicio, Proyectos/backlog e Historial (cambios posteriores).
- Estados de turno para Codex, Copilot u OpenCode.
- Acceso remoto, varios usuarios o despliegue fuera de la máquina local.
- Versión de escritorio (Electron o Tauri).

## Decisions

### Estructura

```text
panel/
├── package.json        # pnpm; scripts dev, build, test, typecheck
├── tmux.conf           # configuración del servidor tmux del panel
├── server/             # Node 24 con TypeScript ejecutado por type stripping nativo
│   ├── main.ts         # http + ws, estáticos de dist/, API
│   ├── auth.ts         # token y comprobación de origen
│   ├── tmux.ts         # crear, listar, terminar y adjuntar sesiones
│   ├── states.ts       # lectura y vigilancia del directorio de estado
│   ├── titles.ts       # último custom-title del transcript
│   ├── projects.ts     # proyectos de projects/ y el propio harness
│   └── settings.ts     # ajustes del usuario
├── shared/             # estructura y valores por defecto de los ajustes, comunes a servidor y cliente
└── src/                # cliente React + TypeScript (Vite)
```

- **Servidor en TypeScript sin compilar**: Node 24 ejecuta `.ts` con type stripping nativo, así que no hacen falta `tsx` ni un build del servidor. Alternativa descartada: compilar con `tsc`, un paso más sin beneficio.
- **Dependencias**: `react`, `react-dom`, `@xterm/xterm` con los addons `fit` y `web-links`, `ws` y `node-pty`; de desarrollo, `vite`, `@vitejs/plugin-react`, `typescript`, `vitest` y tipos. Sin librería de componentes ni de estado: el diseño se implementa con CSS propio y el estado global cabe en un contexto de React.
- **Temas como variables CSS** en `:root[data-theme]`, con los valores de Grafito, Fósforo, Papel y Alto contraste del diseño. xterm.js recibe el mismo tema.

### Terminales sobre tmux

- Servidor tmux propio con `tmux -L jdev -f panel/tmux.conf`, para no mezclarse con el tmux personal. Configuración: barra de estado de tmux oculta (el panel tiene la suya), ratón activado, `escape-time 0`, `history-limit` según Ajustes y `default-terminal tmux-256color`.
- Nombre de sesión `jdev-<proyecto>-<n>` y metadatos como opciones de usuario de tmux (`@jdev_project`, `@jdev_agent`, `@jdev_worktree`, `@jdev_created`). Así el panel reconstruye la lista solo con tmux, sin base de datos.
- Para crear una sesión: `tmux new-session -d -s <nombre> -c <harness> -- <harness>/bin/agent <args>`. Los argumentos se pasan como lista, nunca concatenados en una cadena de shell.
- Cada terminal visible abre un WebSocket `/ws/term/<sesión>` y el servidor lanza con `node-pty` un `tmux -L jdev attach -t <sesión>` del tamaño indicado. El redimensionado viaja como mensaje de control. Al cerrar la pestaña se cierra ese cliente de tmux, no la sesión.
- Desde otra terminal se usa con `tmux -L jdev attach -t <sesión>`. Lo indican la ayuda de `bin/panel` y el menú de la terminal.

### Estado de sesión

`bin/session-state` es sh POSIX. Lee del stdin la entrada JSON del hook y escribe `${XDG_STATE_HOME:-$HOME/.local/state}/jdev-ai/sessions/<session_id>.json` de forma atómica (archivo temporal y `mv`).

| Evento de Claude Code | Estado |
|---|---|
| `SessionStart` | `idle` |
| `UserPromptSubmit`, `PostToolUse` | `working` |
| `Notification` de permiso o pregunta | `waiting` |
| `Notification` de inactividad | `idle` |
| `Stop` | `idle` |
| `SessionEnd` | `ended` |

- `PostToolUse` sirve para salir de «te espera» en cuanto se concede un permiso y la herramienta se ejecuta.
- El tipo de notificación se toma de `notification_type` si llega y, si no, del texto del mensaje. Es el punto más frágil: se aísla en una función con pruebas.
- El archivo guarda `session_id`, `state`, `event`, `updated_at`, `project` (nueva variable `JDEV_PROJECT` exportada por `bin/agent`), `agent`, `worktree`, `transcript_path`, `cwd` y `tmux_session` (de `tmux display -p '#S'` si existe `$TMUX`).
- Ante cualquier error termina con código 0 y sin salida, para no alterar el turno.
- `bin/agent` añade estos hooks a los que ya registra, en el mismo `--settings` y en todas las sesiones, se abran o no desde el panel.

El servidor vigila el directorio con `fs.watch`, más una relectura periódica de respaldo cada 5 s, y relaciona cada estado con su sesión de tmux por `tmux_session`. El título sale de la última línea `custom-title` del transcript, que se relee cuando cambia el estado o el archivo. «Cerrada» se deduce del prefijo `[Closed] `.

### API y eventos

- `GET /api/projects`, `GET /api/sessions`, `POST /api/sessions` (nueva sesión), `DELETE /api/sessions/:nombre` y `GET`/`PUT /api/settings`.
- `/ws/events` empuja cambios de sesiones, estados y títulos.
- Todo exige el token (cabecera o cookie de sesión fijada al abrir la URL con `?token=`). Los WebSocket validan además `Origin`.

### Seguridad

- Solo `127.0.0.1`; el puerto, configurable, es 4317 por defecto. WSL2 reenvía `localhost` a Windows, así que se abre desde el navegador de Windows.
- Token aleatorio de 32 bytes en `${XDG_CONFIG_HOME:-$HOME/.config}/jdev-ai/panel-token` con permisos 0600; `bin/panel --regenerate-token` lo regenera.
- El servidor solo ejecuta `bin/agent` y `tmux` con argumentos validados: el proyecto debe existir en la lista y la feature cumplir el patrón que acepta `bin/worktree`.

### Arranque

`bin/panel` (sh):

1. Comprueba Node ≥ 24, pnpm, tmux y `panel/node_modules`; si falta algo, dice el comando para instalarlo (`pnpm --dir panel install`) y no instala nada.
2. Si `panel/dist` falta o es más antiguo que `panel/src`, ejecuta `pnpm --dir panel build`.
3. Arranca el servidor.

Opciones: `--port`, `--open` (abre el navegador de Windows con `wslview` o `cmd.exe /c start` en modo aplicación si está disponible) y `--regenerate-token`.

### Ajustes

`${XDG_CONFIG_HOME:-$HOME/.config}/jdev-ai/panel.json`, con valores por defecto en el servidor y fusión al leer, para que añadir ajustes nuevos no rompa archivos antiguos. Monograma y color por proyecto: por defecto, iniciales del nombre y un color de una paleta fija asignado por orden alfabético.

### Validación

- `bin/check` añade pruebas de `bin/session-state` con entradas de hook simuladas: estados, escritura atómica, errores silenciosos y escapado JSON. También comprueba que `bin/agent` registra los hooks.
- `panel/`: `pnpm typecheck`, `pnpm test` (vitest para `tmux.ts`, `states.ts`, `titles.ts`, `settings.ts` y `auth.ts`, con un servidor tmux temporal) y `pnpm build`.
- `bin/check` ejecuta las comprobaciones del panel solo si `panel/node_modules` existe y avisa si se las salta, para que el núcleo siga validándose sin Node.
- QA de punta a punta con el subagente `qa` y el diseño como referencia.

## Risks / Trade-offs

- **Compilación nativa de `node-pty`** (necesita `build-essential` y `python3`) → `bin/panel` lo detecta y explica cómo instalarlo.
- **Semántica de los eventos de notificación de Claude Code**, que puede cambiar entre versiones → se aísla en una función probada; ante un caso desconocido, la sesión queda en «trabajando».
- **Atajos del navegador** (`Ctrl+W`, `Ctrl+T`) que interceptan teclas de la terminal → recomendar el modo aplicación; los atajos propios del panel evitan esas combinaciones.
- **Primera dependencia de Node en el harness** → aislada en `panel/`; el resto del harness no la necesita y `bin/check` pasa sin ella.
- **Sesiones abiertas fuera del panel** (sin tmux) → no aparecen como terminales, aunque registren estado. Se documenta y se deja para más adelante una vista de «otras sesiones».
- **Servidor que ejecuta procesos** → solo local, token, validación de `Origin` y lista cerrada de comandos.

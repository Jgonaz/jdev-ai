## Why

Con varios proyectos y varias terminales de agente abiertas a la vez, es difícil saber qué sesión hay en cada ventana, cuál espera una respuesta y cuál ha terminado. El harness ya tiene los datos (proyectos, títulos de sesión, lanzador `bin/agent`), pero no un sitio único donde ver y usar todas las terminales. El diseño aprobado del panel (https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU) resuelve esto; este cambio construye su primera versión.

## What Changes

- Nuevo panel gráfico local dentro del harness (`panel/`), una aplicación web servida desde WSL en `127.0.0.1` y protegida con token, que se arranca con `bin/panel`.
- Pantalla **Terminales**: barra lateral con proyectos y sesiones (título, agente, worktree, estado), pestañas y distribución en una, dos o cuatro terminales interactivas, y barra de estado.
- Las terminales viven en sesiones de **tmux**: sobreviven al cierre del panel o del navegador y se pueden abrir también desde cualquier terminal con `tmux attach`.
- Diálogo **Nueva sesión**: proyecto, agente, checkout principal o worktree, y prompt inicial; ejecuta `bin/agent` dentro de una sesión de tmux.
- **Estados de sesión** (te espera, trabajando, en reposo, cerrada) a partir de hooks del agente: un script nuevo `bin/session-state` que el lanzador registra en Claude Code y que escribe el estado en un directorio de estado local.
- Avisos cuando una sesión pasa a «te espera»: contador en el título de la pestaña y notificación del sistema opcional.
- Pantalla **Ajustes** con tema (Grafito por defecto, Fósforo, Papel, Alto contraste), color de acento, fuentes, tamaños, opciones de terminal, monograma y color por proyecto, detalles de personalidad y avisos.
- Primera dependencia de Node en el harness, aislada en `panel/` con su propio `package.json` (Vite, React, TypeScript, xterm.js, node-pty, ws). El núcleo del harness (reglas y `bin/` en sh) sigue sin dependencias.
- Fuera de esta versión, para cambios posteriores: Inicio, Proyectos/backlog e Historial.

## Capabilities

### New Capabilities

- `agent-panel`: panel gráfico local para lanzar, ver y usar las terminales de agente de todos los proyectos, con sus estados, títulos y ajustes.

### Modified Capabilities

Ninguna. El lanzador añade hooks y una opción para correr dentro de tmux, pero el comportamiento especificado de `feature-worktrees`, `project-backlog` y `qa-subagent` no cambia.

## Impact

- Nuevos: `panel/` (servidor Node y cliente React), `bin/panel`, `bin/session-state`.
- Modificados: `bin/agent` (registra los hooks de estado en Claude Code), `bin/check` (pruebas de `bin/session-state`), `README.es.md`, `README.md` y `.gitignore` (dependencias y build del panel).
- Requisitos del sistema: Node 24 y pnpm (ya instalados), tmux, y compilación nativa de `node-pty` al instalar.
- Seguridad: el servidor ejecuta procesos en la máquina; solo escucha en `127.0.0.1`, exige token y valida el origen.
- Datos locales nuevos fuera del repositorio: estado de sesiones en `${XDG_STATE_HOME:-~/.local/state}/jdev-ai/` y ajustes y token en `${XDG_CONFIG_HOME:-~/.config}/jdev-ai/`.

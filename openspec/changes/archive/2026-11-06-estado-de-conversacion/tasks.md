## 1. Harness

- [x] 1.1 `bin/session-done` con `--open` y `--note`, escritura atómica y validación
- [x] 1.2 `bin/session-title`: `--closed`/`--open` como alias en desuso; el hook reabre por el estado nuevo y limpia la marca antigua
- [x] 1.3 Reglas: `rules/session-done.md`, `rules/session-title.md`, `rules/closed-goal.md`, flujo de worktrees y `AGENTS.md`
- [x] 1.4 Pruebas en `bin/check`

## 2. Servidor del panel

- [x] 2.1 Almacén del estado de conversación (lectura, vigilancia, compatibilidad con `[Closed]`)
- [x] 2.2 Campo `done` en sesiones y recientes, en lugar de `closed`
- [x] 2.3 `PUT /api/conversations/:clave/state` con validación y limpieza de la marca al reabrir
- [x] 2.4 Pruebas

## 3. Cliente

- [x] 3.1 Estado visual «Hecha» con check en barra lateral, pestañas, leyenda y tooltip
- [x] 3.2 «Marcar como hecha» y «Reabrir» en los menús de sesiones, pestañas, «⋯» y «Anteriores»
- [x] 3.3 Filtro «Ocultar hechas» (con migración de la preferencia) e Inicio con «Hechas que siguen abiertas»
- [x] 3.4 Renombrado sin la marca
- [x] 3.5 Pruebas de la lógica pura

## 4. Documentación y validación

- [x] 4.1 README
- [x] 4.2 `bin/check`, `pnpm --dir panel typecheck`, `test`, `build` y `openspec validate --strict`
- [x] 4.3 QA, si la persona da el visto bueno

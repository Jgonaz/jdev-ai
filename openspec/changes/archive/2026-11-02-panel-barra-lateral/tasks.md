## 1. Servidor del panel

- [x] 1.1 Almacén `archived.json` (escritura atómica, validación, límite de 500, limpieza de sesiones que ya no existen)
- [x] 1.2 `PUT /api/archive` y campo `archived` en sesiones y conversaciones recientes, difundido por `/ws/events`
- [x] 1.3 Pruebas

## 2. Cliente

- [x] 2.1 Tooltip de la barra lateral con título completo, lugar y datos de la sesión viva
- [x] 2.2 «Archivar» y «Desarchivar» en el menú contextual
- [x] 2.3 Sección «Archivadas (N)» y exclusión de lo archivado en proyectos, «Anteriores» y «En segundo plano», con los avisos intactos
- [x] 2.4 Worktrees por defecto en el primer proyecto con worktrees (`pickWorktreesProject`) y enlace del menú Proyectos
- [x] 2.5 Pruebas de la lógica pura
- [x] 2.6 Retomar una conversación archivada la desarchiva
- [x] 2.7 Las archivadas no gastan la cuota de «Anteriores» (propio máximo y ventana de 30 días)
- [x] 2.8 Inicio no cuenta las sesiones archivadas, salvo las que esperan

## 3. Documentación y validación

- [x] 3.1 README
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 3.3 QA de punta a punta, si la persona da el visto bueno

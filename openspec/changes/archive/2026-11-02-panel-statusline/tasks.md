## 1. Harness

- [x] 1.1 `bin/session-statusline`: guarda el JSON de la statusline en `statusline/<session_id>.json` (validación, tamaño máximo, escritura atómica) sin imprimir nada
- [x] 1.2 `bin/session-activity`: añade los eventos de subagentes, `Stop` y `PostToolUse` de `Artifact` a `activity/<session_id>.jsonl`, con tamaño máximo
- [x] 1.3 `bin/agent`: con `JDEV_SURFACE=panel`, inyecta la `statusLine` y los hooks de actividad en `--settings`; sin cambios en terminal
- [x] 1.4 Pruebas en `bin/check`

## 2. Servidor del panel

- [x] 2.1 Lectura segura y vigilancia de `statusline/` y `activity/`, asociadas a la sesión por `session_id`
- [x] 2.2 Campos `usage` y `activity` de la sesión en `/ws/events`
- [x] 2.3 Límites de la cuenta: `GET /api/account` y evento `account`
- [x] 2.4 Limpieza de los archivos de sesiones terminadas
- [x] 2.5 Pruebas con muestras reales del JSON de la statusline y de los hooks

## 3. Cliente

- [x] 3.1 Cabecera de la terminal en tres filas según `Statusline.dc.html` (datos en una línea con la barra de contexto detrás, trabajo en curso debajo)
- [x] 3.2 Umbrales de color con icono y texto, datos desactualizados y columna estrecha según `StatuslineEstados.dc.html`
- [x] 3.3 Desplegables de subagentes, shells y artifacts
- [x] 3.4 Cabecera global: agente por defecto con menú y límites de 5 h y 7 días con su detalle
- [x] 3.5 Pruebas de la lógica pura

## 4. Documentación y validación

- [x] 4.1 README (cabecera de la terminal, límites, statusline del panel) y `rules/surface.md` si procede
- [x] 4.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 4.3 QA de punta a punta contra el diseño aprobado, si la persona da el visto bueno

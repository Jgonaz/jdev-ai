## 1. Servidor del panel

- [x] 1.1 Lectores de transcripts de Claude (con subagentes) y de sesiones de Codex, defensivos y con deduplicación
- [x] 1.2 Índice incremental con caché atómica, versión y reconstrucción
- [x] 1.3 Agregados por día, proyecto, modelo, subagente y herramienta; horas activas, racha y mejor día
- [x] 1.4 `GET /api/activity` con periodo, agente y comparación
- [x] 1.5 Pruebas con muestras reales anonimizadas, casos de seguridad y rendimiento

## 2. Cliente

- [x] 2.1 Sección «tu actividad» en Inicio según `Actividad.dc.html`
- [x] 2.2 Calendario, barras por proyecto y reparto por modelo con colores validados en los cuatro temas, tooltips y vista en tabla
- [x] 2.3 Filtros recordados, estado «Calculando…» y ajuste para ocultar la sección
- [x] 2.4 Pruebas de la lógica pura

## 3. Documentación y validación

- [x] 3.1 README
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test`, `build` y `openspec validate --strict`
- [ ] 3.3 QA de punta a punta contra el diseño, si la persona da el visto bueno

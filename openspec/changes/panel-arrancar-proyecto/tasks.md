## 1. Servidor del panel

- [x] 1.1 Detección del comando de arranque desde `package.json` y el lockfile, y ajuste `run` por proyecto con validación
- [x] 1.2 `POST` y `DELETE /api/projects/:id/run` con una sola terminal por proyecto, `@jdev_run`, título y parada con `Ctrl+C` y terminación
- [x] 1.3 `run` en las sesiones y `runCommand`/`runSource` en los proyectos
- [x] 1.4 Pruebas con tmux propio

## 2. Cliente

- [x] 2.1 Botón ▶ / ■ junto al «+» con estados, tooltip y avisos de error
- [x] 2.2 Campo «Comando de arranque» en Ajustes › Proyectos
- [x] 2.3 Indicador de terminal de arranque en marcha
- [x] 2.4 Pruebas de la lógica pura

## 3. Documentación y validación

- [x] 3.1 README
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test`, `build` y `openspec validate --strict`
- [ ] 3.3 QA, si la persona da el visto bueno

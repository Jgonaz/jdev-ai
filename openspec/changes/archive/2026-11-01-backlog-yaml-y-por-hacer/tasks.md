## 1. Reglas y documentación del harness

- [x] 1.1 Actualizar `rules/backlog.md`: carpetas `backlog/` y `todo/`, transiciones, formato con cabecera YAML y `## Resumen`, estado inicial `backlog` y búsqueda de duplicados en los tres estados abiertos
- [x] 1.2 Actualizar la puesta al día de `rules/history.md` para revisar también `docs/backlog/todo/`
- [x] 1.3 Actualizar la sección de backlog de `README.es.md` y la mención de `README.md`
- [x] 1.4 Ejecutar `bin/check` y `openspec validate backlog-yaml-y-por-hacer --strict`

## 2. Migración de los backlogs de los proyectos

- [x] 2.1 jgonaz-portfolio: revisar `git status` de `docs/backlog/`, mover `pending/` a `backlog/` y reescribir sus elementos al nuevo formato
- [x] 2.2 SmashAdvisor: igual, conservando el elemento sin seguimiento en Git
- [x] 2.3 balanz.io: igual
- [x] 2.4 fitnessia: igual
- [x] 2.5 Comprobar en los cuatro proyectos que no queda ninguna carpeta `pending/`, que cada `status` coincide con su carpeta, que `id` coincide con el nombre del archivo y que todos tienen `## Resumen`

## 3. Cierre

- [ ] 3.1 Presentar a la persona los cambios de cada repositorio, sin commit, y esperar autorización para hacer commit
- [ ] 3.2 Archivar el cambio OpenSpec y sincronizar la spec `project-backlog`

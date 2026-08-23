## 1. Regla global del backlog

- [x] 1.1 Crear `rules/backlog.md` con la ruta `docs/backlog/`, las carpetas de estado, el formato Markdown, los identificadores y el ciclo de vida.
- [x] 1.2 Documentar en la regla las instrucciones explícitas de registro, consulta, retoma, resolución y descarte, incluyendo el límite de no interrumpir la tarea activa.
- [x] 1.3 Documentar la separación entre backlog, memoria, historial, OpenSpec y changelog, junto con la prohibición de registrar secretos o datos sensibles innecesarios.

## 2. Integración de la convención en el harness

- [x] 2.1 Añadir a `AGENTS.md` la referencia operativa a la regla de backlog.
- [x] 2.2 Añadir al `README.md` la nueva fuente de contexto y el flujo de uso por proyecto.
- [x] 2.3 Añadir `rules/backlog.md` al índice de `rules/README.md`.

## 3. Verificación y cierre

- [x] 3.1 Validar la propuesta OpenSpec completa y comprobar que la estructura y los nombres de estado coinciden en todos los documentos.
- [x] 3.2 Revisar el diff para confirmar que no se han creado carpetas en proyectos, no se ha modificado el launcher y no se han añadido dependencias.
- [x] 3.3 Registrar la iteración relevante en `.agent/history/` según las reglas del harness.

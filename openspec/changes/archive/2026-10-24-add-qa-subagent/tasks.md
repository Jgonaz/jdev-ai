## 1. Verificaciones previas

- [x] 1.1 Comprobar con `claude -p` que el `mcpServers` inline de `--agents` carga Playwright solo en `qa` y no en la sesión principal.
- [x] 1.2 Comprobar con un artifact real de Claude Design cómo lo lee y lo renderiza un subagente: si funciona `file://` en Playwright MCP o hace falta un servidor local temporal. Documentar la alternativa si no se renderiza fielmente.
- [x] 1.3 Elegir y fijar la versión de `@playwright/mcp` con al menos dos semanas de antigüedad.

## 2. Adaptador

- [x] 2.1 Añadir `qa` a `adapters/claude/agents.json`: descripción, Sonnet, esfuerzo `high`, `mcpServers` con Playwright y un prompt que recoja el entorno, la cobertura, las dos fases de las pruebas mutables, la fidelidad a Design, la prohibición de escribir en el proyecto, la especificación de tests e2e, el informe y la limpieza. Excluir `Edit`, `Write` y `NotebookEdit` con `disallowedTools`.

- [x] 2.2 Exportar en `bin/agent` `PLAYWRIGHT_MCP_OUTPUT_DIR=${TMPDIR:-/tmp}/jdev-qa/<proyecto>` en las sesiones de Claude.

## 3. Reglas y documentación

- [x] 3.1 Añadir el rol de QA a `rules/delegation.md`: cuándo lanzarlo, qué le pasa el orquestador, el flujo de autorización con `SendMessage` y el paso de la especificación de tests e2e al `implementer`.
- [x] 3.2 Documentar en `README.md` el subagente, el apartado `## QA` que declaran los proyectos y los requisitos (Node, descarga del navegador).

## 4. Validación

- [x] 4.1 Añadir comprobaciones a `bin/check`: `qa` presente en `--agents`, con Playwright en `mcpServers`, con la versión fijada (sin `@latest`), sin herramientas de edición y con `PLAYWRIGHT_MCP_OUTPUT_DIR` exportado.
- [x] 4.2 Ejecutar `bin/check`.
- [x] 4.3 Probar el QA en un proyecto real con interfaz y ajustar el prompt según el resultado.

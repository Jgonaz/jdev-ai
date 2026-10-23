## Why

Al acabar una implementación, el `validator` solo ejecuta las comprobaciones que ya existen en el proyecto (tests, linters, builds). Nadie prueba la funcionalidad de punta a punta en un navegador: los caminos de error, los estados vacíos, los permisos, el responsive o la fidelidad al diseño. Hoy esa revisión la hace la persona a mano o el orquestador, que gasta su contexto y su modelo en navegar y hacer capturas.

## What Changes

- Nuevo subagente `qa` en `adapters/claude/agents.json`, con Sonnet y esfuerzo `high`. Lleva el MCP de Playwright definido inline y fijado a una versión, de modo que solo él carga sus herramientas y el servidor se cierra al terminar.
- El QA prueba por defecto en el entorno de desarrollo local del proyecto y solo usa otro si se indica expresamente. Cada proyecto declara en su `AGENTS.md` cómo arrancarlo, la URL, los datos de prueba y la carpeta de tests e2e.
- Deriva los casos del cambio (diff, spec de OpenSpec o encargo) y cubre más que el happy path: validaciones, errores, estados vacíos y de carga, permisos, navegación, responsive y accesibilidad básica.
- Las pruebas mutables, es decir, las que persisten datos o tienen efectos externos, requieren autorización. El QA hace primero las de solo lectura y devuelve la lista de las mutables. El orquestador pide permiso a la persona y retoma al mismo QA con `SendMessage` indicando cuáles están aprobadas.
- Valida la fidelidad a Claude Design. Si no se indica otra fuente, el diseño de referencia es el artifact de Design que le pasa el orquestador. Compara diseño y app en el mismo viewport y reporta cada desviación con dos capturas.
- No escribe en el proyecto: reporta los bugs y propone los casos que merecen quedar como tests e2e (pasos, selectores y aserciones). Los escribe el `implementer` y los ejecuta el `validator`.
- `rules/delegation.md` incorpora el rol de QA como auxiliar sin escritura; se mantiene un único implementador. Se actualizan `README.md` y `bin/check`.

## Capabilities

### New Capabilities

- `qa-subagent`: verificar de punta a punta una implementación terminada en el entorno de desarrollo, con Playwright, autorización previa de las pruebas mutables y comparación con Claude Design.

### Modified Capabilities

Ninguna.

## Impact

- Se modifican `adapters/claude/agents.json`, `bin/agent`, `rules/delegation.md`, `README.md` y `bin/check`.
- Dependencia nueva: `@playwright/mcp`, que se ejecuta con `npx` y requiere Node. Se justifica porque es la única forma de que el agente controle un navegador real. No se instala en ningún proyecto, y la descarga del navegador la hace Playwright la primera vez.
- Los proyectos que quieran usar el QA añaden a su `AGENTS.md` un apartado de QA. El harness no modifica ningún proyecto.
- Solo afecta a Claude. Codex queda fuera de este cambio.

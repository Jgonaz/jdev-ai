## Why

Hoy una conversación se da por terminada anteponiendo `[Closed] ` a su título. Tiene varios inconvenientes:

- Mezcla el nombre con el estado.
- Depende de comparar un texto.
- No guarda cuándo, quién ni por qué se cerró.
- Solo lo hace el agente renombrando la sesión.

La persona trabaja sobre todo en el panel y quiere marcar ella misma una conversación como terminada, con algo más claro que una marca en el título.

## What Changes

- **Estado de conversación propio del harness**, separado del título: abierta o hecha, con la fecha, quién la marcó (la persona o el agente) y una nota opcional. Se guarda en `${XDG_STATE_HOME:-~/.local/state}/jdev-ai/conversations/`.
- **`bin/session-done`** (nuevo): el agente marca la conversación como hecha (`--note "…"` opcional) o la reabre (`--open`). Sustituye a `bin/session-title --closed` y `--open`.
- **Reapertura automática**: igual que hoy, si la persona vuelve a escribir en una conversación hecha, un hook `UserPromptSubmit` la reabre.
- **Título limpio**: `[Closed] ` deja de escribirse. Las conversaciones que ya lo llevan cuentan como hechas, sin migración. El panel lo quita del título que muestra, y al reabrirlas se quita también del título guardado.
- **Panel**:
  - «Marcar como hecha» y «Reabrir» en el menú contextual de las sesiones del panel y de las conversaciones de «Anteriores».
  - Las hechas se muestran con un check y el texto «Hecha» en vez de tachadas. El tooltip dice cuándo y quién la marcó, y la nota si la hay.
  - El filtro «Ocultar cerradas» pasa a «Ocultar hechas».
  - Inicio muestra «Hechas que siguen abiertas» con «Revisar» y añade «Terminar».
- **Reglas**:
  - `rules/session-title.md` pasa a tratar solo el título.
  - La parte de cerrar pasa a una regla nueva, `rules/session-done.md`.
  - Se actualizan `rules/closed-goal.md`, `AGENTS.md` y el flujo de worktrees.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: estado «hecha» en lugar de la marca del título y acciones para marcar y reabrir.
- `feature-worktrees`: tras integrar, la conversación se marca como hecha con `bin/session-done`.

## Impact

- **Harness**:
  - `bin/session-done` nuevo.
  - `bin/session-title` pierde `--closed` y `--open`, que quedan como alias que avisan y llaman a `session-done`, y su hook reabre por el estado nuevo.
  - `bin/agent` registra el hook.
  - `bin/check` lo prueba.
  - Reglas, `AGENTS.md` y README.
- **Panel**:
  - lectura y escritura del estado (API autenticada, escritura atómica, nombres validados);
  - sesiones y recientes con `done`;
  - menú contextual, barra lateral, tooltip, Inicio y filtro.
- Sin dependencias nuevas.
- Fuera del panel, la marca ya no se ve en la lista de `claude --resume`. La persona lo acepta.

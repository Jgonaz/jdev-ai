## Context

- **`bin/session-title`** pone el título añadiendo una línea `custom-title` al transcript de Claude:
  - `--closed` antepone `[Closed] ` y `--open` lo quita;
  - `--hook` (UserPromptSubmit) reabre si el título está cerrado.
  
  Encuentra la sesión con `CLAUDE_CODE_SESSION_ID`.
- **Panel:** lee la marca del título (`parseTitle`, `CLOSED_MARK`) y deriva el estado visual `closed` (tachado). Además:
  - el filtro «Ocultar cerradas» es `hideClosed`;
  - Inicio lista «cerradas que siguen abiertas»;
  - las conversaciones de «Anteriores» traen `closed`.
- **Quién usa `--closed` hoy:** `rules/session-title.md`, `rules/closed-goal.md`, el flujo de worktrees (`feature-worktrees`) y `AGENTS.md`.
- **El renombrado desde el panel** conserva la marca y valida que un título no empiece por ella (`shared/session-title.ts`).

## Goals / Non-Goals

**Goals:**

- Un estado explícito (abierta o hecha) que marcan tanto la persona, desde el panel, como el agente, desde la terminal, sin tocar el título.
- Que no se rompa nada de lo ya marcado con `[Closed]`.

**Non-Goals:**

- Archivar o terminar la sesión al marcarla como hecha. Son acciones aparte y se pueden encadenar a mano.
- Reflejar el estado en `claude --resume` fuera del panel.
- Estados intermedios (por ejemplo «bloqueada»).

## Decisions

### Datos

- **Un archivo por conversación**: `${XDG_STATE_HOME:-~/.local/state}/jdev-ai/conversations/<clave>.json`, con `{"state":"done"|"open","at":"<ISO>","by":"user"|"agent","note":"…"}`. La nota es opcional y como mucho de 500 caracteres. La escritura es atómica (temporal y `mv`, o `rename` en Node) y se valida al leer. Con un archivo por conversación, el script en sh y el servidor no compiten por un único JSON.
- **Clave**:
  - en Claude, el id de la conversación (`CLAUDE_CODE_SESSION_ID`, el mismo de los transcripts y de «Anteriores»): `[0-9a-f-]{36}`;
  - en sesiones del panel sin conversación de Claude (Codex, terminal…), `tmux-<nombre>-<@jdev_created en segundos>`, para que un nombre de tmux reutilizado no herede el estado.
- **Compatibilidad**: una conversación cuyo título empieza por `[Closed] ` y que no tiene archivo de estado cuenta como hecha, con `by: "agent"` y sin fecha. Si tiene archivo, manda el archivo.

### Harness

- `bin/session-done [--open] [--note "<texto>"]`: POSIX sh.
  - Usa `CLAUDE_CODE_SESSION_ID`; fuera de Claude Code avisa y no hace nada, como `session-title`.
  - Escribe el estado con `by: "agent"`.
  - Con `--open`, si el título guardado lleva `[Closed] `, lo quita también (llamando a `session-title`).
- `bin/session-title --closed` y `--open` quedan como alias: avisan por stderr de que están en desuso y llaman a `session-done`. `--closed` deja de tocar el título.
- `session-title --hook` (UserPromptSubmit) reabre la conversación si su estado es «hecha» (`by: "user"`, porque la reabre la persona al escribir) y quita `[Closed] ` del título si lo había. Ya está registrado en `bin/agent`.
- Reglas:
  - `rules/session-done.md`: cuándo marcar como hecha (tras integrar en la rama principal, al cumplir un objetivo «closed» o cuando la persona lo pida) y cómo.
  - `rules/session-title.md` queda solo con el título.
  - `rules/closed-goal.md` y el flujo de worktrees usan `session-done`.
  - `AGENTS.md` enlaza la regla nueva.

### Panel

- Servidor:
  - `ConversationStateStore` lee y vigila `conversations/` (como el resto de almacenes de estado).
  - `SessionInfo` y las recientes llevan `done: { at: string | null; by: 'user' | 'agent'; note: string | null } | null`, que sustituye a `closed`.
  - `PUT /api/conversations/:clave/state` con `{state: "done" | "open", note?}`:
    - valida la clave (UUID de una conversación conocida, de las sesiones o de recientes, o `tmux-…` de una sesión del panel), el cuerpo, el origen, el token y el método;
    - escribe con `by: "user"`;
    - con `open`, si el título guardado lleva `[Closed] `, añade un `custom-title` sin la marca (con `appendCustomTitle`).
  - Los cambios se difunden por `/ws/events`.
  - `parseTitle` sigue quitando la marca del título mostrado.
- Cliente:
  - el estado visual `closed` pasa a `done`;
  - icono de check y texto «Hecha», también en la leyenda;
  - la fila no se tacha, pero se atenúa;
  - el tooltip añade «Hecha el 5 nov a las 15:20 · por ti» (o «por el agente») y la nota;
  - el menú contextual muestra «Marcar como hecha» o «Reabrir» según el estado, en sesiones, pestañas, «⋯» y «Anteriores»;
  - `hideClosed` pasa a `hideDone`, migrando la preferencia guardada, con el texto «Ocultar hechas»;
  - en Inicio, la sección pasa a «Hechas que siguen abiertas», con «Revisar» y «Terminar» (que pide confirmación).
- El renombrado desde el panel ya no conserva ni valida la marca. Un título que empiece por `[Closed]` se acepta como texto, aunque el panel lo seguirá leyendo como hecha por compatibilidad. Se avisa en el diálogo.

## Risks / Trade-offs

- **[El estado no viaja con el transcript]** → Si se borra `~/.local/state`, se pierde (pero no la conversación). Es aceptable: es estado local, como el resto del panel.
- **[Dos fuentes durante la transición]** → El archivo manda sobre el título. La marca antigua solo se lee y desaparece al reabrir.
- **[Agentes que aún usan `--closed`]** → El alias lo traduce.

## Migration Plan

Sin migración de datos. La primera vez que algo marca una conversación, se crea la carpeta `conversations/`. Para volver atrás bastaría con restaurar las reglas y `session-title`; los archivos de estado son inocuos.

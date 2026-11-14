# Conversación hecha

Una conversación está abierta o hecha. El estado se guarda fuera del título, con
la fecha, quién la marcó (la persona o el agente) y una nota opcional, en
`${XDG_STATE_HOME:-~/.local/state}/jdev-ai/conversations/`. La persona también
puede marcarla desde el panel gráfico. Marcarla como hecha no termina ni archiva
la sesión.

El agente lo cambia con `<harness>/bin/session-done`. Solo funciona en Claude
Code; en otras CLIs el script avisa y no hace nada, así que no lo uses fuera de
Claude Code. Solo lo ejecuta el orquestador; los subagentes no.

## Cuándo marcarla como hecha

- Cuando una feature se integra en la rama principal (tras `bin/worktree merge`
  correcto o tras integrar una Pull Request en `main`).
- Al cumplir el objetivo de un cierre autónomo, como último paso, según
  [`closed-goal.md`](closed-goal.md).
- Cuando la persona lo pida.
- Al terminar una respuesta con `✅ Nada pendiente: puedes cerrar esta
  terminal.` En las sesiones abiertas con `agent`, un hook `Stop`
  (`bin/session-done --hook`) lo hace solo, con la nota «El agente terminó sin
  nada pendiente.», así que no ejecutes el script por esto. Solo cuenta si es
  la última línea de la respuesta, y no toca una conversación que ya esté
  hecha. No cierra la terminal ni la pestaña.

Ejecuta `<harness>/bin/session-done`. Con `--note "<texto>"` añade una nota
breve (hasta 500 caracteres) que el panel enseña en el tooltip, por ejemplo qué
se integró y dónde. No lo repitas si ya está hecha.

## Reabrirla

En las sesiones abiertas con `agent`, un hook `UserPromptSubmit`
(`bin/session-title --hook`) la reabre en cuanto la persona escribe de nuevo en
esa terminal. Si la sesión no se abrió con `agent` y retomas trabajo en una
conversación hecha, ejecuta `<harness>/bin/session-done --open` y, si el foco es
otro, actualiza el título según [`session-title.md`](session-title.md).

## Marca antigua `[Closed]`

Antes el estado se escribía en el título con el prefijo `[Closed] `. Una
conversación que aún lo lleva y no tiene estado propio cuenta como hecha; al
reabrirla se quita del título guardado. `session-title --closed` y `--open`
están en desuso: avisan y llaman a `session-done`. No escribas la marca en un
título.

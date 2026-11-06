## MODIFIED Requirements

### Requirement: La sesión se marca como cerrada tras integrar

En Claude Code, cuando la feature se integra en la rama destino, el agente SHALL marcar la conversación como hecha con `bin/session-done`, sin cambiar su título. En las sesiones abiertas con `bin/agent`, un hook `UserPromptSubmit` SHALL reabrirla cuando el usuario vuelva a escribir en la sesión.

#### Scenario: Feature integrada

- **WHEN** `bin/worktree merge <feature>` integra la PR
- **THEN** la conversación queda marcada como hecha por el agente y el panel la muestra con el check «Hecha»

#### Scenario: Retomar la sesión cerrada

- **WHEN** el usuario escribe un nuevo mensaje en una conversación marcada como hecha
- **THEN** la conversación vuelve a estar abierta

# Reglas compartidas

Este directorio queda reservado para reglas globales que aporten valor a varios proyectos. Las reglas de dominio, arquitectura, stack y validación deben vivir en el proyecto correspondiente y prevalecen sobre las globales.

No añadas una regla compartida hasta que exista una necesidad real.

- [`history.md`](history.md): política del historial local de iteraciones relevantes.
- [`memory.md`](memory.md): política de consulta y conservación de memoria auxiliar por proyecto.
- [`backlog.md`](backlog.md): convención para registrar y gestionar trabajo futuro por proyecto.
- [`delegation.md`](delegation.md): roles y criterios compartidos para delegar trabajo entre agentes.
- [`user-guides.md`](user-guides.md): criterios para crear documentación didáctica orientada a desarrolladores y usuarios.
- [`images.md`](images.md): cuándo proponer imágenes generadas y cómo delegarlas en Codex.
- [`design.md`](design.md): cuándo proponer cerrar los diseños en Claude Design antes de implementar interfaz.
- [`worktrees.md`](worktrees.md): cuándo aislar un cambio grande en un worktree y cómo integrarlo.
- [`session-title.md`](session-title.md): título de la sesión en `/resume` y marca `[Closed]` tras integrar.
- [`closed-goal.md`](closed-goal.md): qué implica «Continúa hasta dar esta conversación por closed» y qué autoriza.

## Dónde va cada cosa

- **OpenSpec**: requisitos, escenarios y diseño de los cambios relevantes.
- **Documentación técnica o ADR**: arquitectura e implementación.
- **Guías** (`docs/user-guides/`): cómo entender y usar una funcionalidad.
- **Backlog** (`docs/backlog/`): trabajo futuro accionable.
- **Memoria** (`.agent/memory/`): conocimiento duradero y difícil de redescubrir.
- **Historial** (`.agent/history/`): cómo terminó una iteración y cómo continuarla.
- **Changelog**: hitos publicados por el proyecto.
- **`AGENTS.md`**: reglas permanentes para los agentes.

Las fuentes oficiales (`AGENTS.md`, OpenSpec, documentación y código) prevalecen
sobre la memoria y el historial. No dupliques contenido entre ellas: enlaza la
fuente autoritativa.

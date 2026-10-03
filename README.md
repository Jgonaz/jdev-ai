# jdev-ai

`jdev-ai` es un harness global y ligero para trabajar con agentes de IA sobre varios proyectos independientes. Centraliza reglas y flujos de trabajo sin imponer stack, dependencias ni arquitectura a los proyectos.

## Separación entre harness y proyectos

El harness define **cómo trabajan los agentes**. Cada repositorio situado en `projects/<nombre>/` define su dominio, código, dependencias, documentación y configuración. No es un monorepo ni un workspace: cada proyecto conserva su propio `.git` y puede funcionar aunque este harness desaparezca.

`projects/` está ignorado por completo por el Git de `jdev-ai`, de modo que los repositorios anidados no se rastrean ni se mezclan con él.

## Añadir un proyecto

1. Mueve o clona el repositorio a `jdev-ai/projects/<nombre-proyecto>/`, conservando su `.git`.
2. Crea o adapta su `AGENTS.md` con el contexto y las reglas propias del proyecto.
3. Cuando el flujo determine que un cambio merece OpenSpec y el desarrollador haya aprobado su uso, instálalo e inicialízalo **dentro de ese proyecto**. Antes, consulta `openspec --help` y la documentación de la versión instalada; el harness no asume comandos ni estructuras concretas.
4. Si quieres habilitar memoria auxiliar, crea `.agent/memory/index.md` dentro del proyecto siguiendo [`rules/memory.md`](rules/memory.md).
5. Ignora `/.agent/history/` en el Git del proyecto; el agente creará la carpeta cuando registre la primera iteración relevante.
6. Abre el proyecto con `bin/agent <nombre-proyecto>`.

Las instrucciones específicas del proyecto prevalecen sobre las globales de `AGENTS.md`. El idioma predeterminado es castellano de España, aunque cada proyecto puede sobrescribirlo.

## Lanzar un agente

```sh
bin/agent mi-proyecto             # Claude, por defecto (el nombre no distingue mayúsculas)
bin/agent mi-proyecto --claude
bin/agent mi-proyecto --codex
bin/agent mi-proyecto --copilot
bin/agent mi-proyecto --opencode
bin/agent --codex mi-proyecto     # el orden de proyecto y agente es indiferente
bin/agent .                       # repositorio Git actual dentro de projects/ o el propio harness
bin/agent mi-proyecto -- resume   # lo que sigue a «--» se pasa tal cual al agente
```

Al iniciar la sesión se muestra un resumen pensado para retomar un proyecto
tras días sin tocarlo:

- **Última sesión**: título, fecha, hace cuánto fue, cómo quedó y los primeros
  puntos de su resumen en `.agent/history/`.
- **Desde entonces**: commits posteriores a esa sesión, cambios locales sin
  commit y cambios OpenSpec abiertos con su progreso de tareas.
- **Pendiente de ti**: decisiones o acciones que esperan a la persona, si la
  última sesión las registró.
- **Por dónde seguir**: la continuación recomendada de la última sesión o, si
  no existe, una sugerencia según el estado de Git y OpenSpec.

Lo genera `bin/session-status`, que solo lee metadatos locales: no analiza
código ni specs, y el resumen se muestra a la persona sin enviarse como
contexto al modelo. La última sesión se elige por su fecha y hora, no por el
nombre del archivo. Para retomar con más detalle, pide al agente «ponme al
día»: sigue el apartado «Puesta al día» de [`rules/history.md`](rules/history.md).

- **Claude**: el launcher registra con `--settings` un hook `SessionStart`
  (`startup` y `clear`) que muestra el resumen dentro de la sesión al arrancar y
  tras `/clear`. No requiere confirmación.
- **Codex**: registra el mismo hook con `--config`. Codex exige revisar y
  confiar una vez en él desde `/hooks`; hasta entonces lo omite. El comando es
  idéntico en todos los proyectos, así que basta confiar una vez mientras no
  cambie la ruta del harness.
- **Copilot y OpenCode**: el resumen se imprime en la terminal antes de abrirlos.

El launcher no modifica archivos, instala dependencias ni inicializa OpenSpec,
y no añade configuración a los proyectos. El ejecutable elegido (`codex`,
`claude`, `copilot` u `opencode`) debe estar instalado y disponible en `PATH`.

### Orquestación y delegación

Para tareas que requieran planificación e implementación relevante, el agente
principal actúa como orquestador y puede delegar una tarea acotada a un único
implementador. La política común y agnóstica al proveedor está en
[`rules/delegation.md`](rules/delegation.md). Si una herramienta no admite
subagentes compatibles, el agente principal desempeña ambos roles de forma
secuencial.

Al lanzar Codex mediante `agent`, el harness utiliza la sesión principal con
GPT-6 Astra y esfuerzo `medium`, y registra el implementador definido en
`adapters/codex/implementer.toml` con GPT-6 Luna y esfuerzo `max`. Esta
configuración se inyecta desde el launcher y no añade archivos `.codex/` a los
proyectos. También limita la sesión a un único subagente concurrente.

Codex solo descubre `AGENTS.md` hasta la raíz Git del proyecto, por lo que no
vería las reglas del harness. Por eso el launcher inyecta `AGENTS.md` del
harness como `developer_instructions`, indicando la ruta real de `<harness>`.
Esto sustituye cualquier `developer_instructions` definido en
`~/.codex/config.toml` durante esa sesión. Al abrir el propio harness no se
inyecta, porque Codex ya lo carga. Claude Code no lo necesita: sube por los
directorios y carga el `CLAUDE.md` del harness por sí solo.

Codex acepta claves `--config` desconocidas sin error, así que el launcher no
puede confirmar que las claves `agents.*` registren el implementador. La
variable `codex_verified_version` de `bin/agent` indica la versión de
codex-cli con la que se comprobó a mano; si la instalada es otra, el resumen
muestra un aviso. Para verificarla, pide en una sesión que delegue una tarea
trivial en `implementer` y, si funciona, actualiza esa variable.

Los defaults de Codex pueden sobrescribirse para una ejecución mediante
variables de entorno:

```sh
JDEV_CODEX_ORCHESTRATOR_MODEL=gpt-5.6-terra \
JDEV_CODEX_ORCHESTRATOR_EFFORT=high \
JDEV_CODEX_IMPLEMENTER_MODEL=gpt-6-luna \
JDEV_CODEX_IMPLEMENTER_EFFORT=max \
agent mi-proyecto
```

Estas preferencias solo se aplican al entrar mediante el launcher. Claude,
Copilot y OpenCode mantienen su ejecución actual; podrán mapear los mismos roles
a sus mecanismos nativos sin cambiar la política común ni los proyectos.

Opcionalmente, añade el directorio `bin/` a tu `PATH` para poder usar `agent` desde cualquier lugar:

```sh
export PATH="$HOME/proyectos/jdev-ai/bin:$PATH"
```

## Validación del harness

Tras modificar `bin/agent`, `bin/session-status` o los archivos que inyectan, ejecuta:

```sh
bin/check
```

Prueba el launcher sobre un harness temporal con agentes simulados: no lanza
agentes reales ni toca `projects/`.

## Fuentes de contexto y continuidad

Cada mecanismo resuelve una necesidad distinta y evita convertir un único
documento en fuente de todo:

| Mecanismo | Objetivo | Contenido | Por qué es necesario |
| --- | --- | --- | --- |
| OpenSpec | Definir cambios funcionales relevantes antes de implementarlos | Requisitos, escenarios, proposals y tasks | Reduce ambigüedad y evita un SDD paralelo |
| Backlog | Conservar trabajo futuro específico de un proyecto | Findings, TODOs, fixes y features organizados por estado | Evita perder hallazgos que no se pueden abordar ahora |
| Guías de uso | Explicar una funcionalidad a una persona sin asumir contexto previo | Propósito, conceptos, pasos, ejemplos y limitaciones | Permite entender o recordar cómo se utiliza una parte del proyecto |
| Memoria | Conservar conocimiento duradero difícil de redescubrir | Causas de bugs, workarounds, limitaciones y enfoques descartados | Evita repetir investigaciones costosas |
| Historial | Recordar cómo terminó una iteración y por dónde continuar | Resumen, estado, decisiones, referencias y siguiente paso | Permite retomar el trabajo días después sin releer el chat |
| Git y changelog | Mostrar qué cambió realmente y qué hitos se publicaron | Código, commits e hitos relevantes | Aporta evidencia técnica e historial oficial |

OpenSpec, `AGENTS.md`, la documentación oficial, el código y Git prevalecen
sobre memoria e historial cuando exista una contradicción.

## OpenSpec

OpenSpec es la herramienta principal de Spec Driven Development para cambios grandes o con impacto funcional relevante. No se activa por el hecho de crear un commit, subir una rama o abrir una PR: el agente debe inferir si aporta valor según el alcance, el riesgo y la ambigüedad del cambio.

Suele merecer OpenSpec cuando el cambio introduce comportamiento o reglas de negocio visibles, modifica contratos públicos, datos, permisos o seguridad, requiere una decisión arquitectónica, afecta a varias partes o integraciones, tiene un despliegue o rollback delicado, o necesita coordinar varias iteraciones o personas. Los cambios pequeños, internos, reversibles y claramente acotados siguen el flujo normal. Las proposals, specs y tasks pertenecen siempre al `openspec/` del proyecto afectado: al trabajar en `projects/<nombre>/` se crean en ese proyecto y nunca en el `openspec/` del harness, que solo documenta cambios del propio harness.

Cuando el agente determine que OpenSpec puede ser adecuado, debe proponerlo antes de instalarlo, inicializarlo o crear/modificar cualquier proposal, spec o task. La propuesta debe resumir el motivo, el alcance, los riesgos y los artefactos previstos. El agente debe esperar el visto bueno explícito del desarrollador; una petición genérica de implementar el cambio no equivale a esa aprobación. Sin aprobación, continúa por el flujo normal o solicita la aclaración necesaria. Consulta `workflows/feature.md` para los criterios y checkpoints completos.

## Backlog de trabajo futuro

Cada proyecto puede conservar sus pendientes en `docs/backlog/`, con un archivo
Markdown por elemento dentro de `pending/`, `in-progress/`, `done/` o
`discarded/`. Sirve para registrar explícitamente findings, TODOs, fixes o
features que no se van a abordar durante la tarea actual. La persona puede
decir, por ejemplo, «apunta un finding» y el agente debe documentarlo, informar
de su identificador y continuar con el trabajo en curso. Si detecta un hallazgo
claro y accionable por iniciativa propia, puede proponer registrarlo, pero no
creará el documento sin confirmación explícita.

El backlog pertenece al repositorio del proyecto y no sustituye la memoria, el
historial ni OpenSpec. La convención completa está en
[`rules/backlog.md`](rules/backlog.md).

## Guías de uso por proyecto

Cuando una funcionalidad necesite explicarse de forma sencilla y sin asumir
contexto previo, el proyecto puede versionar guías para desarrolladores y
usuarios bajo `docs/user-guides/`. El agente valora su necesidad al crear o
modificar funcionalidades y mantiene actualizadas las guías afectadas, pero no
documenta automáticamente cambios triviales, internos o autoevidentes. La
política completa está en [`rules/user-guides.md`](rules/user-guides.md).

## Memoria por proyecto

Cada proyecto puede versionar conocimiento histórico auxiliar bajo `.agent/memory/`. Esta memoria se consulta de forma selectiva, no funciona como diario de actividad y nunca sustituye a `AGENTS.md`, OpenSpec, la documentación oficial ni el código. La política completa está en [`rules/memory.md`](rules/memory.md).

## Historial de iteraciones

Cada proyecto mantiene bajo `.agent/history/` resúmenes locales de las
iteraciones relevantes. No son transcripciones ni documentación oficial: sirven
para recordar qué se hizo, cómo quedó el trabajo y qué conviene hacer después.
Se ignoran en Git para evitar ruido, conflictos y la publicación accidental de
contexto conversacional. La política completa está en
[`rules/history.md`](rules/history.md).

# jdev-ai

`jdev-ai` es un harness global y ligero para trabajar con agentes de IA sobre varios proyectos independientes. Centraliza reglas y flujos de trabajo sin imponer stack, dependencias ni arquitectura a los proyectos.

## Separación entre harness y proyectos

El harness define **cómo trabajan los agentes**. Cada repositorio situado en `projects/<nombre>/` define su dominio, código, dependencias, documentación y configuración. No es un monorepo ni un workspace: cada proyecto conserva su propio `.git` y puede funcionar aunque este harness desaparezca.

`projects/` está ignorado por completo por el Git de `jdev-ai`, de modo que los repositorios anidados no se rastrean ni se mezclan con él.

## Añadir un proyecto

1. Mueve o clona el repositorio a `jdev-ai/projects/<nombre-proyecto>/`, conservando su `.git`.
2. Crea o adapta su `AGENTS.md` con el contexto y las reglas propias del proyecto.
3. Cuando corresponda, instala OpenSpec e inicialízalo **dentro de ese proyecto**. Antes, consulta `openspec --help` y la documentación de la versión instalada; el harness no asume comandos ni estructuras concretas.
4. Si quieres habilitar memoria auxiliar, crea `.agent/memory/index.md` dentro del proyecto siguiendo [`rules/memory.md`](rules/memory.md).
5. Ignora `/.agent/history/` en el Git del proyecto; el agente creará la carpeta cuando registre la primera iteración relevante.
6. Abre el proyecto con `bin/agent <nombre-proyecto>`.

Las instrucciones específicas del proyecto prevalecen sobre las globales de `AGENTS.md`. El idioma predeterminado es castellano de España, aunque cada proyecto puede sobrescribirlo.

## Lanzar un agente

```sh
bin/agent mi-proyecto             # Codex, por defecto
bin/agent mi-proyecto --codex
bin/agent mi-proyecto --claude
bin/agent mi-proyecto --copilot
bin/agent mi-proyecto --opencode
bin/agent .                       # repositorio Git actual dentro de projects/
```

Antes de ejecutar el agente, el launcher muestra un panel con el proyecto, la
rama, el estado de Git, los cambios OpenSpec activos y la última entrada del
historial local cuando exista. Combina esos metadatos para orientar la sesión:
Git y OpenSpec señalan trabajo técnico pendiente, mientras que el historial
aporta el cierre anterior y su continuación recomendada. Las comprobaciones se
ejecutan localmente antes de iniciar el agente; no analizan código o specs ni se
envían como prompt. El launcher no modifica archivos, instala dependencias ni
inicializa OpenSpec. El ejecutable elegido (`codex`, `claude`, `copilot` u
`opencode`) debe estar instalado y disponible en `PATH`.

### Orquestación y delegación

Para tareas que requieran planificación e implementación relevante, el agente
principal actúa como orquestador y puede delegar una tarea acotada a un único
implementador. La política común y agnóstica al proveedor está en
[`rules/delegation.md`](rules/delegation.md). Si una herramienta no admite
subagentes compatibles, el agente principal desempeña ambos roles de forma
secuencial.

Al lanzar Codex mediante `agent`, el harness utiliza la sesión principal con
GPT-5.6 Sol y esfuerzo `medium`, y registra el implementador definido en
`adapters/codex/implementer.toml` con GPT-5.6 Luna y esfuerzo `max`. Esta
configuración se inyecta desde el launcher y no añade archivos `.codex/` a los
proyectos. También limita la sesión a un único subagente concurrente.

Los defaults de Codex pueden sobrescribirse para una ejecución mediante
variables de entorno:

```sh
JDEV_CODEX_ORCHESTRATOR_MODEL=gpt-5.6-terra \
JDEV_CODEX_ORCHESTRATOR_EFFORT=high \
JDEV_CODEX_IMPLEMENTER_MODEL=gpt-5.6-luna \
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

## Fuentes de contexto y continuidad

Cada mecanismo resuelve una necesidad distinta y evita convertir un único
documento en fuente de todo:

| Mecanismo | Objetivo | Contenido | Por qué es necesario |
| --- | --- | --- | --- |
| OpenSpec | Definir cambios funcionales relevantes antes de implementarlos | Requisitos, escenarios, proposals y tasks | Reduce ambigüedad y evita un SDD paralelo |
| Guías de uso | Explicar una funcionalidad a una persona sin asumir contexto previo | Propósito, conceptos, pasos, ejemplos y limitaciones | Permite entender o recordar cómo se utiliza una parte del proyecto |
| Memoria | Conservar conocimiento duradero difícil de redescubrir | Causas de bugs, workarounds, limitaciones y enfoques descartados | Evita repetir investigaciones costosas |
| Historial | Recordar cómo terminó una iteración y por dónde continuar | Resumen, estado, decisiones, referencias y siguiente paso | Permite retomar el trabajo días después sin releer el chat |
| Git y changelog | Mostrar qué cambió realmente y qué hitos se publicaron | Código, commits e hitos relevantes | Aporta evidencia técnica e historial oficial |

OpenSpec, `AGENTS.md`, la documentación oficial, el código y Git prevalecen
sobre memoria e historial cuando exista una contradicción.

## OpenSpec

OpenSpec es la herramienta principal de Spec Driven Development para cambios grandes o con impacto funcional relevante. Los cambios pequeños y claramente acotados no necesitan artefactos por defecto. Las proposals, specs y tasks pertenecen siempre al `openspec/` del proyecto afectado; nunca al harness. Consulta `workflows/feature.md` antes de abordar una feature de alcance significativo.

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

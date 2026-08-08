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
5. Abre el proyecto con `bin/agent <nombre-proyecto>`.

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

El launcher solo cambia al directorio del proyecto y ejecuta el agente. No modifica archivos, instala dependencias ni inicializa OpenSpec. El ejecutable elegido (`codex`, `claude`, `copilot` u `opencode`) debe estar instalado y disponible en `PATH`.

Opcionalmente, añade el directorio `bin/` a tu `PATH` para poder usar `agent` desde cualquier lugar:

```sh
export PATH="$HOME/proyectos/jdev-ai/bin:$PATH"
```

## OpenSpec

OpenSpec es la herramienta principal de Spec Driven Development para cambios grandes o con impacto funcional relevante. Los cambios pequeños y claramente acotados no necesitan artefactos por defecto. Las proposals, specs y tasks pertenecen siempre al `openspec/` del proyecto afectado; nunca al harness. Consulta `workflows/feature.md` antes de abordar una feature de alcance significativo.

## Memoria por proyecto

Cada proyecto puede versionar conocimiento histórico auxiliar bajo `.agent/memory/`. Esta memoria se consulta de forma selectiva, no funciona como diario de actividad y nunca sustituye a `AGENTS.md`, OpenSpec, la documentación oficial ni el código. La política completa está en [`rules/memory.md`](rules/memory.md).

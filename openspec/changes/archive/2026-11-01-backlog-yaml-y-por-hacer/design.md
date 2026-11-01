## Context

El formato actual de los elementos (lista `- ID:`, `- Tipo:`, `- Estado:`…) está definido en `rules/backlog.md` y lo siguen 42 elementos en cuatro proyectos. Ningún script de `bin/` lee el backlog: el único consumidor es el agente, guiado por la regla, y en el futuro lo será el panel gráfico del harness, cuyo diseño aprobado (https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU) ya muestra la cabecera, el resumen y las columnas backlog / por hacer / en curso / hecho.

## Goals / Non-Goals

**Goals:**

- Metadatos que se puedan leer de un vistazo y procesar sin heurísticas.
- Un resumen corto para la persona antes del detalle técnico.
- Separar lo que hay que revisar de lo que ya se ha decidido abordar.
- Dejar todos los backlogs existentes en el formato nuevo, sin elementos en dos formatos.

**Non-Goals:**

- Construir el panel gráfico o cualquier script que lea el backlog.
- Validar el formato automáticamente desde `bin/check` (el harness no tiene backlog propio que validar).
- Cambiar los tipos (`finding`, `todo`, `fix`, `feature`) ni el patrón del identificador.

## Decisions

### Formato del elemento

```markdown
---
id: BL-20261024-1145-typescript-7
title: Migrar a TypeScript 7 cuando el tooling lo admita
type: todo
status: backlog
priority: baja
created: 2026-10-24
updated: 2026-11-01
refs:
  - apps/web/package.json
---

# Migrar a TypeScript 7 cuando el tooling lo admita

## Resumen

Un párrafo en lenguaje llano: qué es, por qué importa y qué lo desbloquea.

## Contexto
## Próximo paso
## Criterios de cierre
```

- **Claves en inglés y valores de estado iguales a las carpetas.** Es la convención habitual del front matter y evita traducir entre carpeta y campo. Las prioridades conservan los valores actuales (`alta`, `media`, `baja`).
- **`title` duplica el H1 a propósito.** Así una herramienta obtiene todo lo necesario de la cabecera sin parsear Markdown; la regla exige que coincidan. Alternativa descartada: solo H1, más frágil para el panel.
- **`updated` se añade** para poder ordenar por actividad sin depender de Git.
- **`refs` es una lista opcional.** Las referencias actuales en una sola línea se dividen en elementos.
- **El resumen es una sección `## Resumen`, no un campo YAML.** Un párrafo de hasta 350 palabras en YAML sería incómodo de editar y de leer en crudo. Límite orientativo: unos 2 minutos de lectura (≈ 350 palabras).

### Estados y carpetas

`docs/backlog/{backlog,todo,in-progress,done,discarded}/`. El nombre `docs/backlog/backlog/` es redundante, pero la persona lo prefirió frente a `inbox/` por claridad del concepto. La carpeta sigue siendo la fuente de verdad; si discrepa del campo `status`, manda la carpeta.

Transiciones: lo nuevo entra en `backlog`; `backlog → todo` solo por decisión de la persona; desde `backlog` o `todo` se puede pasar a `in-progress`, y desde cualquier estado abierto a `done` o `discarded`.

### Migración

- Cada elemento de `pending/` pasa a `backlog/`: la revisión para elegir qué va a `todo` corresponde a la persona.
- `in-progress/`, `done/` y `discarded/` se quedan en su carpeta.
- Todos los elementos, también los cerrados, reciben cabecera y resumen, para que el panel y el agente no tengan que tolerar dos formatos. El resumen se redacta a partir del contenido existente, sin inventar datos; si falta información se indica.
- `created` sale del campo `Creado`; `updated` toma la fecha de la migración.
- Los archivos se mueven con `git mv` cuando están en seguimiento para conservar el historial; el elemento sin seguimiento de SmashAdvisor se mueve con `mv`.
- La migración se hace proyecto a proyecto y queda sin commit hasta autorización explícita.

## Risks / Trade-offs

- **Cambios locales del usuario en los backlogs** → antes de migrar cada proyecto se revisa `git status` de `docs/backlog/` y no se sobrescribe nada sin avisar.
- **Resúmenes de elementos cerrados con poco contexto** → se escriben con lo que hay y se marca lo desconocido, sin inventar.
- **Sesiones abiertas en otros proyectos que aún siguen la regla antigua** podrían crear elementos en `pending/` durante la migración → se comprueba al final que no queda ninguna carpeta `pending/`.
- **Cambio incompatible para quien lea el backlog con el formato antiguo** → no hay consumidores automáticos; el agente sigue la regla actualizada.

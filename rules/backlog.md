# Backlog de trabajo diferido

El backlog conserva trabajo futuro accionable que aparece mientras se trabaja
en un proyecto y que no se va a abordar en la tarea actual. Es documentación
compartida y versionada del proyecto, no un diario de conversación.

## Ubicación y estructura

Cada proyecto puede crear esta estructura cuando registre su primer elemento:

```text
docs/backlog/
├── backlog/       por revisar: aquí entra todo lo nuevo
├── todo/          por hacer: revisado y elegido para abordar pronto
├── in-progress/
├── done/
└── discarded/
```

Los elementos pertenecen al repositorio Git del proyecto, nunca al Git del
harness. Cada elemento vive en un archivo Markdown independiente dentro de
una sola carpeta de estado. La carpeta es la fuente de verdad del estado y no
se crea una copia del mismo elemento en varias carpetas. Si el campo `status`
de la cabecera no coincide con la carpeta, manda la carpeta: corrige `status`
y avisa a la persona.

Los estados abiertos son `backlog`, `todo` e `in-progress`. Las transiciones
son:

- Lo nuevo entra en `backlog`, salvo que la persona indique que se abordará
  pronto (`todo`) u otro estado.
- `backlog` → `todo` solo por decisión explícita de la persona: es ella quien
  revisa el backlog y elige qué se aborda.
- `backlog` o `todo` → `in-progress` al empezar a trabajar en el elemento.
- Cualquier estado abierto → `done` o `discarded` al resolverlo o descartarlo.

El tipo es un metadato del elemento, no una subcarpeta. Se admiten al menos
`finding`, `todo`, `fix` y `feature`; un proyecto puede añadir otros tipos si
los necesita. Un elemento `discarded` documenta el motivo del descarte.

No es obligatorio crear un índice común. Los elementos pueden localizarse por
su carpeta, nombre, tipo o metadatos.

## Formato de los elementos

Usa un identificador estable y un nombre descriptivo con este patrón:

```text
BL-YYYYMMDD-HHMM-slug.md
```

Si ya existe el mismo nombre, añade un sufijo breve sin reutilizar otro
identificador. El identificador no cambia al mover el archivo entre estados.

Cada elemento empieza con una cabecera YAML y sigue esta estructura:

```markdown
---
id: BL-YYYYMMDD-HHMM-slug
title: Título breve
type: finding
status: backlog
priority: media
created: YYYY-MM-DD
updated: YYYY-MM-DD
refs:
  - ruta, símbolo o contexto relevante
---

# Título breve

## Resumen

Un único párrafo para la persona, en lenguaje llano: qué es, por qué importa y
qué haría falta para abordarlo o qué lo desbloquea.

## Contexto

Qué se observó, cuándo apareció y por qué no se aborda ahora.

## Próximo paso

Qué habría que investigar, cambiar o decidir al retomarlo.

## Criterios de cierre

Cómo sabremos que el elemento está resuelto, si se puede concretar.
```

Reglas de la cabecera:

- Todas las claves son obligatorias salvo `refs`, que es una lista y se omite
  si no hay referencias.
- `id` coincide con el nombre del archivo sin `.md`, y `title`, con el título
  `#` del documento.
- `status` es el nombre de la carpeta: `backlog`, `todo`, `in-progress`,
  `done` o `discarded`.
- `priority` es `alta`, `media` o `baja`.
- Las fechas van en formato `YYYY-MM-DD`. Actualiza `updated` cada vez que
  cambie el contenido o el estado del elemento.

El resumen va siempre justo después del título y antes de cualquier detalle.
Es un solo párrafo, escrito para alguien que no recuerda el contexto, de como
máximo unos 2 minutos de lectura (alrededor de 350 palabras); si crece más,
condénsalo y lleva el resto al detalle. Al cambiar el estado o el contenido,
revisa que siga reflejando la situación real.

Si faltan datos no imprescindibles, registra lo conocido e indica qué queda
por aclarar; no inventes requisitos, decisiones de producto ni referencias. No
incluyas secretos, credenciales ni datos personales innecesarios en un
documento versionado.

## Sugerencias proactivas

Aunque la persona no diga «apúntalo», el agente puede proponer registrar un
elemento cuando detecte un problema reproducible, una limitación observable o
una mejora concreta que:

- tenga evidencia suficiente y un siguiente paso razonable;
- quede fuera del alcance de la tarea actual; y
- sea trabajo futuro accionable, no una preferencia o una opinión.

Antes de sugerirlo, busca coincidencias en `backlog/`, `todo/` e
`in-progress/`. Si ya
existe un elemento equivalente, referencia su identificador en lugar de
proponer un duplicado. No sugieras observaciones especulativas, refactors
hipotéticos, mejoras puramente subjetivas ni problemas que ya hayas resuelto.

La sugerencia debe ser breve y aparecer en un punto natural de la respuesta,
sin interrumpir la tarea. Por ejemplo:

> He detectado un posible `finding`: la validación X no cubre el caso Y. Está
> fuera del alcance actual; ¿quieres que lo registre en el backlog?

Una sugerencia no crea ni modifica ningún archivo. Solo después de una
confirmación explícita se aplica el flujo de registro descrito más abajo. Si
la confirmación es ambigua, no escribas y pide aclaración cuando sea necesario.
No repitas una sugerencia rechazada ni la emitas más de una vez por el mismo
hallazgo durante la tarea.

Los riesgos inmediatos de seguridad, pérdida de datos, corrupción o bloqueo se
comunican en el momento como incidencias prioritarias. No los presentes
únicamente como trabajo diferible del backlog.

## Cómo debe actuar el agente

Cuando la persona diga explícitamente «apunta», «anota», «registra» o «déjalo
para después», seguido de un hallazgo o tarea, el agente debe:

1. Buscar si ya existe un elemento equivalente para actualizarlo o enlazarlo.
2. Crear o actualizar únicamente el documento de backlog necesario, empezando
   en `backlog` salvo que la persona indique otro estado.
3. Capturar el contexto suficiente, el tipo solicitado, el siguiente paso y
   el resumen.
4. Informar de la ruta y del identificador creado o actualizado.
5. Continuar la tarea que estaba realizando.

Registrar un elemento no autoriza a investigar, corregir código, cambiar el
alcance de la tarea actual, crear un cambio OpenSpec ni hacer un commit.

Cuando la persona pida revisar el backlog, lista los elementos relevantes,
separando `backlog`, `todo` e `in-progress`, y permite filtrarlos por tipo o
estado. Si decide que un elemento de `backlog` se abordará pronto, muévelo a
`todo`. Cuando pida abordar un identificador, lee su documento, muévelo a
`in-progress` y actualízalo conforme avance el trabajo. Al resolverlo o
descartarlo, muévelo a `done` o `discarded` y conserva la referencia al
commit, PR, cambio OpenSpec o motivo cuando exista. En cada movimiento,
actualiza `status` y `updated` en la cabecera; usa `git mv` si el archivo está
en seguimiento.

Si el elemento revela una decisión funcional, arquitectónica, de datos,
seguridad o una integración relevante, propone o utiliza OpenSpec según
[`workflows/feature.md`](../workflows/feature.md) y enlaza el cambio desde el
elemento de backlog. El backlog no sustituye esa especificación.

## Límites frente a otras fuentes

El backlog recoge solo trabajo futuro accionable; el resto de fuentes se reparte
según [`README.md`](README.md#dónde-va-cada-cosa). No copies transcripciones de sesiones ni dupliques en el backlog información
que ya tenga una fuente autoritativa. Enlaza esa fuente cuando el pendiente
dependa de ella.

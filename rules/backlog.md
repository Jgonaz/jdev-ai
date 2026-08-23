# Backlog de trabajo diferido

El backlog conserva trabajo futuro accionable que aparece mientras se trabaja
en un proyecto y que no se va a abordar en la tarea actual. Es documentación
compartida y versionada del proyecto, no un diario de conversación.

## Ubicación y estructura

Cada proyecto puede crear esta estructura cuando registre su primer elemento:

```text
docs/backlog/
├── pending/
├── in-progress/
├── done/
└── discarded/
```

Los elementos pertenecen al repositorio Git del proyecto, nunca al Git del
harness. Cada elemento vive en un archivo Markdown independiente dentro de
una sola carpeta de estado. La carpeta es la fuente de verdad del estado y no
se crea una copia del mismo elemento en varias carpetas.

El tipo es un metadato del elemento, no una subcarpeta. Se admiten al menos
`finding`, `todo`, `fix` y `feature`; un proyecto puede añadir otros tipos si
los necesita. Los estados iniciales son:

- `pending`: registrado, pero todavía no iniciado.
- `in-progress`: se está abordando.
- `done`: resuelto o implementado.
- `discarded`: descartado conscientemente, con el motivo documentado.

No es obligatorio crear un índice común. Los elementos pueden localizarse por
su carpeta, nombre, tipo o metadatos.

## Formato de los elementos

Usa un identificador estable y un nombre descriptivo con este patrón:

```text
BL-YYYYMMDD-HHMM-slug.md
```

Si ya existe el mismo nombre, añade un sufijo breve sin reutilizar otro
identificador. El identificador no cambia al mover el archivo entre estados.

El contenido mínimo recomendado es:

```markdown
# Título breve

- ID: BL-YYYYMMDD-HHMM-slug
- Tipo: finding
- Estado: pending
- Prioridad: media
- Creado: YYYY-MM-DD
- Referencias: ruta, símbolo o contexto relevante

## Contexto

Qué se observó, cuándo apareció y por qué no se aborda ahora.

## Próximo paso

Qué habría que investigar, cambiar o decidir al retomarlo.

## Criterios de cierre

Cómo sabremos que el elemento está resuelto, si se puede concretar.
```

El campo `Estado` debe coincidir con la carpeta. Si faltan datos no
imprescindibles, registra lo conocido e indica qué queda por aclarar; no
inventes requisitos, decisiones de producto ni referencias. No incluyas
secretos, credenciales ni datos personales innecesarios en un documento
versionado.

## Sugerencias proactivas

Aunque la persona no diga «apúntalo», el agente puede proponer registrar un
elemento cuando detecte un problema reproducible, una limitación observable o
una mejora concreta que:

- tenga evidencia suficiente y un siguiente paso razonable;
- quede fuera del alcance de la tarea actual; y
- sea trabajo futuro accionable, no una preferencia o una opinión.

Antes de sugerirlo, busca coincidencias en `pending/` e `in-progress/`. Si ya
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
   en `pending` salvo que la persona indique otro estado.
3. Capturar el contexto suficiente, el tipo solicitado y el siguiente paso.
4. Informar de la ruta y del identificador creado o actualizado.
5. Continuar la tarea que estaba realizando.

Registrar un elemento no autoriza a investigar, corregir código, cambiar el
alcance de la tarea actual, crear un cambio OpenSpec ni hacer un commit.

Cuando la persona pida revisar el backlog, lista los elementos relevantes y
permite filtrarlos por tipo o estado. Cuando pida abordar un identificador,
lee su documento, muévelo a `in-progress` y actualízalo conforme avance el
trabajo. Al resolverlo o descartarlo, muévelo a `done` o `discarded`, actualiza
el campo `Estado` y conserva la referencia al commit, PR, cambio OpenSpec o
motivo cuando exista.

Si el elemento revela una decisión funcional, arquitectónica, de datos,
seguridad o una integración relevante, propone o utiliza OpenSpec según
[`workflows/feature.md`](../workflows/feature.md) y enlaza el cambio desde el
elemento de backlog. El backlog no sustituye esa especificación.

## Límites frente a otras fuentes

- **Backlog**: trabajo futuro accionable pendiente de abordar.
- **Memoria**: conocimiento duradero y difícil de redescubrir, como causas de
  bugs, workarounds o enfoques descartados; consulta [`memory.md`](memory.md).
- **Historial**: resumen de cómo terminó una iteración y cómo retomarla;
  consulta [`history.md`](history.md).
- **OpenSpec**: requisitos, escenarios y diseño de cambios relevantes;
  consulta [`workflows/feature.md`](../workflows/feature.md).
- **Changelog**: hitos publicados por el proyecto.

No copies transcripciones de sesiones ni dupliques en el backlog información
que ya tenga una fuente autoritativa. Enlaza esa fuente cuando el pendiente
dependa de ella.

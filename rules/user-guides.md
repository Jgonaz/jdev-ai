# Guías de uso por proyecto

La política pertenece al harness, pero cada proyecto guarda sus guías para
personas bajo `docs/user-guides/` y las versiona en su propio repositorio. Estas
guías explican cómo entender y utilizar una funcionalidad sin exigir contexto
previo; no contienen instrucciones para agentes ni documentación interna de la
implementación.

## Cuándo crear o actualizar una guía

Al desarrollar o modificar una funcionalidad, valora si una explicación
didáctica ayudaría a un desarrollador o usuario a recordarla y utilizarla más
adelante. Una guía suele aportar valor cuando existe:

- un flujo con varios pasos o que se utiliza con poca frecuencia;
- una sección cuyo propósito o funcionamiento no resulta evidente;
- reglas de negocio, estados, filtros o permisos visibles que puedan confundir;
- una operación con limitaciones, errores habituales o edge cases relevantes;
- conocimiento necesario para usar la funcionalidad que no debería deducirse
  leyendo el código.

No crees una guía por cada feature. Omítela para cambios internos, triviales o
autoevidentes, y evita documentación preventiva sin una necesidad concreta. No
crees `docs/user-guides/` hasta que exista una primera guía con contenido real.

Cuando cambie un comportamiento documentado, actualiza en la misma tarea las
guías afectadas. Si una guía deja de ser útil o correcta, corrígela o elimínala.

## Cómo escribirlas

Escribe en castellano de España salvo que el proyecto indique otro idioma. Usa
lenguaje natural, sencillo y didáctico, como si el lector no recordase el
contexto previo. Mantén cada guía centrada en una necesidad concreta y explica,
cuando resulte útil:

- para qué sirve y cuándo se utiliza;
- los conceptos mínimos necesarios;
- su funcionamiento desde el punto de vista de la persona;
- los pasos para utilizarla, con ejemplos sencillos;
- estados, limitaciones, errores habituales y formas de resolverlos.

No describas archivos, clases o detalles internos salvo que la audiencia los
necesite para realizar la tarea. No copies requisitos ni conviertas la guía en
una referencia exhaustiva. Prefiere ejemplos claros y una estructura que pueda
leerse desde cero.

## Separación de responsabilidades

- OpenSpec define qué comportamiento debe tener una funcionalidad relevante.
- Las guías explican a una persona cómo comprenderla y utilizarla.
- La documentación técnica o los ADR describen arquitectura e implementación.
- La memoria conserva conocimiento histórico difícil de redescubrir.
- El historial recuerda cómo terminó una iteración y cómo continuarla.
- `AGENTS.md` contiene reglas permanentes para los agentes.

Las guías son documentación oficial del proyecto y prevalecen sobre memoria e
historial. No dupliques contenido: enlaza la fuente autoritativa cuando una
explicación completa ya exista en otro lugar.

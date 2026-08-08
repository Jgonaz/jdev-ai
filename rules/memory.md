# Memoria por proyecto

La política de memoria pertenece al harness, pero cada proyecto guarda su
contenido bajo `.agent/memory/` y lo versiona en su propio repositorio. La
memoria es un mecanismo auxiliar basado en Markdown, agnóstico al agente y sin
dependencias, servicios ni almacenamiento externo.

## Consulta selectiva

No leas automáticamente la memoria ni su `index.md` al iniciar una sesión o una
tarea. Consúltala solo cuando pueda aportar contexto histórico no evidente, por
ejemplo ante una decisión o investigación anterior, un bug extraño, un enfoque
descartado, un workaround o una limitación difícil de deducir.

Para una tarea trivial o autocontenida, no consultes la memoria. Cuando resulte
relevante:

1. Busca primero términos relacionados con la tarea mediante `rg` u otra
   búsqueda textual local.
2. Abre únicamente los fragmentos y archivos pertinentes.
3. Usa `index.md` para localizar contenido solo cuando ayude a acotar la
   búsqueda.

Nunca cargues indiscriminadamente todos los archivos de memoria.

## Escritura

Guarda únicamente conocimiento duradero, no trivial, probablemente reutilizable
y costoso de redescubrir que no sea evidente en el código ni tenga una ubicación
oficial más apropiada. Son buenos candidatos:

- la causa real de un bug difícil o un edge case importante;
- comportamiento inesperado de una librería, framework, API o servicio externo;
- un workaround necesario y su motivo;
- un enfoque razonable probado y descartado, junto con la causa;
- restricciones del entorno, dependencias o efectos secundarios poco evidentes.

No uses la memoria como diario. No guardes resúmenes rutinarios, listas de
archivos o cambios realizados, información deducible del código, entradas de
changelog, requisitos funcionales, reglas permanentes ni documentación
duplicada. No escribas memoria automáticamente al terminar una tarea.

Crea un archivo temático solo cuando exista contenido real que lo justifique y
añade entonces a `index.md` una descripción de una línea. El índice sirve
exclusivamente para localizar archivos: no acumules resúmenes en él. Mantén
tanto el índice como las entradas pequeños y centrados en conocimiento
reutilizable.

## Autoridad y promoción

Las fuentes autoritativas prevalecen siempre:

`AGENTS.md` / OpenSpec / documentación oficial / código > `.agent/memory/`

La memoria puede quedar obsoleta. Si contradice una fuente actual, corrígela o
elimínala. Promueve el conocimiento cuando encuentre una ubicación estable:

- una regla general, a `AGENTS.md`;
- un requisito o comportamiento funcional, a OpenSpec;
- una decisión arquitectónica importante, a la documentación o ADR del proyecto;
- un cambio relevante, al changelog definido por el proyecto;
- documentación estable, a los documentos oficiales correspondientes.

Después de promoverlo, elimina o reduce la entrada si mantenerla produce
duplicación. No ignores `.agent/memory/`: debe poder versionarse junto al
proyecto al que pertenece.

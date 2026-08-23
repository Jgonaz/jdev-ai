## Context

El harness ya separa las reglas compartidas, el historial local, la memoria auxiliar y OpenSpec, y los proyectos anidados conservan sus propios repositorios Git. La nueva capacidad debe funcionar sin asumir stack, gestor de paquetes ni un servicio externo. Consulta `proposal.md` y `specs/project-backlog/spec.md` para la motivación y el contrato observable.

## Goals / Non-Goals

**Goals:**

- Hacer que la convención sea descubrible desde las instrucciones globales y el README del harness.
- Mantener el backlog como Markdown legible, versionado en el proyecto y fácil de editar o revisar manualmente.
- Usar el árbol de carpetas como fuente de verdad del ciclo de vida, con un archivo independiente por elemento.
- Permitir que el agente registre, consulte y retome elementos mediante instrucciones naturales sin introducir una herramienta adicional.

**Non-Goals:**

- Crear una aplicación, parser, CLI o integración con gestores de incidencias.
- Hacer que el launcher inspeccione o muestre el backlog.
- Crear automáticamente `docs/backlog/` en todos los proyectos existentes.
- Sustituir OpenSpec, la memoria auxiliar, el historial o el changelog.

## Decisions

### La convención vive en el harness y los datos viven en cada proyecto

Se añadirá `rules/backlog.md` como fuente normativa y se enlazará desde `AGENTS.md`, `README.md` y `rules/README.md`. Los elementos solo se crearán bajo `docs/backlog/` del proyecto afectado. Esto evita mezclar datos de proyectos en el repositorio principal y permite que cada repositorio funcione de forma independiente.

Alternativas consideradas: una carpeta global del harness, descartada porque rompería el aislamiento Git de `projects/`; y reglas copiadas a cada proyecto, descartadas porque divergirían y obligarían a sincronizar documentación.

### Una carpeta por estado y un archivo por elemento

Los estados físicos serán `pending/`, `in-progress/`, `done/` y `discarded/`. El agente moverá el archivo entre carpetas y mantendrá una línea de estado dentro del documento para que sea legible fuera de su ruta. Un archivo por elemento facilita la revisión, evita conflictos sobre un índice común y permite mover o cerrar elementos sin reescribir todo el backlog.

Alternativas consideradas: un único `backlog.md`, descartado por conflictos y crecimiento; y subcarpetas por tipo, descartadas porque multiplicarían la taxonomía y harían más costoso cambiar de clasificación.

### Markdown estructurado sin front matter obligatorio

Cada archivo tendrá un identificador estable en el nombre, un título, metadatos en una lista Markdown y secciones para contexto y siguiente paso. El formato no dependerá de YAML, JSON ni de un parser: el agente podrá localizar elementos con búsqueda textual y una persona podrá editarlos con cualquier herramienta.

El nombre seguirá el patrón `BL-YYYYMMDD-HHMM-slug.md`; si se produce una colisión, se añadirá un sufijo breve. El identificador no cambiará al mover el archivo.

### Registro explícito y de alcance mínimo

Solo una instrucción explícita de registro («apunta», «anota», «registra», «déjalo para después») creará un elemento. El agente capturará lo conocido, señalará los datos pendientes y devolverá la ruta o identificador. Registrar no implica investigar, corregir, crear código, cambiar OpenSpec ni modificar la tarea en curso.

### Relación con otras fuentes

El backlog contendrá únicamente trabajo futuro accionable. Los descubrimientos que expliquen una limitación o workaround duradero seguirán perteneciendo a la memoria; el cierre de una sesión seguirá perteneciendo al historial; y los requisitos detallados de un cambio relevante se promoverán o enlazarán a OpenSpec. El elemento de backlog conservará la referencia de esa promoción o resolución.

## Risks / Trade-offs

- [Elementos obsoletos o duplicados] → Mantener identificadores, estados explícitos, referencias y una instrucción para revisar o descartar; no copiar transcripciones completas.
- [Colisiones entre agentes] → Un archivo independiente con nombre basado en fecha, hora y slug reduce el conflicto; una colisión se resuelve añadiendo un sufijo sin reutilizar identificadores.
- [Rutas o líneas que cambian] → Guardar también símbolos, contexto funcional y referencias de alto nivel, no depender únicamente de números de línea.
- [Backlog demasiado grande] → No se crea un índice central en esta versión; se filtra por carpetas, nombres y metadatos, y se deja la automatización para una necesidad futura demostrada.
- [Datos sensibles en un documento versionado] → La regla debe exigir que el agente no registre secretos, credenciales ni datos personales innecesarios.

## Migration Plan

No hay migración de datos ni despliegue. Tras aplicar la documentación del harness, cada proyecto podrá crear `docs/backlog/` al registrar su primer elemento. Para revertir la convención basta con retirar la regla y conservar o mover manualmente los documentos del proyecto; no se requieren cambios de código ni dependencias.

## Open Questions

Ninguna que afecte al contrato o a la implementación acordada. La eventual integración del launcher o de un gestor externo queda para una propuesta independiente si aparece una necesidad real.

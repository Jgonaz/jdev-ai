# Diseño previo en Claude Design

El agente no espera a que la persona pida diseños. Cuando una feature implique
cambios de interfaz considerables, propone cerrar antes los diseños en Claude
Design y no empieza a implementar esa interfaz hasta que la persona responda.

## Cuándo proponerlo

Propónlo cuando el cambio de interfaz no sea trivial, por ejemplo:

- pantallas, vistas o flujos nuevos;
- rediseños o reorganizaciones de layout de una pantalla existente;
- componentes nuevos con varios estados (vacío, carga, error, permisos);
- cambios que afecten al comportamiento responsive o a la navegación.

No lo propongas para ajustes de textos, colores o espaciados puntuales,
correcciones visuales que restauran lo esperado, cambios que reutilicen sin
alterarlos componentes y patrones existentes, o cuando ya exista un diseño
aprobado que cubra el cambio; en ese caso, úsalo como referencia.

## Cómo proponerlo

Haz la propuesta al planificar, antes de implementar, en pocas líneas: qué
pantallas o estados conviene diseñar y por qué. Si también proceden OpenSpec o
un worktree, propónlo todo a la vez. Si la persona la rechaza, no la repitas en
esa feature e implementa siguiendo el estilo y los componentes existentes.

## Con el diseño cerrado

- Si el agente puede crear diseños de Claude Design, como Claude Code, los
  prepara con la persona; si no, la persona los hace y le pasa la URL.
- El diseño se da por cerrado cuando la persona lo aprueba de forma explícita.
- Su URL es la referencia de la implementación y del QA
  ([`delegation.md`](delegation.md)). Si el cambio usa OpenSpec, anótala en sus
  artefactos.
- Si al implementar aparece algo que el diseño no resuelve, consulta a la
  persona en lugar de inventarlo.

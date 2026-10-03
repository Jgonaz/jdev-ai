# Historial de iteraciones

La política pertenece al harness, pero cada proyecto guarda su historial local
bajo `.agent/history/`. Sus entradas son Markdown, agnósticas al agente y deben
estar ignoradas por el Git del proyecto.

El historial ayuda a recordar qué ocurrió y cómo continuar; no es una fuente de
verdad, una transcripción del chat ni documentación permanente.

## Cuándo registrar

Antes de finalizar una iteración relevante, crea una entrada en el proyecto
afectado. Registra una iteración cuando haya producido trabajo o contexto que
sería útil recuperar días después, por ejemplo:

- una implementación, investigación o debugging sustancial;
- una decisión relevante o un enfoque acordado;
- trabajo que queda en curso o bloqueado;
- commits, validaciones o pasos operativos importantes;
- una conversación de diseño que determine la continuación.

No registres preguntas sencillas, correcciones mínimas, consultas rutinarias de
estado, mensajes aislados ni conversaciones sin decisión o resultado. No crees
una entrada por cada mensaje y no guardes secretos ni transcripciones.

## Formato

Usa un archivo por iteración con un nombre ordenable y descriptivo:

`YYYY-MM-DD-HHMM-descripcion-breve.md`

`.agent/history/` solo contiene estas entradas. No guardes en él artefactos de
trabajo (datos, scripts, capturas, exportaciones ni copias de seguridad): al
estar ignorado por Git se perderían sin aviso y dificultarían retomar el
proyecto. Si el proyecto no define dónde van, pregunta antes de crearlos.

Mantén la entrada compacta, normalmente entre 100 y 250 palabras, y usa esta
estructura:

```markdown
# Título breve

Fecha: YYYY-MM-DD HH:MM
Estado: finalizada | en curso | bloqueada

## Resumen

- Qué se buscaba y cómo terminó, en palabras sencillas.
- Resultado y contexto imprescindible.

## Decisiones

- Decisiones relevantes, si existen.

## Referencias

- Commits, cambio OpenSpec o documentos relacionados, si existen.

## Pendiente de ti

- Decisiones, pruebas o acciones que solo puede hacer la persona, si existen.

## Continuación recomendada

- Acción concreta para retomar el trabajo.
```

Escribe `Fecha:` y `Estado:` exactamente con ese formato y uno de esos tres
valores, sin texto adicional en la misma línea: el resumen de inicio del
launcher los lee para mostrar la última sesión.

Redacta pensando en alguien que vuelve al proyecto semanas después y no
recuerda nada; el resumen de inicio muestra el título, los dos primeros puntos
del resumen, «Pendiente de ti» y la continuación:

- El título dice qué se hizo, no cómo se llama el archivo o la rama.
- El primer punto del resumen explica el objetivo y el resultado sin jerga
  interna; los detalles técnicos van después.
- La continuación se entiende por sí sola: nombra la funcionalidad o el
  archivo en lugar de «lo anterior» o «el fix», y empieza por un verbo.
- «Pendiente de ti» recoge solo lo que bloquea o espera a la persona, como una
  decisión de producto, una prueba manual o un despliegue.

Omite secciones opcionales vacías. Resume resultados y motivos; no copies listas
de archivos, diffs, requisitos, documentación ni contenido ya disponible en
otras fuentes.

## Consulta

No cargues todo el historial al iniciar una sesión. Cuando el usuario pregunte
qué se hizo, cómo acabó una sesión o en qué se trabajó durante un periodo:

1. Localiza primero las entradas por nombre y fecha.
2. Lee solo la última entrada o el intervalo solicitado.
3. Contrasta su estado y referencias con Git, OpenSpec y la documentación actual.

También puedes consultar la entrada más reciente cuando una tarea continúe
claramente un trabajo anterior. Si el historial contradice una fuente actual,
considera el historial obsoleto.

## Puesta al día

Cuando la persona pida ponerse al día o retomar el proyecto («ponme al día»,
«¿dónde lo dejé?», «¿qué estaba haciendo?»), reconstruye el contexto antes de
proponer trabajo:

1. Lee las dos o tres últimas entradas del historial, por fecha y hora.
2. Revisa los commits posteriores a la última entrada, los cambios locales sin
   commit, los cambios OpenSpec activos y sus tareas, y los elementos de
   `docs/backlog/in-progress/` si existen.
3. Contrasta el historial con esas fuentes y señala cualquier contradicción.

Responde en lenguaje llano y breve, con este orden:

- **En qué estabas**: objetivo del trabajo reciente y por qué importaba.
- **Qué decidiste**: decisiones relevantes y dónde consultarlas.
- **Cómo quedó**: lo terminado y lo que quedó a medias o bloqueado.
- **Pendiente de ti**: lo que espera una decisión o acción de la persona.
- **Siguiente paso**: una acción concreta para empezar ahora.

No modifiques archivos durante la puesta al día ni empieces el siguiente paso
sin que la persona lo pida.

## Separación de responsabilidades

- Los requisitos y cambios funcionales relevantes pertenecen a OpenSpec.
- El conocimiento duradero y difícil de redescubrir pertenece a la memoria.
- Los hitos publicados pertenecen al changelog definido por el proyecto.
- Las reglas permanentes pertenecen a `AGENTS.md`.
- El historial conserva únicamente el cierre y la continuidad de iteraciones.

Si una conclusión del historial merece sobrevivir como conocimiento estable,
promuévela a la ubicación correspondiente sin duplicarla.

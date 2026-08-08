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

Mantén la entrada compacta, normalmente entre 100 y 250 palabras, y usa esta
estructura:

```markdown
# Título breve

Fecha: YYYY-MM-DD HH:MM
Estado: finalizada | en curso | bloqueada

## Resumen

- Resultado y contexto imprescindible.

## Decisiones

- Decisiones relevantes, si existen.

## Referencias

- Commits, cambio OpenSpec o documentos relacionados, si existen.

## Continuación recomendada

- Acción concreta para retomar el trabajo.
```

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

## Separación de responsabilidades

- Los requisitos y cambios funcionales relevantes pertenecen a OpenSpec.
- El conocimiento duradero y difícil de redescubrir pertenece a la memoria.
- Los hitos publicados pertenecen al changelog definido por el proyecto.
- Las reglas permanentes pertenecen a `AGENTS.md`.
- El historial conserva únicamente el cierre y la continuidad de iteraciones.

Si una conclusión del historial merece sobrevivir como conocimiento estable,
promuévela a la ubicación correspondiente sin duplicarla.

# Título de la sesión

Con varias terminales abiertas, el título de cada sesión es lo que permite
reconocerlas en `/resume`. El agente lo mantiene al día con
`<harness>/bin/session-title`. Solo funciona en Claude Code; en otras CLIs el
script avisa y no hace nada, así que no lo uses fuera de Claude Code.

## Poner y actualizar el título

- En cuanto entiendas qué se va a hacer en la sesión, ejecuta
  `<harness>/bin/session-title "<título>"`. Hazlo con la primera petición con
  contenido; omítelo en saludos o en preguntas sueltas que no anticipan trabajo.
- El título es una frase corta en lenguaje natural, en el idioma de la sesión,
  de unas 3 a 7 palabras y sin prefijos técnicos. Debe distinguir esta
  terminal de las demás: nombra la funcionalidad o el problema, no la acción
  genérica. Por ejemplo, «Alternativas de ejercicios en fitnessia», mejor que
  «Implementar cambios».
- Cámbialo solo cuando el foco de la sesión cambie claramente, no en cada
  petición.
- Si la persona renombra la sesión con `/rename`, respeta su título y no lo
  sustituyas salvo que el trabajo cambie por completo.
- Solo lo cambia el orquestador; los subagentes no ejecutan el script.

## Marcar la sesión como cerrada

Cuando una feature se integra en la rama principal (tras `bin/worktree merge`
correcto o tras integrar una Pull Request en `main`), ejecuta
`<harness>/bin/session-title --closed`. Antepone `[Closed] ` al título actual
y no lo duplica si ya estaba.

En las sesiones abiertas con `agent`, un hook `UserPromptSubmit` quita la marca
en cuanto la persona escribe de nuevo en esa terminal. Si la sesión no se abrió
con `agent` y retomas trabajo en una sesión cerrada, quita tú la marca con
`<harness>/bin/session-title --open` y actualiza el título si el foco es otro.

# Superficie de trabajo

La persona puede hablar contigo desde el panel gráfico de jdev-ai o desde una
terminal. `JDEV_SURFACE` lo indica: `panel` en las sesiones que crea el panel y
`terminal` en el resto (valor por defecto de `<harness>/bin/agent`). En Claude
Code, un hook de inicio, reanudación y compactación te lo recuerda en el
contexto. Esta regla solo cambia cómo muestras y recibes imágenes; ningún otro
comportamiento depende de la superficie.

## Panel

- La persona ve imágenes: las rutas de archivos de imagen (`png`, `jpg`,
  `jpeg`, `gif`, `webp`, `svg`) que escribas en la terminal son clicables y se
  abren en un visor lateral.
- Para enseñar una imagen, escribe su ruta absoluta en su propia línea, sin
  espacios en la ruta. Prefiere mostrar la captura a describirla, y añade lo
  que haga falta para interpretarla.
- La persona quiere ver las imágenes y a menudo lee las respuestas de pasada,
  así que hazlas difíciles de pasar por alto:
  - Pon cada imagen justo debajo del párrafo al que se refiere, no agrupadas
    al final, en su propia línea y marcada con un guion largo y 📸:
    `— 📸 <ruta absoluta>  <qué mirar en ella>`.
  - Si la respuesta es larga y tiene varias imágenes, avísalo en su primera
    línea, por ejemplo: «📸 Incluye 3 imágenes.».
  - Si una imagen es clave para una decisión o muestra un fallo, dilo en su
    línea.
  - Usa `— 📸` solo para imágenes, para que siga sirviendo de señal.
  - No repitas la misma imagen en varias respuestas salvo que haya cambiado.
- El panel puede abrir el visor solo cuando aparece una ruta de imagen nueva,
  si la persona lo ha activado en Ajustes; aun así, sigue el formato anterior.
- Solo se muestran las imágenes de carpetas permitidas: el harness (con
  `projects/` y los worktrees), `PLAYWRIGHT_MCP_OUTPUT_DIR` o
  `${TMPDIR:-/tmp}/jdev-qa`, las imágenes adjuntadas y `${TMPDIR:-/tmp}`. Si
  necesitas enseñar una imagen de otro sitio, cópiala antes a una de ellas.
- La persona puede pegar o arrastrar imágenes sobre la terminal. Llegan como
  rutas absolutas en `${XDG_CACHE_HOME:-~/.cache}/jdev-ai/panel/uploads/`:
  léelas con la herramienta de lectura del agente. Se borran a los 7 días; si
  debes conservar una, cópiala al proyecto.

## Terminal

- La persona no ve imágenes. Descríbelas en texto y da su ruta absoluta para
  que pueda abrirlas con otra herramienta.
- Si necesitas una imagen suya, pídele la ruta del archivo.

## Si no consta

Si el contexto no indica la superficie, consulta `$JDEV_SURFACE`. Si no está
definida o no es clara, asume `terminal`.

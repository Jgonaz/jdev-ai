# Generación de imágenes

El agente no espera a que la persona pida imágenes: cuando un desarrollo las
necesite, propone generarlas. La generación consume la cuenta de OpenAI del
desarrollador, así que solo se ejecuta tras su confirmación explícita.

## Cuándo proponerlo

Propón generar imágenes cuando la tarea necesite recursos gráficos raster que
el proyecto no tenga, por ejemplo:

- ilustraciones, fondos o imágenes de cabecera;
- imágenes de producto, avatares o contenido de ejemplo realista;
- imágenes para compartir en redes (Open Graph) o material promocional;
- huecos visuales que de otro modo quedarían como placeholders genéricos.

No lo propongas cuando el proyecto ya tenga recursos adecuados, el cambio no
tenga parte visual, o el recurso encaje mejor como SVG, CSS o icono de la
librería que ya use el proyecto. Respeta el estilo y los recursos existentes.

## Cómo proponerlo

Haz la propuesta en una línea breve, sin interrumpir la tarea en curso: qué
imágenes, para qué, con qué estilo y dónde se guardarían. Agrupa en una sola
propuesta las imágenes de una misma tarea. Si la persona la rechaza, no la
repitas en esa tarea.

## Cómo generarlas

- **Codex** usa su herramienta integrada `image_gen`.
- **Otros agentes**, como Claude Code, delegan en Codex desde la terminal:

  ```sh
  codex exec --skip-git-repo-check -s workspace-write -C <carpeta-destino> \
    "Usa tu herramienta integrada de generación de imágenes (no dibujes con \
  código ni scripts) para crear <descripción>. Guarda el resultado como PNG \
  en <carpeta-destino>/<archivo>.png. Responde solo con la ruta final."
  ```

  Pide explícitamente la herramienta integrada: con prompts sencillos, Codex
  puede dibujar la imagen con código en lugar de generarla. Codex guarda el
  original en `~/.codex/generated_images/` y lo copia a la ruta indicada.

Guarda las imágenes en la carpeta de recursos que defina el proyecto. Si no
existe, pregunta dónde guardarlas antes de crearla. Revisa el resultado antes
de integrarlo y no incluyas secretos ni datos personales en los prompts.

## Context

- La vista chat ya lee de forma incremental la conversación principal de cada sesión de Claude del panel:
  - en el servidor, `GET /api/sessions/:nombre/conversation` y `parseAgentLines` en modo conversación, dentro de `server/follow.ts`;
  - en el cliente, `lib/useConversation.ts`, con un polling de 1 s.

  Sus eventos `tool` y `result` traen el nombre de la herramienta, el verbo, el objetivo, la hora, el id de emparejamiento y si ha fallado.
- La cabecera de la terminal ya conoce el porcentaje de contexto, el modelo y los subagentes y shells activos, a partir de la statusline y del estado de la sesión.
- El panel derecho de Terminales (`ContextPanel`) comparte hueco y ancho con el visor de imágenes (`usePanelWidth('terminales-derecho')`). En columnas estrechas pasa a superposición.
- lot-map (MIT) separa la clasificación (`hooks/classify.ts`, función pura `classify(tool, input, setup)`), el dibujo (`hooks/draw.ts`, `drawMap(board, now, setup)` → cadena SVG) y la lista de filas (`hooks/feed.ts`). Su estado (`Board`) lo alimentan los hooks de Claude Code y su API de paneles, que no existen en el panel.

## Goals / Non-Goals

**Goals:**

- Ver de un vistazo qué hace la sesión activa y dónde ha ido el trabajo, sin leer la terminal.
- Reutilizar los datos y la lectura que ya existen, sin más accesos a disco.

**Non-Goals:**

- Instalar o depender del plugin lot-map, o portar su vista para terminal, sus siete idiomas y sus opciones.
- Estación Hooks: los hooks que rechazan o tardan no dejan un rastro fiable en el transcript.
- Las llamadas propias de los subagentes. Solo se ve un punto por subagente activo. Su detalle sigue en la pestaña de seguimiento.
- Codex y otros agentes, que no tienen un vínculo fiable con su transcript (el mismo límite que el chat).
- Persistir el mapa: se reconstruye desde la conversación cada vez que se abre.

## Decisions

### Datos: los eventos de la conversación, no hooks nuevos

- El mapa se deriva en el cliente de los mismos eventos que pide la vista chat. Así no hacen falta hooks nuevos ni tocar la configuración de Claude, y el comportamiento es igual en sesiones nuevas y retomadas.
- Alternativa descartada: añadir eventos a `bin/session-state`. Daría la hora exacta de inicio y los rechazos de hooks, pero llena el estado de sesión de eventos de alta frecuencia y solo funcionaría en sesiones lanzadas tras el cambio. Queda como mejora si la estación Hooks resulta necesaria.
- Si el chat y el mapa de la misma sesión están abiertos, comparten la suscripción a la conversación en lugar de hacer dos pollings.

### Clasificación en el servidor

- El evento `tool` gana un campo opcional `station`. El servidor lo calcula con la entrada completa de la herramienta (el comando entero de Bash, la URL, la ruta). El cliente solo tiene el `target` recortado a 200 caracteres.
- La clasificación es una adaptación de `classify.ts` a un módulo sin dependencias en `panel/shared/`, con nuestros nombres de herramientas, MCP y agentes. Por ejemplo, las herramientas `mcp__playwright__*` van a Navegador y `Agent` y `Workflow` a Agentes.
- Memoria: la carpeta de memoria de Claude y `.agent/memory/` de los proyectos.
- Modelo: un pulso por cada mensaje del agente o lote de herramientas de una misma respuesta. El transcript no expone otra cosa sin leer el uso línea a línea.
- Tú: cada evento `user` o `command`.

### Estado y dibujo en el cliente

- Una función pura `buildBoard(events, now)` produce el estado del mapa: llamadas en marcha, usos por estación, ruta, errores desde el último mensaje de la persona y filas. Se prueba con fixtures de eventos, sin DOM.
- El dibujo es un componente React que pinta SVG. La geometría y los tiempos (la ruta dura 40 s y se desvanece en 20, las manecillas dan una vuelta en un minuto y en diez) se adaptan de `draw.ts`. Los colores son variables CSS del tema activo, no la paleta de lot-map.
- La animación usa `requestAnimationFrame` solo mientras la vista es visible y hay algo en movimiento. En reposo no pinta. Con `prefers-reduced-motion`, se queda en encendidos y fundidos.
- Accesibilidad: el SVG es decorativo (`aria-hidden`) y la lista de actividad es el equivalente textual, con un `aria-live` educado solo para la línea de «ahora».

### Aspecto visual

- Diseño aprobado: https://claude.ai/artifact/8RYqgAJtYUdDoSo89TNFtG (artboard `Main` y sus variantes).
- Las estaciones son discos de 40 px con un icono de trazo, el nombre en monoespaciada y los usos debajo. Están en un círculo de radio 118 alrededor de un núcleo de radio 41, que lleva el anillo de contexto de radio 50, «CLAUDE», el modelo y el porcentaje.
- El acento de lo activo es `--agent-claude`: halo, aro, pulsos, último tramo de la ruta, puntos de subagentes y aro del núcleo mientras hay trabajo. Memoria lleva su propio tinte. Los errores, `--danger`.
- Los nombres, contadores y textos son HTML superpuesto al SVG. El SVG solo lleva radios, ruta, anillos, halos y pulsos.

### Ubicación

- Selector «Contexto | Mapa» en la cabecera del panel derecho. La última opción elegida se recuerda en los ajustes locales del panel. El mapa sigue a la pestaña activa y, en una pestaña de seguimiento, a la sesión que la lanzó, igual que Contexto.
- Asunción declarada y reversible: si el diseño resuelve otra ubicación (por ejemplo, una pestaña propia), se cambia sin afectar al resto.

### Licencia

- Los archivos adaptados de lot-map llevan en la cabecera su origen y el aviso MIT completo (© 2026 Aleksei Volodin). El README lo cita en créditos.

## Risks / Trade-offs

- [El formato del transcript cambia] → Cada campo se lee de forma opcional y lo desconocido se ignora, como en el chat. Una herramienta sin clasificar va a Shell o se omite, sin romper la vista.
- [Retraso del polling, de 1 s o más] → Aceptable para una vista de contexto. El pulso nace con la hora del evento, y si ya terminó, se dibuja directamente como hecho.
- [Coste de la primera carga en sesiones largas] → Se reutiliza la carga por trozos del chat. El mapa solo necesita agregados, así que los eventos antiguos no se guardan enteros.
- [Coste de la animación] → Se pinta solo con la vista visible y algo en movimiento. Hay test de que en reposo no hay frames.
- [Etiquetas con datos sensibles] → Se muestran solo nombres (el archivo, el host de una URL, el nombre del comando), nunca contenidos, como hace lot-map con `hostOf` y `clean`.


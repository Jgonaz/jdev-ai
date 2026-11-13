## Why

Para saber qué está haciendo una sesión de Claude hoy hay que leer la terminal o el chat línea a línea. Un mapa en directo, como el del mod [lot-map](https://github.com/alexeyw/lot-map) (MIT), lo cuenta de un vistazo: a qué toca el agente (archivos, shell, red, subagentes…), cuánto lleva cada llamada, qué falla y por dónde ha ido el trabajo. Instalar lot-map tal cual no sirve, porque en el panel las sesiones se ven en xterm.js dentro de tmux, y ahí el mod solo muestra texto. En cambio, el panel ya lee en directo los mismos datos para la vista chat.

## What Changes

- **Vista «Mapa» en el panel derecho de Terminales**, junto a «Contexto». Comparte su hueco y su ancho, y se cambia de una a otra con un selector. Muestra la sesión activa.
- **Estaciones** alrededor de un núcleo central: Tú, Modelo, Memoria, Archivos, Shell, Red, Navegador, Agentes y Skills. Cada herramienta que usa la sesión lanza un pulso desde el centro hasta su estación y vuelve al terminar. Los errores y los rechazos se ven en rojo.
- **Lectura acumulada**: el grosor de cada radio crece con el uso y la ruta reciente une las últimas estaciones visitadas. Las llamadas que siguen en marcha muestran cuánto llevan. Varias llamadas a la vez llevan un contador (`×3`), y los errores dejan un contador rojo hasta el siguiente mensaje de la persona.
- **Contexto y subagentes**: un anillo alrededor del núcleo con el porcentaje de contexto, y un punto por cada subagente activo en la estación Agentes.
- **Actividad reciente** bajo el mapa: qué se está ejecutando ahora y las últimas filas, agrupando las llamadas consecutivas a la misma estación.
- **Respeta los temas y el movimiento reducido**: usa los colores del tema activo. Con `prefers-reduced-motion`, nada vuela ni gira: las estaciones se encienden y se apagan.
- Solo para sesiones de Claude lanzadas desde el panel. En el resto, la vista explica por qué no hay mapa.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: requisito nuevo «Mapa de actividad de una sesión».

## Impact

- **Servidor del panel:** el parser de la conversación (`server/follow.ts`) añade a cada evento `tool` su estación, calculada con la entrada completa de la herramienta. Es un campo opcional, así que no rompe el contrato de `GET /api/sessions/:nombre/conversation`. No hay endpoints ni lecturas de archivos nuevos.
- **Cliente del panel:** un componente del mapa (SVG) y su estado derivado de los eventos de la conversación, el selector «Contexto | Mapa» y estilos con los tokens de los seis temas.
- **Código de terceros:** se adapta la clasificación por estaciones y parte del dibujo de lot-map (MIT, © 2026 Aleksei Volodin). Se conserva su aviso de copyright y licencia en los archivos adaptados y se cita en el README.
- **Sin dependencias nuevas.**
- **Riesgos:** el formato del transcript es interno de Claude Code, el mismo riesgo que ya asumen el chat y el seguimiento. Además, el pulso empieza cuando la llamada queda escrita en el transcript, con algo más de 1 s de retraso por el polling.

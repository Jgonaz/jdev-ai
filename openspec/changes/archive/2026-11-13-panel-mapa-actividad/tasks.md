## 0. Checkpoint

- [x] 0.1 Diseño de la vista «Mapa» (en reposo, trabajando, con error, subagentes, sin datos, tema claro) aprobado en Claude Design: https://claude.ai/artifact/8RYqgAJtYUdDoSo89TNFtG

## 1. Servidor

- [x] 1.1 Módulo de clasificación en `panel/shared/` adaptado de lot-map, con aviso MIT y tests (archivos, shell, red, navegador, agentes, skills, memoria, etiquetas sin contenido)
- [x] 1.2 Campo opcional `station` en los eventos `tool` de la conversación y tests del parser

## 2. Cliente

- [x] 2.1 `buildBoard(events, now)` puro, con tests: llamadas en marcha y paralelas, errores hasta el mensaje de la persona, usos, ruta y filas agrupadas
- [x] 2.2 Suscripción compartida a la conversación entre el chat y el mapa
- [x] 2.3 Componente SVG del mapa con colores del tema, anillo de contexto y puntos de subagentes
- [x] 2.4 Animación solo visible y con movimiento, y movimiento reducido; test de que en reposo no hay frames
- [x] 2.5 Lista de actividad bajo el mapa, accesible
- [x] 2.6 Selector «Contexto | Mapa» recordado, seguimiento de la pestaña activa y estados sin datos

## 3. Documentación y validación

- [x] 3.1 `README.md` y `README.en.md` con la vista y los créditos de lot-map
- [x] 3.2 Valorar actualizar el panel simulado de la landing: no se actualiza, porque no muestra el panel derecho
- [x] 3.3 QA de punta a punta en el panel con una sesión real
- [x] 3.4 `pnpm typecheck`, `pnpm test`, `bin/check` y `openspec validate --strict`

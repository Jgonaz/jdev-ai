## Context

- Hoy `ContextPanel` alterna entre dos vistas con `RightViewSwitch` y `prefs.rightView`. La vista Mapa es `MapPanel` → `ActivityMap`, que pinta el mapa, la línea de «ahora» y la lista de filas. La vista Contexto muestra la cabecera con el proyecto, «Sesión», «Adjuntar desde otra terminal» y «Backlog e historial».
- El mapa ocupa unos 330 px de geometría, más la línea de «ahora». Con 16 filas abiertas, el panel necesita scroll.
- El panel ya tiene `Disclosure.tsx` (`src/components`), un desplegable reutilizable.

## Goals / Non-Goals

**Goals:**

- Que el mapa sea lo primero y esté siempre a la vista, sin cambiar de vista.
- Que el contexto de la sesión siga a un clic.

**Non-Goals:**

- Cambiar el mapa, la clasificación o el sondeo.
- Cambiar el botón que abre y cierra el panel derecho, su ancho o la superposición en columnas estrechas.

## Decisions

- **Orden:** nombre de la sesión y agente, mapa, línea de «ahora», «Actividad reciente (N)» y «Sesión». La sesión va al final porque es lo que menos cambia.
- **Desplegables:** `Collapsible` nuevo (`Disclosure` es un menú emergente), con un botón con `aria-expanded`. Los dos empiezan abiertos, por decisión de la persona tras ver el panel. Su estado se recuerda en las preferencias locales del panel (`ui`), sustituyendo `rightView`. La preferencia vieja se ignora al leerla.
- **Sondeo:** la conversación se lee mientras el panel está visible, aunque la actividad esté plegada, porque el mapa sigue necesitándola.
- **Sin mapa:** se muestra «Sesión» abierta (sin desplegable) y, encima, una nota de una línea con el motivo. El recuadro grande «Sin mapa para esta sesión» desaparece, porque el panel ya tiene contenido útil.
- **Etiqueta del panel:** el `aside` se llama «Sesión y actividad».
- **Alineación:** el panel derecho (y el visor de imágenes, que comparte su hueco) empieza a la altura de las tarjetas de terminal, bajo la barra de pestañas (`--tabsbar-h` + `--gap-card`), igual que la superposición.
- **Etiquetas de las estaciones:** van hacia fuera del mapa. En Tú, Modelo y Skills se colocan encima del disco, porque su radio llega por abajo y las pisaba. Llevan un borde del color del fondo para separarlas de las curvas de la ruta, y quedan a 34 px del centro del disco, por fuera del halo y de las manecillas. El centro baja de 163 a 184 px y el dibujo pasa a medir 312×362 para que quepa la etiqueta de Tú. Los textos del núcleo se centran a partir del centro del mapa, no con una posición fija, y se compensa el espaciado entre letras de «CLAUDE». Esto ajusta el diseño aprobado del mapa.
- **Diseño:** se añaden recuadros al lienzo aprobado (https://claude.ai/artifact/8RYqgAJtYUdDoSo89TNFtG): el panel unificado con los desplegables cerrados, con los dos abiertos, y una sesión sin mapa.

## Risks / Trade-offs

- [La actividad queda menos a la vista] → La línea de «ahora» y el contador «(N)» del título siguen visibles, y el desplegable se recuerda abierto si la persona lo prefiere así.
- [Quien usaba Contexto como vista principal pierde el acceso directo] → Está a un clic y su estado abierto se recuerda.

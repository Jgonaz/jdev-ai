## Context

- El panel ya tiene sesiones con estado (`sessions.ts`, `/ws/events`), backlog (`backlog.ts`), historial (`history.ts`), worktrees y proyectos con monograma y color.
- El estado de sesión (`bin/session-state`) guarda el estado pero no el texto de la notificación.
- Diseño aprobado: `Inicio.dc.html` (saludo con «$ turno de …», chips de estado, «› necesita tu atención», tarjetas de proyecto en dos columnas con borde superior del color del proyecto, «› actividad reciente» en una columna lateral, retícula de puntos de fondo).

## Goals / Non-Goals

**Goals:**

- Saber al abrir el panel qué te necesita y dónde está el trabajo.
- Llegar en un clic a la terminal, al backlog o al historial adecuados.

**Non-Goals:**

- Acciones que escriban (mover, marcar, cerrar sesiones o borrar worktrees) desde Inicio; «Revisar» solo lleva a la terminal.
- Buscador global de la cabecera.
- Métricas o gráficas.

## Decisions

### Datos: `GET /api/overview`

Un único endpoint para no lanzar una petición por proyecto. Devuelve:

- `projects`: por cada proyecto, `{id, branch, backlog: {backlog, todo, inProgress}, worktrees, lastActivity, lastEntry: {title, state, file} | null}`.
- `history`: `{openPending, entriesWithPending}`.
- `recent`: las 8 entradas de historial más recientes.

Reutiliza `BacklogStore`, la lectura de historial y `worktreeDetails` con sus cachés. `lastActivity` es el máximo entre:

- el `updatedAt` de sus sesiones;
- la fecha de su última entrada de historial;
- el mtime más reciente de su `docs/backlog`.

El servidor lo calcula al pedirlo y lo reutiliza hasta el siguiente aviso de sesiones, backlog o historial (o 10 s, por las ramas y los worktrees, que no avisan). No hay un evento propio: el cliente lo vuelve a pedir, con debounce, con esos mismos avisos de `/ws/events`, al cambiar las sesiones del panel o la visibilidad de los proyectos y al enfocar la ventana. La actividad de las tarjetas se completa en el cliente con las sesiones en vivo. Las sesiones y sus estados siguen llegando por `/ws/events`.

### Mensaje de notificación

`bin/session-state` añade el campo `message` (JSON escapado, recortado a 300 caracteres) cuando el estado resultante es `waiting`, y lo deja vacío en el resto. El servidor lo expone en la sesión como `notice`. Los mensajes de Claude llegan en inglés y se muestran tal cual: traducirlos sería inventar.

### Saludo y ajustes

- Franjas horarias:

  | Horas | Saludo | Prefijo |
  |---|---|---|
  | 6–13 | «Buenos días» | «turno de mañana» |
  | 14–20 | «Buenas tardes» | «turno de tarde» |
  | 21–5 | «Buenas noches» | «turno de noche» |

  El prefijo lleva además el día abreviado (`$ turno de mañana · dom 01 nov`).
- Nombre: el ajuste `profile.name` o, si está vacío, el primer token de `git config user.name`, que el servidor lee una vez y expone en `/api/overview` como `gitName`. Si no hay ninguno, el saludo va sin nombre.
- El ajuste `startScreen` vale `inicio` o `terminales` y es **Inicio por defecto**, porque la pantalla está pensada como punto de entrada. Es reversible y se cambia en Ajustes.
- Con el saludo desactivado, el título es «Inicio».
- La retícula de puntos se muestra solo si está activada en personalidad.

### Cliente

- Ruta `#/inicio`, la navegación Inicio habilitada y el logo enlazando a Inicio. Una URL sin ruta respeta `startScreen`.
- Componentes según `Inicio.dc.html`, con los tokens del tema actual (sin colores fijos) y las animaciones (luces, cursor) que ya respetan los ajustes y `prefers-reduced-motion`.
- «Responder» y «Revisar» enfocan la sesión en Terminales (abren su pestaña). «Abrir terminales» abre las sesiones del proyecto en pestañas o, si no tiene, muestra Terminales. «Backlog» va a `#/proyectos/<id>`. El botón «+» abre Nueva sesión con el proyecto.
- El pendiente del historial lleva a `#/historial` con «Solo con Pendiente de ti» activado (escribiendo el filtro recordado). «Ver todo el historial» abre Historial sin filtros, y «Historial del proyecto» del panel de contexto de Terminales, solo con el filtro de ese proyecto; en los tres casos se conserva la vista recordada (por fecha o por proyecto).
- **Sesiones que esperan y proyectos ocultos.** Ocultar un proyecto no silencia lo que te necesita: las sesiones que esperan cuentan siempre, también las de proyectos ocultos, con el mismo criterio en la cabecera, el título de la pestaña, el chip «te espera» de Inicio y «Necesita tu atención», donde se muestran igual con la nota discreta «proyecto oculto». El resto de Inicio (tarjetas, recuentos de proyectos y worktrees, sesiones totales, «trabajando», «en reposo» y las cerradas que siguen abiertas) solo tiene en cuenta los proyectos visibles.
- «En reposo» son las sesiones inactivas cuyo proceso sigue vivo, marcadas `[Closed]` o no; una cerrada cuyo proceso terminó no cuenta.
- Al cambiar la visibilidad de un proyecto, Inicio vuelve a pedir `/api/overview` cuando el cambio ya está guardado. Como no hay aviso de ajustes entre pestañas, cada pestaña relee los ajustes al volver a la ventana (si no tiene cambios propios por guardar) y, con ellos, el resumen.
- «Tu nombre» se limpia igual en el cliente que lo valida el servidor (la regla vive en `shared/settings-schema.ts`): los caracteres de control y separadores de línea pasan a ser un espacio, los espacios repetidos se colapsan y el límite de 60 se cuenta en puntos de código; por encima, el campo muestra el error y no guarda.
- Las tarjetas se adaptan: en dos columnas desde 900 px de contenido, en una por debajo, y la actividad reciente baja debajo en anchos estrechos.

## Risks / Trade-offs

- **Coste de `/api/overview`** → reutiliza cachés por archivo y se recalcula con eventos, con debounce.
- **Mensajes de notificación en inglés** → se muestran tal cual, marcados como texto del agente.
- **Inicio por defecto cambia lo que ves al abrir el panel** → se puede volver a Terminales en Ajustes.
- **Nombre leído de Git** → solo el primer token y solo para el saludo. No sale de la máquina.

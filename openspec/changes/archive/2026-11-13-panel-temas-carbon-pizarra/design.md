## Context

Los temas son bloques `:root[data-theme=…]` de `panel/src/styles/tokens.css` con las mismas variables; el servidor valida el nombre del tema contra la lista de `panel/shared/settings-schema.ts`.

## Goals / Non-Goals

**Goals:**

- Un aspecto más sobrio en todo el panel, inspirado en un multiplexor de terminal de referencia, sin copiar su marca.
- Carbón por defecto y Pizarra como opción.

**Non-Goals:**

- Cambiar la estructura del panel, la navegación o el comportamiento de ninguna pantalla.
- Migrar los ajustes guardados.

## Decisions

- **Formas en todos los temas.** Pestañas, tarjetas y segmentados usan tokens (`--bg-card`, `--line-card`, `--line-card-active`, `--bg-seg`, `--bg-seg-on`), definidos en los seis temas. Mantener dos juegos de estilos se descartó.
- **El acento, escaso.** Queda para el cursor, el foco y los botones principales de diálogos; «Nueva sesión» y la pestaña activa dejan de usarlo.
- **Sin migración.** El valor por defecto cambia a Carbón, pero un ajuste guardado con otro tema se respeta.
- **La barra lateral conserva su estructura.** El diseño proponía dos bloques (proyectos y sesiones) y filas de una línea; la persona prefirió la estructura anterior con el estilo nuevo.
- **Un test fija la coherencia de los temas:** los seis definen las mismas variables y su texto llega a 4,5:1 sobre sus fondos.

## Risks / Trade-offs

- **El servidor en marcha no conoce los temas nuevos** → rechaza el cambio hasta reiniciarlo; se indica al publicar el cambio.
- **El borde de la tarjeta activa de Carbón contrasta poco (≈2:1)** → no es el único indicador: la pestaña activa va rellena.

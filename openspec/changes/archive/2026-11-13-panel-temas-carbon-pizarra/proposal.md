## Why

El panel se ha rediseñado con un aspecto más sobrio (pestañas en píldora, terminales y paneles como tarjetas, cabecera sin color de acento) y dos temas nuevos. La spec seguía diciendo que el tema por defecto es Grafito y no recogía los temas nuevos.

## What Changes

- **Tema Carbón**, casi negro y neutro, que pasa a ser el tema por defecto. Quien tuviera otro tema guardado lo conserva.
- **Tema Pizarra**, gris azulado, entre Grafito y un tono más claro.
- Grafito, Fósforo, Papel y Alto contraste siguen disponibles.
- Las formas nuevas se aplican a todos los temas. La estructura del panel no cambia.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `agent-panel`: la lista de temas de Ajustes y el tema por defecto.

## Impact

- **Cliente del panel:** tokens de los seis temas, estilos de cabecera, pestañas, tarjetas y barra lateral, y la tarjeta de cada tema en Ajustes › Apariencia.
- **Servidor del panel:** la lista de temas admitidos y el valor por defecto de los ajustes. Hay que reiniciarlo para que acepte los temas nuevos.
- **Landing:** su panel simulado se actualiza al aspecto nuevo.
- Diseño aprobado de referencia: https://claude.ai/artifact/XbvdKiZXY8pwWAqfNJj8aQ (la barra lateral conserva la estructura anterior, por decisión posterior de la persona).
- Sin dependencias nuevas.

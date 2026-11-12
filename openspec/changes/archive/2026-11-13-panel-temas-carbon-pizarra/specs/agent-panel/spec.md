## MODIFIED Requirements

### Requirement: Ajustes persistentes

El panel SHALL ofrecer una pantalla de Ajustes con tema (Carbón por defecto, Grafito, Pizarra, Fósforo, Papel y Alto contraste, y seguir el tema del sistema), color de acento, fuentes de interfaz, títulos y terminal, tamaños, opciones de terminal (cursor, distribución inicial, scroll, copiar al seleccionar), monograma, color y visibilidad por proyecto, interruptores de los detalles de personalidad, avisos y puerto. Los ajustes SHALL guardarse en un archivo de configuración del usuario fuera del repositorio y SHALL aplicarse sin reiniciar, salvo el puerto. Un tema guardado SHALL conservarse aunque cambie el tema por defecto. Cuando el sistema pida reducir el movimiento, las animaciones SHALL desactivarse aunque estén activadas.

#### Scenario: Cambio de tema

- **WHEN** la persona elige el tema Papel
- **THEN** todo el panel y las terminales cambian al tema claro y la elección se conserva al reabrir

#### Scenario: Tema por defecto

- **WHEN** la persona abre el panel sin ajustes guardados
- **THEN** el panel usa el tema Carbón

#### Scenario: Tema guardado antes del cambio de valor por defecto

- **WHEN** la persona tenía guardado el tema Grafito
- **THEN** el panel sigue usando Grafito

#### Scenario: Movimiento reducido

- **WHEN** el sistema operativo pide reducir el movimiento
- **THEN** el cursor del logo y las luces de estado dejan de animarse

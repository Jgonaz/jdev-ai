## 1. Servidor del panel

- [x] 1.1 Localización segura del transcript y los metadatos de un subagente y de la salida de una shell
- [x] 1.2 Interpretación de los eventos del subagente (encargo, herramientas con verbo, resultados, mensajes, resultado final)
- [x] 1.3 `GET /api/sessions/:name/follow/:kind/:id?from=` con lectura incremental y estado
- [x] 1.4 Pruebas con muestras reales y casos de seguridad (rutas fuera, enlaces, ids no válidos, archivos que encogen)

## 2. Cliente

- [x] 2.1 Pestañas de seguimiento en el espacio de trabajo y apertura desde los desplegables de los chips
- [x] 2.2 Vista de subagente según `Seguimiento.dc.html`
- [x] 2.3 Vista de shell con la salida en directo, sin secuencias ANSI
- [x] 2.4 «Seguir al final», sondeo y estado terminado
- [x] 2.5 Pruebas de la lógica pura

## 3. Documentación y validación

- [x] 3.1 README
- [x] 3.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 3.3 QA de punta a punta contra el diseño, si la persona da el visto bueno

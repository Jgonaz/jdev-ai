## 0. Proceso

- [x] 0.1 Revisión del cambio OpenSpec con la persona

## 1. Servidor del panel

- [x] 1.1 `server/mcps.ts`: fuentes, lectura segura, normalización por formato y lector mínimo de `config.toml`, con pruebas sobre fixtures
- [x] 1.2 Ocultación de secretos (env, cabeceras, query, argumentos, extra) y agrupación con aviso de diferencias, con pruebas
- [x] 1.3 Rutas `GET /api/projects/:id/mcps`, `GET /api/user-mcps` y `POST …/mcps/open`, con pruebas de la API (incluido que ningún valor secreto aparece en las respuestas)

## 2. Cliente

- [x] 2.1 Ruta `#/mcps/<proyecto>[/<mcp>]` y opción «MCPs» en el menú «Proyectos»
- [x] 2.2 Pantalla MCPs: barra lateral con recuentos y «Usuario», lista con secciones «Locales» y «Remotos», etiquetas de agente y aviso de diferencias
- [x] 2.3 Detalle por copia (archivo, transporte, comando o URL, nombres de variables y cabeceras, otros datos) y «Abrir en VS Code»
- [x] 2.4 Pruebas de la ruta y de la lógica del cliente

## 3. Cierre

- [x] 3.1 QA en el panel con el harness, un proyecto sin MCPs y Usuario
- [x] 3.2 Documentación del panel
- [x] 3.3 `bin/check`

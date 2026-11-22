## 0. Proceso

- [x] 0.1 Revisión del cambio OpenSpec con la persona

## 1. Servidor del panel

- [x] 1.1 `server/skills.ts`: descubrimiento de proyecto y de usuario, frontmatter, agrupación por nombre y comparación de copias, con pruebas sobre fixtures
- [x] 1.2 Lectura del contenido por nombre y copia, y listado de archivos de la carpeta
- [x] 1.3 Rutas `GET /api/projects/:id/skills[/content]`, `GET /api/user-skills[/content]` y `POST …/open`, con pruebas de la API

## 2. Cliente

- [x] 2.1 Ruta `#/skills/<proyecto>[/<skill>]` y opción «Skills» en el menú «Proyectos»
- [x] 2.2 Pantalla Skills: barra lateral con recuentos y entrada «Usuario», lista con etiquetas de agente y aviso de copias distintas
- [x] 2.3 Lector con cabecera de frontmatter, selector de copia, archivos y botón «Abrir en VS Code»
- [x] 2.4 Pruebas de la ruta y de la lógica del cliente

## 2c. Propias y de terceros

- [x] 2c.1 Clasificación en `server/skills.ts` (autor del proyecto, manifiesto de claude.ai) y lectura tolerante del frontmatter, con pruebas
- [x] 2c.2 Secciones «Propias» y «De terceros» en la lista y etiqueta de origen en el lector
- [x] 2c.4 «De terceros» desplegable, plegada por defecto y desplegada si no hay propias o si la skill abierta es suya
- [x] 2c.3 Convención `metadata.author: <proyecto>` en el `AGENTS.md` del harness, README y spec

## 3. Cierre

- [x] 3.1 Prueba en el panel con proyectos reales (SmashAdvisor, el harness vacío y Usuario)
- [x] 3.2 Documentación del panel
- [x] 3.3 `bin/check` y validaciones del panel

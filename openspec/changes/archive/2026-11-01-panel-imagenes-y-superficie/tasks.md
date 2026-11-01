## 1. Superficie en el harness

- [x] 1.1 `bin/agent`: validar y exportar `JDEV_SURFACE` (`terminal` por defecto) y registrar en Claude el `SessionStart` (startup|resume|clear|compact) con `bin/session-status --context`
- [x] 1.2 `bin/session-status --context`: salida `hookSpecificOutput.additionalContext` con la superficie y la ruta de la regla, silenciosa ante errores
- [x] 1.3 `rules/surface.md`, enlace en `AGENTS.md` y en `rules/README.md`
- [x] 1.4 Pruebas en `bin/check` (validación de `JDEV_SURFACE`, hook registrado, salida JSON de `--context`)

## 2. Servidor del panel

- [x] 2.1 `tmux.ts`: `JDEV_SURFACE=panel` al crear y retomar sesiones; directorio actual del panel de tmux por sesión
- [x] 2.2 `images.ts` y `GET /api/image`: resolución de rutas, carpetas permitidas, `realpath`, firma, tamaño y cabeceras seguras
- [x] 2.3 `uploads.ts` y `POST /api/uploads`: límite en streaming, firma, nombre único, permisos y limpieza de más de 7 días
- [x] 2.4 Pruebas de ambos endpoints (rutas fuera, symlinks, `..`, tamaños, tipos, SVG, limpieza)

## 3. Cliente

- [x] 3.1 Proveedor de enlaces de imagen en xterm.js con líneas ajustadas, clic, Ctrl+clic y tooltip
- [x] 3.2 Visor lateral según `Visor.dc.html`: cabecera, controles, zoom, tira por terminal, errores y accesibilidad
- [x] 3.3 Adjuntar según `Adjuntar.dc.html`: pegar, arrastrar con superposición, avisos de adjuntada y rechazada, inserción de la ruta
- [x] 3.4 Pruebas de la lógica pura (detección de rutas, unión de líneas, validación de archivos)

## 4. Documentación y validación

- [x] 4.1 README (panel: imágenes y superficie) y ayuda de la barra de estado
- [x] 4.2 `bin/check`, `pnpm --dir panel typecheck`, `test` y `build`
- [x] 4.3 QA con el subagente `qa` contra los artboards nuevos

## 5. Vista previa, apertura automática y formato del agente

- [x] 5.1 Miniatura flotante al pasar el ratón por un enlace de imagen
- [x] 5.2 Ajuste «Abrir el visor al aparecer una imagen nueva» (desactivado por defecto) y su detección en las terminales visibles
- [x] 5.3 `rules/surface.md`: en el panel, cada imagen bajo su párrafo y marcada con guion largo y 📸 (`— 📸 <ruta>  <qué mirar>`), con aviso inicial si la respuesta es larga
- [x] 5.4 Pruebas, validaciones y comprobación manual aislada

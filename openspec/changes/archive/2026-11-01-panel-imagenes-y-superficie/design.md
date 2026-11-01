## Context

- Panel v1 archivado (`openspec/specs/agent-panel/spec.md`): servidor Node 24 en `panel/server`, cliente React con xterm.js 6, sesiones en `tmux -L jdev`, token y validación de `Host`/`Origin`.
- Diseño de referencia: artboards `Visor.dc.html` y `Adjuntar.dc.html` del lienzo https://claude.ai/artifact/6AW2wshSfooPFsidhdegjU.
- `bin/session-status --hook` devuelve `systemMessage`, que la persona ve pero el modelo no. Claude Code admite en `SessionStart` la salida `hookSpecificOutput.additionalContext`, que sí llega al modelo.
- Claude Code acepta rutas de imagen en el prompt y las lee como imagen.

## Goals / Non-Goals

**Goals:**

- Ver en el panel cualquier imagen que el agente mencione, sin salir del navegador.
- Pasar imágenes al agente desde el portapapeles de Windows o arrastrándolas.
- Que el agente sepa en qué superficie trabaja y actúe en consecuencia.

**Non-Goals:**

- Imágenes dentro del texto de la terminal (sixel o protocolos inline): dependen de cómo esté compilado tmux.
- Vídeo, PDF u otros adjuntos.
- Contexto de superficie para Codex si su hook no admite contexto adicional: allí se apoya en la regla y en `$JDEV_SURFACE`.

## Decisions

### Detección de rutas en la terminal

- Proveedor de enlaces propio de xterm.js (`registerLinkProvider`) con una expresión para rutas que terminen en extensión de imagen. Une las líneas marcadas como `isWrapped` para no partir rutas largas.
- Las rutas relativas se resuelven en el servidor con el directorio actual del panel de tmux (`#{pane_current_path}`). Se descarta resolver en el cliente porque no conoce ese directorio.
- Clic: abre en el visor. Ctrl+clic: abre en una pestaña nueva del navegador. Tooltip según el diseño.
- La tira del visor guarda en memoria del cliente las imágenes abiertas o enlazadas por terminal (máximo 20).

### Entrega de imágenes: `GET /api/image?session=<s>&path=<p>`

1. Exige token.
2. Resuelve la ruta (relativa al directorio de la sesión si no es absoluta) y obtiene la ruta real con `realpath`.
3. Comprueba que está dentro de una carpeta permitida: harness (incluye `projects/` y los worktrees), `PLAYWRIGHT_MCP_OUTPUT_DIR` o `${TMPDIR:-/tmp}/jdev-qa`, la carpeta de subidas y `${TMPDIR:-/tmp}`.
4. Comprueba extensión, tamaño (25 MB por defecto) y firma del contenido (PNG, JPEG, GIF, WEBP; SVG por cabecera XML/`<svg`).
5. Responde con `Content-Type` de imagen, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` y, en SVG, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.

Errores en castellano (403 fuera de carpetas, 404 no existe, 413 demasiado grande, 415 no es imagen). Las dimensiones y el tamaño para la cabecera del visor salen de `HEAD` o de cabeceras `X-Image-*`.

### Subida: `POST /api/uploads`

- Cuerpo binario con `Content-Type: image/png|jpeg|gif|webp`, límite de 20 MB leído en streaming y cortado al superarlo.
- Se valida la firma y se guarda con nombre `YYYY-MM-DD-HHMM-<6 hex>.<ext>`, permisos 0600 y carpeta 0700. Devuelve `{path, name, size}`.
- Al arrancar y cada 12 h se borran las subidas de más de 7 días.
- El cliente intercepta `paste` (solo si el portapapeles trae imagen y no texto) y `drop` sobre el panel de terminal. Inserta la ruta con `terminal.paste()`, que respeta el pegado entre corchetes, seguida de un espacio y sin Enter. Varias imágenes a la vez se insertan separadas por espacios.
- SVG no se admite como subida para evitar contenido activo.

### Superficie

- `panel/server/tmux.ts` crea las sesiones con `-e JDEV_SURFACE=panel`. También las retomadas, porque `--resume` arranca un proceso nuevo.
- `bin/agent` valida y exporta `JDEV_SURFACE` (`terminal` por defecto) y registra en Claude un `SessionStart` con matcher `startup|resume|clear|compact` que ejecuta `bin/session-status --context`.
- Esa orden devuelve `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}` con una línea breve, por ejemplo «Superficie: panel gráfico de jdev-ai (JDEV_SURFACE=panel). Sigue rules/surface.md del harness.», y la ruta absoluta de la regla.
- El hook actual de `systemMessage` no cambia. En Codex se intenta lo mismo solo si su configuración de hooks admite contexto adicional; si no, la regla indica consultar `$JDEV_SURFACE`.
- `rules/surface.md`:
  - **Panel:** para enseñar una imagen, escribe su ruta absoluta en su propia línea (será clicable). Las imágenes que adjunte la persona llegan como rutas de `~/.cache/jdev-ai/panel/uploads/` y se leen con la herramienta de lectura. Prefiere mostrar la captura a describirla.
  - **Terminal:** la persona no ve imágenes. Descríbelas y da la ruta; si necesitas una imagen suya, pídele la ruta del archivo.
  - **Si no consta:** si no hay indicación en el contexto, consulta `$JDEV_SURFACE`; si sigue sin estar claro, asume terminal.

## Risks / Trade-offs

- **Falsos positivos o rutas con espacios** → la expresión exige extensión de imagen y separadores claros, y no admite espacios sin comillas. Las rutas entre comillas o comillas angulares sí se reconocen.
- **Lectura de archivos del disco por el servidor** → lista cerrada de carpetas, `realpath`, firma, tamaño y token. La carpeta temporal es amplia, pero es donde Playwright y otras herramientas dejan capturas; queda documentado.
- **El portapapeles de Windows desde el navegador** puede entregar la imagen como archivo o como blob según la aplicación de origen → se tratan ambos casos.
- **`additionalContext` en `resume`** depende del soporte de Claude Code → si no llega, la regla y `$JDEV_SURFACE` cubren el caso.
- **Las subidas son datos de la persona** → permisos 0600 y borrado a los 7 días. No se suben a ningún sitio.

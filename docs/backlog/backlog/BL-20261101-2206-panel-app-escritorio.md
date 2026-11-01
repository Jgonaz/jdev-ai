---
id: BL-20261101-2206-panel-app-escritorio
title: "Aplicación de escritorio del panel gráfico (Electron o Tauri)"
type: feature
status: backlog
priority: baja
created: 2026-11-01
updated: 2026-11-01
refs:
  - "panel/"
  - "bin/panel"
  - "panel/public/manifest.webmanifest"
---

# Aplicación de escritorio del panel gráfico (Electron o Tauri)

## Resumen

El panel gráfico ya se puede instalar como aplicación desde Edge o Chrome
(PWA) o abrir en una ventana de aplicación con `bin/panel --app`, pero sigue
dentro del navegador: `Ctrl+W` cierra la ventana en lugar de llegar a la
terminal, algunos atajos son del navegador, las notificaciones no son nativas
y no hay icono en la bandeja ni arranque automático del servidor. Una
aplicación de escritorio para Windows que cargue el panel de WSL lo
resolvería. Antes de decidir conviene usar la PWA unos días y comprobar si
esas limitaciones molestan de verdad. Si sí, la opción preferida es Electron
por madurez y empaquetado; Tauri sería más ligera pero añade Rust y complica
compilar para Windows desde WSL.

## Contexto

La valoración se hizo el 2026-11-01 al plantear salir del navegador:

- **PWA** (hecha): ventana propia e icono, coste mínimo. No captura `Ctrl+W`
  ni da bandeja o notificaciones nativas.
- **Electron en Windows**: carga `http://localhost:4317` y arranca
  `bin/panel` con `wsl.exe` si no está en marcha. Captura todos los atajos,
  notificaciones nativas, bandeja con el número de sesiones que esperan, atajo
  global y arranque con Windows. Coste estimado: 1–2 días un envoltorio básico
  y 3–5 días algo pulido. Instalador de más de 100 MB, mantenimiento de
  versiones por seguridad, compilación para Windows incómoda desde WSL y avisos
  de SmartScreen sin firma de código.
- **Tauri**: lo mismo con WebView2 de Windows, instalador de unos 10 MB y menos
  memoria; requiere Rust y la compilación cruzada desde WSL es más delicada.
- Ejecutar Electron dentro de WSL con WSLg se descartó por problemas de
  portapapeles, fuentes e integración con Windows.

## Próximo paso

Tras usar la PWA, decidir si las limitaciones del navegador justifican la
aplicación de escritorio. Si es así, proponer un cambio OpenSpec con Electron
(o Tauri si el tamaño importa más), cerrando antes cómo se arranca el servidor
de WSL, cómo se gestiona el token y cómo se empaqueta y actualiza.

## Criterios de cierre

- Aplicación de Windows que abre el panel sin navegador, con `Ctrl+W`,
  `Ctrl+T` y `Ctrl+Tab` disponibles para la terminal.
- Arranca el servidor del panel en WSL si no está en marcha.
- Notificaciones nativas y, si se decide, icono en la bandeja con las sesiones
  que esperan.
- Documentada su instalación y actualización.

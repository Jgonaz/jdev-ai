// Programa de escritorio del panel de Jdev-ai para Windows.
//
// No tiene interfaz propia: arranca el servidor del panel dentro de WSL con
// bin/panel y muestra en una ventana la interfaz que ese servidor sirve en
// http://localhost:<puerto>. Si el panel ya estaba en marcha, se conecta a él.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::ipc::CapabilityBuilder;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Distro de WSL y ruta del harness dentro de ella, grabadas al compilar.
const DISTRO: &str = env!(
    "JDEV_DESKTOP_DISTRO",
    "compila con bin/panel-desktop build, que define JDEV_DESKTOP_DISTRO"
);
const HARNESS: &str = env!(
    "JDEV_DESKTOP_HARNESS",
    "compila con bin/panel-desktop build, que define JDEV_DESKTOP_HARNESS"
);

const MAIN: &str = "main";
/// Tiempo que se da al servidor para terminar tras SIGTERM antes de matar wsl.exe.
const STOP_WAIT: Duration = Duration::from_secs(3);
/// Tiempo que se espera a conocer el PID del servidor si se cierra durante el arranque.
const PID_WAIT: Duration = Duration::from_secs(2);
/// Plazo total para que lo que escucha en el puerto demuestre que es el panel.
const IDENTIFY_WAIT: Duration = Duration::from_secs(3);
/// Tiempo máximo que se espera a que Windows alcance el puerto del panel antes de navegar.
const REACH_WAIT: Duration = Duration::from_secs(10);
/// Cuánta salida de error se conserva para enseñarla si el arranque falla.
const MAX_ERROR_BYTES: usize = 8 * 1024;

#[derive(Default)]
struct Panel {
    /// Puerto del panel; 0 hasta que se conoce. Acota la navegación.
    port: AtomicU16,
    started: AtomicBool,
    /// El programa se está cerrando: ya no se navega ni se busca otro panel.
    stopping: AtomicBool,
    /// `wsl.exe` del servidor que arrancó este programa (y que para al cerrar).
    /// Se guarda nada más lanzarlo, para pararlo también si se cierra la
    /// ventana durante el arranque.
    owned: Mutex<Option<Child>>,
    /// PID del servidor dentro de WSL, para mandarle SIGTERM; 0 si aún no se sabe.
    pid: AtomicU32,
    aux: AtomicU32,
}

/// Qué hay en el puerto del panel cuando este programa no ha podido arrancarlo.
enum Existing {
    Panel(Url),
    /// Otro programa ocupa el puerto.
    Other(u16),
    Nothing,
}

/// `wsl.exe` hacia la distro del harness, sin abrir una consola.
fn wsl(args: &[&str]) -> Command {
    let mut c = Command::new("wsl.exe");
    c.args(["-d", DISTRO, "--cd", "~", "--exec"]).args(args);
    c.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Una orden en bash interactivo (-i), que carga ~/.bashrc: ahí pone nvm Node en el PATH.
fn wsl_bash(script: &str) -> Command {
    wsl(&["bash", "-ic", script])
}

/// Texto legible de la salida de wsl.exe, que escribe sus propios errores en UTF-16.
fn clean(bytes: &[u8]) -> String {
    let nulos = bytes.iter().filter(|b| **b == 0).count();
    let texto = if nulos > 0 && nulos * 3 >= bytes.len() {
        let pares: Vec<u16> = bytes.chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
        String::from_utf16_lossy(&pares)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    texto.replace('\0', "").trim().to_string()
}

fn panel_url(line: &str) -> Option<Url> {
    let url = Url::parse(line.trim()).ok()?;
    (url.scheme() == "http" && url.host_str() == Some("localhost") && url.port().is_some()).then_some(url)
}

/// Guarda en `destino` lo que llega por `origen`, hasta MAX_ERROR_BYTES.
fn collect(mut origen: impl Read + Send + 'static, destino: &Arc<Mutex<Vec<u8>>>) {
    let destino = Arc::clone(destino);
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while let Ok(n) = origen.read(&mut buf) {
            if n == 0 {
                break;
            }
            let mut d = destino.lock().unwrap();
            if d.len() < MAX_ERROR_BYTES {
                d.extend_from_slice(&buf[..n]);
            }
        }
    });
}

/// Arranca el servidor y devuelve su URL de acceso. Si termina sin darla
/// (lo habitual: el puerto ya lo ocupa otro panel), devuelve su salida de error.
fn start_server(estado: &Panel) -> Result<Url, String> {
    // El PID es el del servidor: bin/panel termina con «exec node».
    let script = format!("echo JDEV_PID:$$; exec {HARNESS}/bin/panel");
    let mut child = wsl_bash(&script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar wsl.exe: {e}"))?;

    let errores = Arc::new(Mutex::new(Vec::<u8>::new()));
    if let Some(stderr) = child.stderr.take() {
        collect(stderr, &errores);
    }
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout con tubería"));
    *estado.owned.lock().unwrap() = Some(child);

    // Lo que no es ni el PID ni la URL: si wsl.exe falla (la distro no existe),
    // su motivo llega por aquí y no por la salida de error.
    let mut resto = Vec::new();
    let mut linea = Vec::new();
    loop {
        linea.clear();
        match stdout.read_until(b'\n', &mut linea) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let texto = String::from_utf8_lossy(&linea);
        let texto = texto.trim();
        if let Some(n) = texto.strip_prefix("JDEV_PID:") {
            estado.pid.store(n.parse().unwrap_or(0), Ordering::SeqCst);
        } else if let Some(url) = texto.strip_prefix("Abre: ").and_then(panel_url) {
            // El servidor sigue escribiendo: se vacía su salida para que no se bloquee.
            thread::spawn(move || {
                let _ = std::io::copy(&mut stdout, &mut std::io::sink());
            });
            return Ok(url);
        } else if resto.len() < MAX_ERROR_BYTES {
            resto.extend_from_slice(&linea);
        }
    }
    if let Some(mut child) = estado.owned.lock().unwrap().take() {
        let _ = child.wait();
    }
    estado.pid.store(0, Ordering::SeqCst);
    // Margen para que el hilo de errores recoja lo último.
    thread::sleep(Duration::from_millis(100));
    let error = clean(&errores.lock().unwrap());
    Err(if error.is_empty() { clean(&resto) } else { error })
}

/// Busca un panel que ya esté en marcha en el puerto configurado.
fn existing_panel() -> Existing {
    let script = format!("exec {HARNESS}/bin/panel --print-url");
    let Ok(salida) = wsl_bash(&script).stderr(Stdio::null()).output() else {
        return Existing::Nothing;
    };
    let Some(url) = clean(&salida.stdout).lines().rev().find_map(panel_url) else {
        return Existing::Nothing;
    };
    let puerto = url.port().unwrap_or(0);
    let Some(conexion) = connect(puerto) else {
        return Existing::Nothing;
    };
    if is_panel(conexion, puerto) {
        Existing::Panel(url)
    } else {
        Existing::Other(puerto)
    }
}

fn connect(port: u16) -> Option<TcpStream> {
    // «localhost» resuelve a IPv6 e IPv4; el reenvío de WSL puede atender solo una.
    ("localhost", port)
        .to_socket_addrs()
        .ok()?
        .find_map(|d| TcpStream::connect_timeout(&d, Duration::from_secs(2)).ok())
}

/// Comprueba que quien escucha en el puerto es el panel, con un recurso que
/// sirve sin token: así el token nunca se envía a otro servicio.
fn is_panel(mut s: TcpStream, port: u16) -> bool {
    let peticion = format!("GET /manifest.webmanifest HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(peticion.as_bytes()).is_err() {
        return false;
    }
    // Plazo total, no por lectura: un servicio que responde a goteo no puede
    // dejar el arranque esperando sin fin.
    let limite = Instant::now() + IDENTIFY_WAIT;
    let mut respuesta = Vec::new();
    let mut buf = [0u8; 4096];
    while respuesta.len() < 16 * 1024 {
        let queda = limite.saturating_duration_since(Instant::now());
        if queda.is_zero() || s.set_read_timeout(Some(queda)).is_err() {
            break;
        }
        match s.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => respuesta.extend_from_slice(&buf[..n]),
        }
    }
    let texto = String::from_utf8_lossy(&respuesta);
    texto.starts_with("HTTP/1.1 200") && texto.contains("\"short_name\": \"Jdev-ai\"")
}

fn stop_server(app: &AppHandle) {
    let estado = app.state::<Panel>();
    estado.stopping.store(true, Ordering::SeqCst);
    let Some(mut child) = estado.owned.lock().unwrap().take() else {
        return;
    };
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    // Cerrado nada más abrir: bash aún no ha dicho su PID.
    let limite = Instant::now() + PID_WAIT;
    while estado.pid.load(Ordering::SeqCst) == 0 && Instant::now() < limite {
        thread::sleep(Duration::from_millis(50));
    }
    // Matar wsl.exe no garantiza que el proceso de Linux reciba la señal:
    // primero se le pide al servidor que termine dentro de WSL. Sin pasar por
    // bash, para no depender de lo que tarde el ~/.bashrc.
    let pid = estado.pid.load(Ordering::SeqCst);
    if pid != 0 {
        let _ = wsl(&["kill", "-TERM", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let limite = Instant::now() + STOP_WAIT;
    while Instant::now() < limite {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
}

/// La URL pertenece al panel (o es la pantalla de arranque del propio programa).
fn is_own(app: &AppHandle, url: &Url) -> bool {
    let puerto = app.state::<Panel>().port.load(Ordering::Relaxed);
    match (url.scheme(), url.host_str()) {
        // La pantalla de arranque solo mientras no se ha llegado al panel: después,
        // volver a ella dejaría la ventana sin salida.
        ("tauri", _) | ("http" | "https", Some("tauri.localhost")) => puerto == 0,
        ("http", Some("localhost" | "127.0.0.1")) => puerto != 0 && url.port() == Some(puerto),
        ("about", _) => url.as_str() == "about:blank",
        _ => false,
    }
}

fn open_external(url: &Url) {
    // La pantalla de arranque no existe fuera del programa.
    if url.host_str() == Some("tauri.localhost") {
        return;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

/// Navegación acotada al panel; lo demás va al navegador por defecto.
fn guard_navigation(app: &AppHandle, url: &Url) -> bool {
    if is_own(app, url) {
        return true;
    }
    open_external(url);
    false
}

fn show_error(app: &AppHandle, mensaje: &str) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let texto = serde_json::to_string(mensaje).unwrap_or_else(|_| "\"\"".into());
        let _ = w.eval(format!("window.mostrarError({texto})"));
    }
}

/// Espera a que el puerto del panel acepte conexiones desde Windows.
fn wait_reachable(estado: &Panel, port: u16) {
    let limite = Instant::now() + REACH_WAIT;
    while Instant::now() < limite && !estado.stopping.load(Ordering::SeqCst) {
        if connect(port).is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn launch(app: AppHandle) {
    let estado = app.state::<Panel>();
    let url = match start_server(&estado) {
        Ok(url) => url,
        Err(_) if estado.stopping.load(Ordering::SeqCst) => return,
        Err(error) => match existing_panel() {
            Existing::Panel(url) => url,
            Existing::Other(puerto) => {
                show_error(
                    &app,
                    &format!(
                        "El puerto {puerto} lo ocupa otro programa que no es el panel.\n\n\
                         Cierra ese programa, o arranca el panel en otro puerto desde una terminal de WSL \
                         (bin/panel --port N --open) y cámbialo en Ajustes › Servidor local."
                    ),
                );
                return;
            }
            Existing::Nothing => {
                let detalle = if error.is_empty() {
                    "bin/panel no devolvió la URL de acceso.".to_string()
                } else {
                    error
                };
                show_error(&app, &format!("{detalle}\n\nDistro de WSL: {DISTRO}\nHarness: {HARNESS}"));
                return;
            }
        },
    };
    if estado.stopping.load(Ordering::SeqCst) {
        return;
    }
    let puerto = url.port().unwrap_or(0);
    estado.port.store(puerto, Ordering::Relaxed);
    // El servidor ya escucha dentro de WSL, pero Windows tarda un instante en
    // reenviar el puerto: sin esta espera la ventana enseña «conexión rechazada»
    // antes de cargar el panel.
    wait_reachable(&estado, puerto);

    // La página del panel solo puede usar las notificaciones nativas: nada de
    // archivos, procesos ni shell.
    let permiso = CapabilityBuilder::new("panel-avisos")
        .local(false)
        .remote(format!("http://localhost:{puerto}/*"))
        .window(MAIN)
        .permission("notification:allow-notify")
        .permission("notification:allow-is-permission-granted")
        .permission("notification:allow-request-permission");
    let _ = app.add_capability(permiso);

    if let Some(w) = app.get_webview_window(MAIN) {
        // Navegación del propio programa, no de la página: si la iniciara la
        // pantalla de arranque (otro sitio), la cookie SameSite=Strict que fija el
        // servidor no viajaría tras su redirección y el panel respondería 401.
        // La pantalla de arranque queda en el historial, pero is_own impide volver.
        let _ = w.navigate(url);
    }
}

fn open_aux_window(app: &AppHandle, url: Url) {
    let n = app.state::<Panel>().aux.fetch_add(1, Ordering::Relaxed);
    let navegacion = app.clone();
    let _ = WebviewWindowBuilder::new(app, format!("aux-{n}"), WebviewUrl::External(url))
        .title("Jdev-ai")
        .inner_size(1100.0, 800.0)
        .on_navigation(move |u| guard_navigation(&navegacion, u))
        .on_document_title_changed(|w, titulo| {
            let _ = w.set_title(&titulo);
        })
        .build();
}

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| focus_main(app)))
        .plugin(tauri_plugin_notification::init())
        .manage(Panel::default())
        .setup(|app| {
            let navegacion = app.handle().clone();
            let ventanas = app.handle().clone();
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
                .title("Jdev-ai")
                .inner_size(1400.0, 900.0)
                .min_inner_size(720.0, 480.0)
                // El mismo fondo que la pantalla de arranque: la ventana no parpadea
                // en blanco mientras el motor web carga.
                .background_color(Color(9, 9, 10, 255))
                // Sin esto Tauri intercepta el arrastre de archivos y el panel
                // no recibe las imágenes que se sueltan sobre una terminal.
                .disable_drag_drop_handler()
                .on_navigation(move |u| guard_navigation(&navegacion, u))
                .on_new_window(move |url, _| {
                    if is_own(&ventanas, &url) {
                        // Contenido del panel (una imagen «en pestaña nueva»): otra
                        // ventana del programa, que comparte la cookie de acceso.
                        let app = ventanas.clone();
                        thread::spawn(move || open_aux_window(&app, url));
                    } else {
                        open_external(&url);
                    }
                    NewWindowResponse::Deny
                })
                .on_document_title_changed(|w, titulo| {
                    let _ = w.set_title(&titulo);
                })
                .on_page_load(|w, carga| {
                    // El servidor se arranca con la pantalla de arranque ya cargada,
                    // para poder enseñar en ella un error inmediato.
                    let app = w.app_handle().clone();
                    if carga.event() == PageLoadEvent::Finished && !app.state::<Panel>().started.swap(true, Ordering::SeqCst) {
                        thread::spawn(move || launch(app));
                    }
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar la ventana principal cierra el programa entero.
            if window.label() == MAIN && matches!(event, WindowEvent::CloseRequested { .. }) {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("no se pudo arrancar Jdev-ai");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_server(app);
        }
    });
}

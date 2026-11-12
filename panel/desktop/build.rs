fn main() {
    // La distro de WSL y la ruta del harness quedan grabadas en el ejecutable;
    // las pone bin/panel-desktop. Si cambian, hay que recompilar.
    println!("cargo:rerun-if-env-changed=JDEV_DESKTOP_DISTRO");
    println!("cargo:rerun-if-env-changed=JDEV_DESKTOP_HARNESS");
    tauri_build::build()
}

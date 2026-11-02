const ATAJOS = [
  { teclas: 'Ctrl+Alt+←', accion: 'Terminal anterior' },
  { teclas: 'Ctrl+Alt+→', accion: 'Terminal siguiente' },
  { teclas: 'Ctrl+Alt+N', accion: 'Nueva sesión' },
  { teclas: 'Ctrl+Alt+L', accion: 'Cambiar la distribución (una, dos columnas, cuatro)' },
  { teclas: 'Ctrl+Alt+Esc', accion: 'Salir del foco de la terminal: lleva el foco a la pestaña activa (Tab dentro de la terminal es de la shell, para autocompletar)' },
  { teclas: 'Ctrl+Retroceso', accion: 'En la terminal: borra la palabra anterior (envía Ctrl+W)' },
  { teclas: 'Ctrl+Supr', accion: 'En la terminal: borra la palabra siguiente (envía Alt+D)' },
  { teclas: 'Mayús+RePág / Mayús+AvPág', accion: 'En la terminal: sube y baja una página por el historial (el de tmux o, a pantalla completa, el de la aplicación)' },
  { teclas: 'Esc', accion: 'Cerrar un diálogo o un menú' },
];

export function ShortcutsSection() {
  return (
    <section id="atajos" className="set-section" aria-labelledby="h-atajos">
      <div className="set-section__intro">
        <h2 id="h-atajos" className="set-h2">
          Atajos de teclado
        </h2>
        <p className="set-lead">
          Funcionan aunque una terminal tenga el foco. Evitan Ctrl+T, Ctrl+W y las combinaciones con AltGr de los teclados españoles (Ctrl+Alt+1, 2 o 4
          escriben |, @ y ~), por eso no hay atajos con números. Para que Ctrl+W y Ctrl+T lleguen a la terminal, abre el panel en modo aplicación del
          navegador.
        </p>
      </div>
      <dl className="shortcuts">
        {ATAJOS.map((a) => (
          <div key={a.teclas} className="shortcuts__row">
            <dt>
              <kbd>{a.teclas}</kbd>
            </dt>
            <dd>{a.accion}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

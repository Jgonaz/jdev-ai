import { ShortcutsList } from '../../components/ShortcutsList.tsx';

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
      <ShortcutsList />
    </section>
  );
}

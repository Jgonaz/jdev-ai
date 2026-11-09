import { SHORTCUT_GROUPS } from '../lib/shortcuts.ts';

/** Atajos de teclado agrupados; `headingLevel` ajusta los títulos de grupo al documento que los contiene. */
export function ShortcutsList({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="shortcuts-groups">
      {SHORTCUT_GROUPS.map((g) => (
        <section key={g.titulo} className="shortcuts-group" aria-label={g.titulo}>
          <H className="shortcuts-group__title">{g.titulo}</H>
          <dl className="shortcuts">
            {g.atajos.map((a) => (
              <div key={a.teclas} className="shortcuts__row">
                <dt>
                  <kbd>{a.teclas}</kbd>
                </dt>
                <dd>{a.accion}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

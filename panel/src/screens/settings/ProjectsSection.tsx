import { useState } from 'react';
import { PROJECT_PALETTE } from '../../../shared/settings-schema.ts';
import { Monogram } from '../../components/Monogram.tsx';
import { useSessions } from '../../state/SessionsContext.tsx';
import { useSettings } from '../../state/SettingsContext.tsx';
import type { ProjectInfo } from '../../types.ts';

const NOMBRES_COLOR: Record<string, string> = {
  '#6fb7ff': 'Azul',
  '#ff8a6b': 'Coral',
  '#c79bff': 'Violeta',
  '#f2a7c8': 'Rosa',
  '#e9e1cf': 'Crema',
  '#6cc3b5': 'Menta',
};

function ProjectRow({ p }: { p: ProjectInfo }) {
  const { update } = useSettings();
  const [mono, setMono] = useState<string | null>(null);

  const cambiarMono = (crudo: string) => {
    const limpio = Array.from(crudo.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase()).slice(0, 2).join('');
    setMono(limpio);
    if (limpio !== '') update({ projects: { [p.id]: { mono: limpio } } });
  };
  // Vacío = volver al monograma por defecto (se borra el override).
  const alSalir = () => {
    if (mono === '') update({ projects: { [p.id]: { mono: null } } });
    setMono(null);
  };

  return (
    <li className="prow">
      <Monogram project={{ mono: mono || p.mono, color: p.color }} size="lg" />
      <span className="prow__name">{p.name}</span>
      <label className="prow__label">
        Monograma
        <input
          type="text"
          className="prow__mono"
          value={mono ?? p.mono}
          maxLength={2}
          aria-label={`Monograma de ${p.name}`}
          onChange={(e) => cambiarMono(e.target.value)}
          onBlur={alSalir}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="prow__swatches" role="group" aria-label={`Color de ${p.name}`}>
        {PROJECT_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            style={{ background: c }}
            aria-label={NOMBRES_COLOR[c] ?? c}
            aria-pressed={p.color.toLowerCase() === c}
            onClick={() => update({ projects: { [p.id]: { color: c } } })}
          />
        ))}
      </div>
      <label className="prow__label prow__visible">
        <input type="checkbox" checked={p.visible} onChange={(e) => update({ projects: { [p.id]: { visible: e.target.checked } } })} />
        Visible
      </label>
    </li>
  );
}

export function ProjectsSection() {
  const { projects, loaded } = useSessions();
  return (
    <section id="proyectos" className="set-section" aria-labelledby="h-proy">
      <div className="set-section__intro">
        <h2 id="h-proy" className="set-h2">
          Proyectos
        </h2>
        <p className="set-lead">Monograma y color de cada proyecto, y si aparece en la barra lateral.</p>
      </div>
      {projects.length > 0 ? (
        <ul className="prow-list">
          {projects.map((p) => (
            <ProjectRow key={p.id} p={p} />
          ))}
        </ul>
      ) : (
        <p className="hint">{loaded ? 'No se han encontrado proyectos en projects/.' : 'Cargando proyectos…'}</p>
      )}
    </section>
  );
}

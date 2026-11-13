import type { RightView } from '../../lib/workspace.ts';

const VISTAS: readonly { id: RightView; texto: string }[] = [
  { id: 'context', texto: 'Contexto' },
  { id: 'map', texto: 'Mapa' },
];

/** Selector «Contexto | Mapa» de la cabecera del panel derecho de Terminales (estilo segmentado del conmutador Terminal / Chat). */
export function RightViewSwitch({ view, onView }: { view: RightView; onView: (v: RightView) => void }) {
  return (
    <div className="viewsw viewsw--full viewsw--panel" role="group" aria-label="Vista del panel derecho">
      {VISTAS.map((v) => (
        <button key={v.id} type="button" className="viewsw__btn" aria-pressed={view === v.id} onClick={() => onView(v.id)}>
          {v.texto}
        </button>
      ))}
    </div>
  );
}
